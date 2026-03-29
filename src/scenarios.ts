/**
 * scenarios.ts
 * 场景执行逻辑：向本地 HTTP 服务发送测试请求，将结果输出到 OutputChannel
 */

import * as http from 'http';
import * as vscode from 'vscode';
import * as cfg from './config';

/** 场景元数据（用于日志展示） */
export const SCENARIOS: Array<{ id: string; label: string; description: string }> = [
  { id: 'list-models', label: '获取模型列表', description: 'GET /v1/models' },
  { id: 'chat-nonstream', label: '非流式对话', description: 'POST /v1/chat/completions (stream:false)' },
  { id: 'chat-stream', label: '流式对话', description: 'POST /v1/chat/completions (stream:true)' },
];

/** 场景标签元数据（仅用于内部映射） */
const SCENARIO_META: Record<string, { label: string }> = {
  'list-models':    { label: '获取模型列表' },
  'chat-nonstream': { label: '非流式对话' },
  'chat-stream':    { label: '流式对话' },
};

/**
 * 执行指定场景，向本地 HTTP 服务发送真实请求，结果输出到 OutputChannel
 * @param scenarioId  场景 ID：'list-models' | 'chat-nonstream' | 'chat-stream'
 * @param port        本地服务监听端口
 * @param outputChannel VS Code OutputChannel 实例
 */
/**
 * 执行指定场景，向本地 HTTP 服务发送真实请求或在模拟模式下返回模拟结果
 * @returns 是否成功（true 成功，false 失败）
 */
export async function runScenario(
  scenarioId: string,
  port: number,
  outputChannel: vscode.OutputChannel,
  simulate: boolean = false
): Promise<boolean> {
  const label = SCENARIO_META[scenarioId]?.label ?? scenarioId;

  // 根据场景 ID 确定请求方法、路径和请求体
  let method: string;
  let path: string;
  let body: string | undefined;
  let isStream: boolean = false;
  // 默认模型从 VS Code 用户设置读取，若未配置则回退到 gpt-5-mini（用于本地/演示）
  const defaultModel = vscode.workspace.getConfiguration('copilotApi').get<string>('defaultModel') ?? 'gpt-5-mini';

  switch (scenarioId) {
    case 'list-models':
      method = 'GET';
      path = '/v1/models';
      break;
    case 'chat-nonstream':
      method = 'POST';
      path = '/v1/chat/completions';
      body = JSON.stringify({
        model: defaultModel,
        messages: [{ role: 'user', content: 'Hello! 简单介绍一下你自己。' }],
        stream: false,
      });
      break;
    case 'chat-stream':
      method = 'POST';
      path = '/v1/chat/completions';
      isStream = true;
      body = JSON.stringify({
        model: defaultModel,
        messages: [{ role: 'user', content: '你好，用一句话介绍你自己。' }],
        stream: true,
      });
      break;
    default:
      outputChannel.appendLine(`未知场景 ID: ${scenarioId}`);
      return false;
  }

  // 格式化当前时间
  const now = new Date();
  const timeStr = now.toISOString().replace('T', ' ').substring(0, 19);
  const separator = '─────────────────────────────────────────────';

  outputChannel.appendLine(`─── 执行场景: ${label} ───────────────────`);
  outputChannel.appendLine(`时间: ${timeStr}`);
  outputChannel.appendLine(`请求: ${method} http://127.0.0.1:${port}${path}`);

  const startTs = Date.now();

  if (simulate) {
    // 模拟执行：延迟并随机决定成功或失败（可视化演示用）
    const delay = 300 + Math.floor(Math.random() * 800);
    await new Promise((r) => setTimeout(r, delay));
    const success = Math.random() < 0.9; // 90% 成功率
    const elapsed = Date.now() - startTs;
    if (success) {
      outputChannel.appendLine(`状态: 200 OK (耗时: ${elapsed}ms)`);
      outputChannel.appendLine('响应摘要: 模拟成功');
    } else {
      outputChannel.appendLine(`  错误 (耗时: ${elapsed}ms): 模拟后端错误`);
    }
    outputChannel.appendLine(separator);
    return success;
  }

  try {
    const result = await makeRequest(method, port, path, body, isStream);
    const elapsed = Date.now() - startTs;

    outputChannel.appendLine(
      `状态: ${result.statusCode} ${result.statusMessage} (耗时: ${elapsed}ms)`
    );
    outputChannel.appendLine('响应摘要:');

    if (isStream) {
      // 流式场景：统计收到的 SSE 行数
      outputChannel.appendLine(`  收到 SSE 行数: ${result.sseLines}`);
    } else {
      // 非流式：截取最多 300 字符的响应摘要
      const summary =
        result.responseText.length > 300
          ? result.responseText.substring(0, 300) + '...'
          : result.responseText;
      outputChannel.appendLine(`  ${summary}`);
    }

    outputChannel.appendLine(separator);
    // HTTP 状态码 2xx 视为成功
    return result.statusCode >= 200 && result.statusCode < 300;
  } catch (err) {
    const elapsed = Date.now() - startTs;
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`  错误 (耗时: ${elapsed}ms): ${msg}`);
    outputChannel.appendLine(separator);
    return false;
  }
}

/** makeRequest 返回结果 */
interface RequestResult {
  statusCode: number;
  statusMessage: string;
  responseText: string;
  /** 流式场景：收到的 SSE data 行数 */
  sseLines: number;
}

/**
 * 向本地 HTTP 服务发送请求（最多等待 10 秒）
 */
function makeRequest(
  method: string,
  port: number,
  path: string,
  body: string | undefined,
  isStream: boolean
): Promise<RequestResult> {
  return new Promise<RequestResult>((resolve, reject) => {
    const headers: http.OutgoingHttpHeaders = {
      'Content-Type': 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers,
    };

    const req = http.request(options, (res) => {
      const statusCode = res.statusCode ?? 0;
      const statusMessage = res.statusMessage ?? '';

      let rawData = '';
      let sseLines = 0;

      res.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        rawData += text;
        if (isStream) {
          // 统计以 "data: " 开头的 SSE 行
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              sseLines++;
            }
          }
        }
      });

      res.on('end', () => {
        resolve({ statusCode, statusMessage, responseText: rawData, sseLines });
      });

      res.on('error', (e: Error) => reject(e));
    });

    // 客户端超时：与服务器超时一致，设为 120 秒
    req.setTimeout(120000, () => {
      req.destroy(new Error('请求超时（120 秒）'));
    });

    req.on('error', (e: Error) => reject(e));

    if (body !== undefined) {
      req.write(body);
    }

    req.end();
  });
}
