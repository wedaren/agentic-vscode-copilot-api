/**
 * extension.ts
 * VS Code 扩展入口：插件激活/停用时管理 HTTP 服务器生命周期，注册命令
 */

import * as vscode from 'vscode';
import { startServer, stopServer, findAvailablePort } from './server';
import { StatusTreeProvider } from './views/StatusTreeProvider';
import { runScenario } from './scenarios';

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
        // 更新闭包引用，确保 stop 命令使用最新端口
        actualPort = cfgActualPort;
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
 * 插件停用时停止服务器
 */
export async function deactivate(): Promise<void> {
  await stopServer();
}
