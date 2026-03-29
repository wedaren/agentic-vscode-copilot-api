/**
 * handlers/chat.ts
 * 处理 POST /v1/chat/completions 请求（非流式 + 流式 SSE）
 * 将 OpenAI 格式请求转换为 vscode.lm API 调用，并将响应转回 OpenAI 格式
 *
 * 支持能力：
 *   - 非流式响应（stream: false）
 *   - 流式 SSE 响应（stream: true）
 *   - Function Calling / tools：请求传入 tools 数组（OpenAI function tool 格式），
 *     会转换为 vscode.LanguageModelChatTool（须 vscode.lm 支持），
 *     响应中的 LanguageModelToolCallPart 会被转换为 OpenAI tool_calls 格式返回。
 */

import * as http from 'http';
import * as vscode from 'vscode';

/** OpenAI 消息格式 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** function calling 中工具调用结果对应的 call id */
  tool_call_id?: string;
}

/** OpenAI function tool 定义 */
interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** OpenAI chat/completions 请求体 */
interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  stream?: boolean;
}

/**
 * 读取请求体
 */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * 将 OpenAI messages 转换为 vscode.LanguageModelChatMessage 数组
 * vscode.lm 不支持 system role，将 system 消息转换为 User 消息；
 * tool role（工具执行结果）转换为 User 消息以传回上下文
 */
function convertMessages(
  messages: ChatMessage[]
): vscode.LanguageModelChatMessage[] {
  return messages.map((msg) => {
    if (msg.role === 'assistant') {
      return vscode.LanguageModelChatMessage.Assistant(msg.content);
    }
    // system、user、tool 都映射到 User 消息
    return vscode.LanguageModelChatMessage.User(msg.content);
  });
}

/**
 * 将 OpenAI tool 定义转换为 vscode.LanguageModelChatTool 数组
 */
function convertTools(tools: ToolDefinition[]): vscode.LanguageModelChatTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description ?? '',
    inputSchema: (t.function.parameters ?? { type: 'object', properties: {} }) as Record<string, unknown>,
  }));
}

/**
 * 将 LanguageModelError 映射到 HTTP 状态码
 */
function mapErrorToStatus(err: unknown): { status: number; type: string; code: string } {
  if (err instanceof vscode.LanguageModelError) {
    switch (err.code) {
      case vscode.LanguageModelError.NoPermissions.name:
        return { status: 401, type: 'authentication_error', code: 'unauthorized' };
      case vscode.LanguageModelError.Blocked.name:
        return { status: 403, type: 'permission_denied', code: 'blocked' };
      case vscode.LanguageModelError.NotFound.name:
        return { status: 404, type: 'not_found_error', code: 'model_not_found' };
    }
  }
  return { status: 500, type: 'server_error', code: 'internal_error' };
}

/**
 * 发送 OpenAI 格式错误响应
 */
