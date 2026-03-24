/**
 * extension.ts
 * VS Code 扩展入口：插件激活/停用时管理 HTTP 服务器生命周期，注册命令
 */

import * as vscode from 'vscode';
import { startServer, stopServer } from './server';
import { StatusTreeProvider } from './views/StatusTreeProvider';

/**
 * 插件激活入口（onStartupFinished 触发）
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // 从 VS Code 配置中读取端口，默认 11435
  const port = vscode.workspace
    .getConfiguration('copilotApi')
    .get<number>('port', 11435);

  // 创建 TreeView 数据提供者并注册侧边栏视图
  const provider = new StatusTreeProvider();
  const treeView = vscode.window.createTreeView('copilotApi.statusView', {
    treeDataProvider: provider,
  });
  context.subscriptions.push(treeView);

  try {
    await startServer(port);
    // 服务启动成功，更新 TreeView 状态
    provider.update(true, port);
    vscode.window.showInformationMessage(
      `Copilot API 服务器已启动，监听 127.0.0.1:${port}`
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
        await startServer(cfg);
        provider.update(true, cfg);
        vscode.window.showInformationMessage(
          `Copilot API 服务器已启动，监听 127.0.0.1:${cfg}`
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
      await stopServer();
      provider.update(false, port);
      vscode.window.showInformationMessage('Copilot API 服务器已停止');
    })
  );

  // 注册场景执行命令（Placeholder：后续迭代实现真实请求）
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'copilotApi.runScenario',
      (item: import('./views/StatusTreeProvider').StatusTreeItem) => {
        const id = item?.scenarioId ?? String(item);
        vscode.window.showInformationMessage(`即将执行场景: ${id}`);
      }
    )
  );
}

/**
 * 插件停用时停止服务器
 */
export async function deactivate(): Promise<void> {
  await stopServer();
}
