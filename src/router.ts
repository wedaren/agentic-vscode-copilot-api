/**
 * router.ts
 * 路由分发层：根据请求方法和路径将请求分发到对应的 handler
 */

import * as http from 'http';
import { handleModels } from './handlers/models';
import { handleChat } from './handlers/chat';
import { handleRegister, handleUnregister } from './handlers/proxy';

/**
 * 路由分发：将请求转发到对应的 handler
 * 未匹配的路由返回 404
 */
export async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  // GET /v1/models
  if (method === 'GET' && url === '/v1/models') {
    await handleModels(req, res);
    return;
  }

  // POST /v1/chat/completions
  if (method === 'POST' && url === '/v1/chat/completions') {
    await handleChat(req, res);
    return;
  }

  // POST /internal/register — 注册后端实例
  if (method === 'POST' && url === '/internal/register') {
    await handleRegister(req, res);
    return;
  }

  // POST /internal/unregister — 注销后端实例
  if (method === 'POST' && url === '/internal/unregister') {
    await handleUnregister(req, res);
    return;
  }

  // 404 兜底
  const body = JSON.stringify({
    error: {
      message: `路由 ${method} ${url} 不存在`,
      type: 'not_found_error',
      code: 'route_not_found',
    },
  });
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(body);
}