function sendError(
  res: http.ServerResponse,
  status: number,
  message: string,
  type: string,
  code: string
): void {
  const body = JSON.stringify({ error: { message, type, code } });
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

/**
 * 处理 POST /v1/chat/completions 请求
 */
export async function handleChat(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  // 解析请求体
  let chatReq: ChatRequest;
  try {
    const raw = await readBody(req);
    chatReq = JSON.parse(raw) as ChatRequest;
  } catch {
    sendError(res, 400, '请求体解析失败', 'invalid_request_error', 'parse_error');
    return;
  }

  const { model: modelId, messages, tools = [], stream = false } = chatReq;

  if (!modelId || !Array.isArray(messages)) {
    sendError(res, 400, 'model 和 messages 字段必填', 'invalid_request_error', 'missing_field');
    return;
  }

  // 检查模型是否在允许列表中（来自配置文件，非空列表表示启用了白名单）
  const allowed = require('../config').getAllowedModels();
  if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(modelId)) {
    sendError(res, 403, `模型 ${modelId} 未被允许`, 'permission_denied', 'model_not_allowed');
    return;
  }

  // 选取指定模型
  let selectedModel: vscode.LanguageModelChat | undefined;
  try {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot', id: modelId });
    if (models.length === 0) {
      // 尝试按 family 匹配
      const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      selectedModel = allModels.find((m) => m.id === modelId) ?? allModels[0];
    } else {
      selectedModel = models[0];
    }
  } catch (err) {
    const { status, type, code } = mapErrorToStatus(err);
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, status, message, type, code);
    return;
  }

  if (!selectedModel) {
    sendError(res, 404, `模型 ${modelId} 不存在`, 'not_found_error', 'model_not_found');
    return;
  }

  const lmMessages = convertMessages(messages);
  const lmTools = convertTools(tools);
  const cancellation = new vscode.CancellationTokenSource();
  const completionId = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  // 客户端断开连接时取消 vscode.lm 请求，释放资源
  req.on('close', () => {
    if (!res.writableEnded) {
      cancellation.cancel();
    }
  });

  // 120 秒超时保护（复杂页面 + function calling 多轮调用需要更长时间）
  const TIMEOUT_MS = 120_000;
  let isTimeout = false;
  const timeoutHandle = setTimeout(() => {
    isTimeout = true;
    cancellation.cancel();
  }, TIMEOUT_MS);

  if (stream) {
    // 流式 SSE 响应
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 发送首个 chunk（包含 role）
    const firstChunk = {
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model: selectedModel.id,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    };
    res.write(`data: ${JSON.stringify(firstChunk)}\n\n`);

    try {
      const response = await selectedModel.sendRequest(
        lmMessages,
        lmTools.length > 0 ? { tools: lmTools } : {},
        cancellation.token
      );

      // 收集 tool calls（需要全部收集后一起发出）
      const toolCallAccumulator: Map<string, { id: string; name: string; args: string }> = new Map();

      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          const chunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model: selectedModel.id,
            choices: [
              { index: 0, delta: { content: part.value }, finish_reason: null },
            ],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          // 累积 tool call 参数（可能分多个 part 到达）
          const callId = part.callId ?? `call_${toolCallAccumulator.size}`;
          const existing = toolCallAccumulator.get(callId);
          const argsStr = typeof part.input === 'string'
            ? part.input
            : JSON.stringify(part.input);
          if (existing) {
            existing.args += argsStr;
          } else {
            toolCallAccumulator.set(callId, { id: callId, name: part.name, args: argsStr });
          }
        }
      }

      // 如果有 tool calls，作为最终 delta 发出
      if (toolCallAccumulator.size > 0) {
        const toolCallsArr = Array.from(toolCallAccumulator.values()).map((tc, idx) => ({
          index: idx,
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.args },
        }));
        const toolChunk = {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: selectedModel.id,
          choices: [{ index: 0, delta: { tool_calls: toolCallsArr }, finish_reason: 'tool_calls' }],
        };
        res.write(`data: ${JSON.stringify(toolChunk)}\n\n`);
      }

      // 发送结束 chunk
      const finalChunk = {
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: selectedModel.id,
        choices: [{ index: 0, delta: {}, finish_reason: toolCallAccumulator.size > 0 ? 'tool_calls' : 'stop' }],
      };
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      if (isTimeout) {
        // 超时情况：写入超时错误 chunk（使用 TIMEOUT_MS 常量）
        const errorChunk = { error: { message: `请求超时（${TIMEOUT_MS / 1000}s）`, type: 'timeout_error', code: 'timeout' } };
        res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        const errorChunk = { error: { message } };
        res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } finally {
      clearTimeout(timeoutHandle);
      cancellation.dispose();
    }
  } else {
    // 非流式响应：收集所有 token 后一次性返回
    try {
      const response = await selectedModel.sendRequest(
        lmMessages,
        lmTools.length > 0 ? { tools: lmTools } : {},
        cancellation.token
      );
      let content = '';
      const toolCallMap: Map<string, { id: string; name: string; args: string }> = new Map();

      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          content += part.value;
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          const callId = part.callId ?? `call_${toolCallMap.size}`;
          const argsStr = typeof part.input === 'string'
            ? part.input
            : JSON.stringify(part.input);
          const existing = toolCallMap.get(callId);
          if (existing) {
            existing.args += argsStr;
          } else {
            toolCallMap.set(callId, { id: callId, name: part.name, args: argsStr });
          }
        }
      }

      // 构造 message：有 tool calls 时包含 tool_calls 字段
      const hasToolCalls = toolCallMap.size > 0;
      const toolCallsArr = Array.from(toolCallMap.values()).map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.args },
      }));

      const message: Record<string, unknown> = { role: 'assistant', content: content || null };
      if (hasToolCalls) {
        message['tool_calls'] = toolCallsArr;
      }

      const body = JSON.stringify({
        id: completionId,
        object: 'chat.completion',
        created,
        model: selectedModel.id,
        choices: [
          {
            index: 0,
            message,
            finish_reason: hasToolCalls ? 'tool_calls' : 'stop',
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    } catch (err) {
      if (isTimeout) {
        // 超时情况：返回 504（使用 TIMEOUT_MS 常量）
        sendError(res, 504, `请求超时（${TIMEOUT_MS / 1000}s）`, 'timeout_error', 'timeout');
      } else {
        const { status, type, code } = mapErrorToStatus(err);
        const message = err instanceof Error ? err.message : String(err);
        sendError(res, status, message, type, code);
      }
    } finally {
      clearTimeout(timeoutHandle);
      cancellation.dispose();
    }
  }
}
