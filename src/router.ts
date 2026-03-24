/**
 * router.ts
 * 路由分发层：根据请求方法和路径将请求分发到对应的 handler
 * 当注册表有可用后端时，优先将 /v1/* 请求代理到后端（round-robin），支持流式透传
 */

import * as http from 'http';
import { handleModels } from './handlers/models';
import { handleChat } from './handlers/chat';
import { handleRegister, handleUnregister, pickBackend, unregisterLocal } from './handlers/proxy';

/** 当前服务实际监听端口（由 extension.ts 在启动后注入，用于避免代理到自身） */
let localPort = 0;

/**
 * 设置当前服务实际监听端口
 * 必须在服务启动后由 extension.ts 调用，防止 round-robin 选到自身造成无限循环
 */
export function setLocalPort(port: number): void {
  localPort = port;
}

/**
 * 将请求代理到目标端口，支持流式响应（SSE）透传
 * 目标不可达时（ECONNREFUSED / ECONNRESET）：从注册表移除并尝试下一个后端；
 * 无可用后端时返回 503
 */
function proxyToBackend(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  targetPort: number
): void {
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: targetPort,
      path: req.url ?? '/',
      method: req.method ?? 'GET',
      // 透传原始请求头（含 Authorization、Content-Type 等）
      headers: req.headers,
    },
    (proxyRes) => {
      // 透传响应状态码和全部响应头（保留 SSE 的 Content-Type 等）
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      // 流式透传响应体，支持 SSE data: 分块
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err: NodeJS.ErrnoException) => {
    // 后端不可达：注销该端口，尝试下一个可用后端
    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
      unregisterLocal(targetPort);
      const next = pickBackend();
      // 跳过自身端口，避免循环
      if (next && next.port !== localPort) {
        // 递归代理到下一个后端（ECONNREFUSED 在 TCP 握手阶段触发，req body 尚未被消费）
        proxyToBackend(req, res, next.port);
        return;
      }
    }
    // 无可用后端或其他错误，返回 503
    if (!res.headersSent) {
      const body503 = JSON.stringify({
        error: { message: '暂无可用后端，请稍后重试', type: 'service_unavailable', code: 'no_backend' },
      });
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(body503);
    }
  });

  // 透传请求体（GET 无 body，pipe 会立即结束；POST 透传完整 body）
  req.pipe(proxyReq);
}

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
    // 优先代理到注册表中的可用后端（跳过自身端口）
    const backend = pickBackend();
    if (backend && backend.port !== localPort) {
      proxyToBackend(req, res, backend.port);
      return;
    }
    await handleModels(req, res);
    return;
  }

  // POST /v1/chat/completions
  if (method === 'POST' && url === '/v1/chat/completions') {
    // 优先代理到注册表中的可用后端（跳过自身端口）
    const backend = pickBackend();
    if (backend && backend.port !== localPort) {
      proxyToBackend(req, res, backend.port);
      return;
    }
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
