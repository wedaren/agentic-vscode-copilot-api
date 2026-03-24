/**
 * server.ts
 * 内嵌 HTTP 服务器：创建 Node.js http 服务器，处理 CORS，将请求分发到路由层
 * 只监听 127.0.0.1，不对外暴露
 */

import * as http from 'http';
import { route } from './router';

/** 服务器实例（单例） */
let server: http.Server | undefined;

/** 当前活跃请求数（并发限制用） */
let activeRequests = 0;
/** 最大并发请求数 */
const MAX_CONCURRENT_REQUESTS = 10;

/**
 * 启动 HTTP 服务器，监听指定端口（仅 127.0.0.1）
 */
export function startServer(port: number): Promise<void> {
  // 防止未捕获的 Promise rejection 导致 Extension Host 崩溃
  // 使用标志位确保只注册一次，避免重复注册
  if (!(process as NodeJS.Process & { _copilotApiHandlersRegistered?: boolean })._copilotApiHandlersRegistered) {
    (process as NodeJS.Process & { _copilotApiHandlersRegistered?: boolean })._copilotApiHandlersRegistered = true;
    process.on('unhandledRejection', (reason) => {
      console.error('[Copilot API] 未处理的 Promise rejection:', reason);
    });
    process.on('uncaughtException', (err) => {
      console.error('[Copilot API] 未捕获的异常:', err);
    });
  }

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      // 统一添加 CORS 头，允许浏览器客户端调用
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      // OPTIONS 预检请求直接返回 204
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // 并发限制：超过上限返回 503
      if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
        const body = JSON.stringify({
          error: { message: '服务繁忙，请稍后重试', type: 'rate_limit_error', code: 'concurrent_limit' },
        });
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }
      activeRequests++;
      // 防止 finish 和 close 双重减少
      let decremented = false;
      const decrement = () => { if (!decremented) { decremented = true; activeRequests--; } };
      res.on('finish', decrement);
      res.on('close', () => { if (!res.writableEnded) { decrement(); } });

      // 路由分发（异步，捕获未处理异常）
      route(req, res).catch((err: unknown) => {
        if (!res.headersSent) {
          const message = err instanceof Error ? err.message : String(err);
          const body = JSON.stringify({
            error: { message, type: 'server_error', code: 'internal_error' },
          });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(body);
        }
      });
    });

    server.listen(port, '127.0.0.1', () => {
      resolve();
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * 停止 HTTP 服务器
 */
export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        server = undefined;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
