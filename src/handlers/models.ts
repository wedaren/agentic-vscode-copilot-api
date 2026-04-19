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

    // 读取允许的模型配置（来自用户主目录配置文件，空数组或未配置表示允许所有）
    const allowed = require('../config').getAllowedModels();
    const filtered = Array.isArray(allowed) && allowed.length > 0 ? models.filter((m) => allowed.includes(m.id)) : models;

    const data = filtered.map((m) => ({
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

/**
 * 处理 GET /v1/models/:model 请求
 * 返回单个模型信息，不存在时返回 404
 */
export async function handleModelById(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const modelId = decodeURIComponent((req.url ?? '').replace('/v1/models/', ''));
  try {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    const found = models.find((m) => m.id === modelId);
    if (!found) {
      const body = JSON.stringify({
        error: { message: `模型 ${modelId} 不存在`, type: 'not_found_error', code: 'model_not_found' },
      });
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }
    const body = JSON.stringify({
      id: found.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'copilot',
    });
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
