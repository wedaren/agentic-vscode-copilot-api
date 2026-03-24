/**
 * handlers/proxy.ts
 * 内存后端注册表 + /internal/register 和 /internal/unregister 端点
 * 支持多 workspace 实例注册，通过 round-robin 轮询分配请求
 */

import * as http from 'node:http';

/** 后端实例信息 */
interface BackendInfo {
  workspace: string;
  registeredAt: number; // Date.now()
  port: number;
}

/** 内存注册表：Map<port, BackendInfo> */
const backendRegistry: Map<number, BackendInfo> = new Map();

/** 轮询游标 */
let roundRobinIndex = 0;

/**
 * 注册本地后端实例
 */
export function registerLocal(port: number, workspace: string): void {
  backendRegistry.set(port, { workspace, registeredAt: Date.now(), port });
}

/**
 * 注销本地后端实例
 */
export function unregisterLocal(port: number): void {
  backendRegistry.delete(port);
  // 重置游标，防止越界
  if (roundRobinIndex >= backendRegistry.size) {
    roundRobinIndex = 0;
  }
}

/**
 * 获取所有已注册的后端列表
 */
export function getBackends(): BackendInfo[] {
  return Array.from(backendRegistry.values());
}

/**
 * Round-robin 选择后端，无可用实例时返回 undefined
 */
export function pickBackend(): BackendInfo | undefined {
  const backends = getBackends();
  if (backends.length === 0) {
    return undefined;
  }
  // 保证游标在有效范围内
  roundRobinIndex = roundRobinIndex % backends.length;
  const backend = backends[roundRobinIndex];
  roundRobinIndex = (roundRobinIndex + 1) % backends.length;
  return backend;
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
 * POST /internal/register
 * 请求体：{ port: number, workspace: string }
 * 返回：200 + { ok: true }
 */
export async function handleRegister(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const raw = await readBody(req);
  let port: number;
  let workspace: string;
  try {
    const body = JSON.parse(raw) as { port: unknown; workspace: unknown };
    port = Number(body.port);
    workspace = String(body.workspace ?? '');
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error('port 无效');
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: msg, type: 'invalid_request', code: 'bad_request' } }));
    return;
  }
  registerLocal(port, workspace);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

/**
 * POST /internal/unregister
 * 请求体：{ port: number }
 * 返回：200 + { ok: true }
 */
export async function handleUnregister(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const raw = await readBody(req);
  let port: number;
  try {
    const body = JSON.parse(raw) as { port: unknown };
    port = Number(body.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error('port 无效');
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: msg, type: 'invalid_request', code: 'bad_request' } }));
    return;
  }
  unregisterLocal(port);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}
