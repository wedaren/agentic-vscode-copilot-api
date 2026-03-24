/**
 * extension.ts
 * VS Code 扩展入口：插件激活/停用时管理 HTTP 服务器生命周期，注册命令
 */

import * as vscode from 'vscode';
import * as http from 'http';
import { startServer, stopServer, findAvailablePort } from './server';
import { setLocalPort } from './router';
import { registerLocal, unregisterLocal } from './handlers/proxy';
import { StatusTreeProvider } from './views/StatusTreeProvider';
import { runScenario } from './scenarios';

/** 当前活跃端口（deactivate 时需要引用） */
let _activePort = 0;
/** 配置的基础端口（用于判断是否为主实例） */
let _configuredPort = 11435;

/**
 * 向主实例注册当前服务（非主实例调用）
 * 失败时静默忽略，不阻塞主流程
 */
function registerToMaster(port: number, workspace: string): void {
  const body = JSON.stringify({ port, workspace });
  const req = http.request(
    {
      hostname: '127.0.0.1',
      port: 11435,
      path: '/internal/register',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (res) => { res.resume(); }
  );
  req.on('error', () => { /* 静默处理：主实例未启动等情况 */ });
  req.end(body);
}

/**
 * 向主实例注销当前服务（非主实例调用）
 * 失败时静默忽略，不阻塞主流程
 */
function unregisterFromMaster(port: number): void {
  const body = JSON.stringify({ port });
  const req = http.request(
    {
      hostname: '127.0.0.1',
      port: 11435,
      path: '/internal/unregister',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (res) => { res.resume(); }
  );
  req.on('error', () => { /* 静默处理 */ });
  req.end(body);
}

/**
 * 插件激活入口（onStartupFinished 触发）
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // 从 VS Code 配置中读取端口，默认 11435
  const port = vscode.workspace
    .getConfiguration('copilotApi')
    .get<number>('port', 11435);

  // 实际使用的端口（端口冲突时自动递增，stop 命令通过闭包引用）
  let actualPort = port;

  // 创建专用 OutputChannel，用于展示场景执行结果
  const outputChannel = vscode.window.createOutputChannel('Copilot API');
  context.subscriptions.push(outputChannel);

  // 创建 TreeView 数据提供者并注册侧边栏视图
  const provider = new StatusTreeProvider();
  const treeView = vscode.window.createTreeView('copilotApi.statusView', {
    treeDataProvider: provider,
  });
  context.subscriptions.push(treeView);

  try {
    // 探测可用端口（端口冲突时自动递增）
    actualPort = await findAvailablePort(port);
    if (actualPort !== port) {
      vscode.window.showInformationMessage(
        `端口 ${port} 已被占用，Copilot API 服务已自动切换到端口 ${actualPort}`
      );
    }
    await startServer(actualPort);
    // 将实际端口注入路由层，防止 round-robin 代理到自身造成死循环
    setLocalPort(actualPort);
    // 记录活跃端口（deactivate/stop 时需要用到）
    _activePort = actualPort;
    _configuredPort = port;
    // 注册到注册表：主实例直接写内存，非主实例 HTTP POST 到主实例
    const workspaceName = vscode.workspace.name ?? 'unknown';
    if (actualPort === port) {
      registerLocal(actualPort, workspaceName);
    } else {
      registerToMaster(actualPort, workspaceName);
    }
    // 服务启动成功，更新 TreeView 状态
    provider.update(true, actualPort);
    vscode.window.showInformationMessage(
      `Copilot API 服务器已启动，监听 127.0.0.1:${actualPort}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Copilot API 服务器启动失败：${message}`);
  }

  // 注册启动命令
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotApi.start', async () => {
      const cfg = vscode.workspace
        .getConfiguration('copilotApi')
        .get<number>('port', 11435);
      try {
        // 探测可用端口（端口冲突时自动递增）
        const cfgActualPort = await findAvailablePort(cfg);
        if (cfgActualPort !== cfg) {
          vscode.window.showInformationMessage(
            `端口 ${cfg} 已被占用，Copilot API 服务已自动切换到端口 ${cfgActualPort}`
          );
        }
        await startServer(cfgActualPort);
        // 将实际端口注入路由层，防止 round-robin 代理到自身造成死循环
        setLocalPort(cfgActualPort);
        // 更新闭包引用，确保 stop 命令使用最新端口
        actualPort = cfgActualPort;
        // 记录活跃端口并注册到注册表
        _activePort = cfgActualPort;
        _configuredPort = cfg;
        const startCmdWorkspace = vscode.workspace.name ?? 'unknown';
        if (cfgActualPort === cfg) {
          registerLocal(cfgActualPort, startCmdWorkspace);
        } else {
          registerToMaster(cfgActualPort, startCmdWorkspace);
        }
        provider.update(true, cfgActualPort);
        vscode.window.showInformationMessage(
          `Copilot API 服务器已启动，监听 127.0.0.1:${cfgActualPort}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`启动失败：${msg}`);
      }
    })
  );

  // 注册停止命令
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotApi.stop', async () => {
      // 停止前先注销（主实例直接写内存，非主实例 POST 到主实例）
      if (_activePort > 0) {
        if (_activePort === _configuredPort) {
          unregisterLocal(_activePort);
        } else {
          unregisterFromMaster(_activePort);
        }
        _activePort = 0;
      }
      await stopServer();
      // 使用 actualPort（反映实际启动端口，可能与配置端口不同）
      provider.update(false, actualPort);
      vscode.window.showInformationMessage('Copilot API 服务器已停止');
    })
  );

  // 注册场景执行命令：向本地 HTTP 服务发送真实请求并将结果输出到 OutputChannel
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'copilotApi.runScenario',
      async (item: import('./views/StatusTreeProvider').StatusTreeItem) => {
        const scenarioId = item?.scenarioId ?? String(item);
        // 实时读取配置端口，避免使用闭包捕获的旧值
        const currentPort = vscode.workspace
          .getConfiguration('copilotApi')
          .get<number>('port', 11435);
        // 展示 OutputChannel（不抢夺编辑器焦点）
        outputChannel.show(true);
        await runScenario(scenarioId, currentPort, outputChannel);
      }
    )
  );
}

/**
 * 插件停用时注销并停止服务器
 */
export async function deactivate(): Promise<void> {
  // fire-and-forget：注销不阻塞停用流程
  if (_activePort > 0) {
    if (_activePort === _configuredPort) {
      unregisterLocal(_activePort);
    } else {
      unregisterFromMaster(_activePort);
    }
    _activePort = 0;
  }
  await stopServer();
}
