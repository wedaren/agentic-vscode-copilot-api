/**
 * handlers/models.ts
 * 处理 GET /v1/models 请求，返回 vscode.lm 可用模型列表（OpenAI 格式）
 */

import * as http from 'http';
import * as vscode from 'vscode';

/**
 * 处理 GET /v1/models 请求
 * 调用 vscode.lm.selectChatModels 获取可用模型，Copilot 未激活时返回空列表
 */
export async function handleModels(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    // 获取所有 Copilot 模型，未登录时返回空数组
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });

    const data = models.map((m) => ({
      id: m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'copilot',
    }));

    const body = JSON.stringify({ object: 'list', data });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const body = JSON.stringify({
      error: { message, type: 'server_error', code: 'internal_error' },
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(body);
  }
}
