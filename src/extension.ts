/**
 * extension.ts
 * VS Code 扩展入口：插件激活/停用时管理 HTTP 服务器生命周期，注册命令
 *
 * 优化：默认不再自动启动服务器，避免每开一个 VS Code 窗口就多占用一个端口。
 * 用户通过 TreeView 的启动/停止按钮显式控制服务生命周期。
 * 启动时会探测端口：若已有同扩展的服务在运行，则提示用户并避免重复启动。
 */

import * as vscode from 'vscode';
import * as http from 'http';
import { startServer, stopServer, findAvailablePort, getActivePort, API_VERSION } from './server';
import { StatusTreeProvider } from './views/StatusTreeProvider';
import { runScenario, SCENARIOS } from './scenarios';
import * as cfg from './config';

/** 当前活跃端口（由本窗口启动的服务器） */
let _activePort = 0;
/** 标记当前窗口是否为服务的实际提供者 */
let _isLocalServer = false;

/**
 * 解析配置端口（开发模式下优先使用环境变量 COPILOT_API_PORT）
 */
function resolveConfiguredPort(context: vscode.ExtensionContext): number {
  const cfgPort = cfg.getPort();
  const envVal = process.env.COPILOT_API_PORT;
  if (context.extensionMode === vscode.ExtensionMode.Development && envVal) {
    const envPort = Number(envVal);
    if (Number.isInteger(envPort) && envPort > 0 && envPort <= 65535) {
      return envPort;
    }
  }
  return cfgPort;
}

/**
 * 探测指定端口是否已有 Copilot API 服务在运行
 * @returns 如果是本扩展提供的服务，返回 true；否则返回 false
 */
function probeExistingService(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/v1/models`,
      { timeout: 1500 },
      (res) => {
        const version = res.headers['x-copilot-api-version'];
        resolve(version === API_VERSION);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * 插件激活入口（onStartupFinished 触发）
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const port = resolveConfiguredPort(context);
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
  // 初始化场景状态为 idle
  provider.resetScenarioStatuses();

  // 初始化 TreeView 上下文变量（控制标题栏按钮显隐）
  vscode.commands.executeCommand('setContext', 'copilotApi.localRunning', false);

  // 激活时不自动启动服务器，但探测一次是否已有其他窗口在提供服务
  const alreadyRunning = await probeExistingService(port);
  if (alreadyRunning) {
    provider.updateRemote(port);
    vscode.window.showInformationMessage(
      `检测到 Copilot API 服务已在端口 ${port} 运行（由其他 VS Code 窗口提供）`
    );
  } else {
    provider.update(false, 0);
  }

  // 辅助：从命令参数中解析模型 ID（接受 string 或 TreeItem）
  const resolveModelId = (arg: unknown): string | undefined => {
    if (typeof arg === 'string') return arg;
    if (!arg || typeof arg !== 'object') return undefined;
    const anyArg = arg as any;
    if (typeof anyArg.label === 'string') return anyArg.label;
    if (typeof anyArg.id === 'string') return anyArg.id;
    if (typeof anyArg.description === 'string' && anyArg.description.length > 0) return anyArg.description;
    return undefined;
  };

  // 注册启动命令
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotApi.start', async () => {
      // 若本窗口已在运行，直接返回
      if (_isLocalServer && getActivePort() > 0) {
        vscode.window.showInformationMessage(
          `Copilot API 服务已由本窗口运行在 127.0.0.1:${getActivePort()}`
        );
        return;
      }

      const cfgPort = resolveConfiguredPort(context);

      // 先探测目标端口是否已有同扩展服务
      const occupiedByUs = await probeExistingService(cfgPort);
      if (occupiedByUs) {
        const choice = await vscode.window.showWarningMessage(
          `端口 ${cfgPort} 已有 Copilot API 服务在运行（由其他 VS Code 窗口提供），是否仍要启动新服务？`,
          { modal: false },
          '仍要启动',
          '取消'
        );
        if (choice !== '仍要启动') {
          provider.updateRemote(cfgPort);
          return;
        }
      }

      try {
        // 探测可用端口（端口冲突时自动递增）
        const newPort = await findAvailablePort(cfgPort);
        if (newPort !== cfgPort) {
          vscode.window.showInformationMessage(
            `端口 ${cfgPort} 已被占用，Copilot API 服务已自动切换到端口 ${newPort}`
          );
        }
        await startServer(newPort);
        _activePort = newPort;
        _isLocalServer = true;
        actualPort = newPort;
        vscode.commands.executeCommand('setContext', 'copilotApi.localRunning', true);
        provider.update(true, newPort);
        vscode.window.showInformationMessage(
          `Copilot API 服务器已启动，监听 127.0.0.1:${newPort}`
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
      if (!_isLocalServer) {
        // 若服务由其他窗口提供，仅重置本地状态提示
        const p = provider.getRemotePort() || cfg.getPort();
        provider.update(false, 0);
        vscode.window.showInformationMessage(
          `已断开对端口 ${p} 的关注（服务仍由其他窗口运行，可通过该窗口停止）`
        );
        return;
      }
      _activePort = 0;
      _isLocalServer = false;
      await stopServer();
      vscode.commands.executeCommand('setContext', 'copilotApi.localRunning', false);
      provider.update(false, 0);
      vscode.window.showInformationMessage('Copilot API 服务器已停止');
    })
  );

  // 注册场景执行命令：向本地 HTTP 服务发送真实请求并将结果输出到 OutputChannel
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'copilotApi.runScenario',
      async (item: import('./views/StatusTreeProvider').StatusTreeItem) => {
        const scenarioId = item?.scenarioId ?? String(item);
        // 使用当前实际端口：本窗口提供则取 activePort，否则取配置端口（或远程端口）
        const currentPort = _isLocalServer ? getActivePort() : (provider.getRemotePort() || cfg.getPort());
        provider.setScenarioStatus(scenarioId, 'running');
        outputChannel.show(true);
        const ok = await runScenario(scenarioId, currentPort, outputChannel);
        provider.setScenarioStatus(scenarioId, ok ? 'success' : 'failure');
      }
    )
  );

  // 注册播放全部场景命令（顺序执行，更新 TreeView 状态）
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotApi.runAllScenarios', async () => {
      const currentPort = _isLocalServer ? getActivePort() : (provider.getRemotePort() || cfg.getPort());
      outputChannel.show(true);
      provider.resetScenarioStatuses();
      for (const s of SCENARIOS) {
        provider.setScenarioStatus(s.id, 'running');
        const ok = await runScenario(s.id, currentPort, outputChannel);
        provider.setScenarioStatus(s.id, ok ? 'success' : 'failure');
        // 小间隔，视觉上更明显
        await new Promise((r) => setTimeout(r, 200));
      }
    })
  );

  // 添加复制服务地址命令
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotApi.copyUrl', async () => {
      const url = `http://127.0.0.1:${actualPort}`;
      await vscode.env.clipboard.writeText(url);
      vscode.window.showInformationMessage(`已复制：${url}`);
    })
  );

  // 注册刷新模型列表命令（触发 TreeView 刷新）
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotApi.refreshModels', async () => {
      provider.refresh();
      vscode.window.showInformationMessage('已刷新模型列表');
    })
  );

  // 注册配置允许模型命令：使用 QuickPick 多选更新配置
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotApi.configureModels', async () => {
      try {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        const items = models.map((m) => ({ label: m.id, picked: false }));
        const qp = await vscode.window.showQuickPick(items, { canPickMany: true, ignoreFocusOut: true, title: '选择允许的模型（空表示允许所有）' });
        if (!qp) { return; }
        const chosen = qp.map((i) => i.label);
        await cfg.setAllowedModels(chosen);
        provider.refresh();
        vscode.window.showInformationMessage(`已写入配置文件: ${cfg.CONFIG_PATH}`);
      } catch (e) {
        // 尝试使用 TreeView 缓存的模型回退（避免在 UI 已显示模型时仍弹出错误）
        const cached = (provider as any).getCachedModels ? (provider as any).getCachedModels() as Array<{id:string,label:string}> : [];
        if (cached && cached.length > 0) {
          const items = cached.map((m) => ({ label: m.label, picked: false }));
          const qp = await vscode.window.showQuickPick(items, { canPickMany: true, ignoreFocusOut: true, title: '使用缓存模型列表（可能不完整），选择允许的模型' });
          if (!qp) { return; }
          const chosen = qp.map((i) => i.label);
          await cfg.setAllowedModels(chosen);
          provider.refresh();
          vscode.window.showInformationMessage(`已使用缓存模型写入配置文件: ${cfg.CONFIG_PATH}`);
          return;
        }

        vscode.window.showErrorMessage('无法获取模型列表：请确认 Copilot 已登录');
      }
    })
  );

  // 切换单个模型允许状态（在 TreeView 点击模型项时触发）
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotApi.toggleModelAllowed', async (arg: unknown) => {
      try {
        const modelId = resolveModelId(arg);
        if (!modelId) {
          vscode.window.showErrorMessage('无法解析模型 ID');
          return;
        }
        const cur = cfg.getAllowedModels();
        const next = Array.isArray(cur) ? cur.slice() : [];
        const idx = next.indexOf(modelId);
        if (idx >= 0) {
          next.splice(idx, 1);
        } else {
          next.push(modelId);
        }
        await cfg.setAllowedModels(next);
        provider.refresh();
        vscode.window.showInformationMessage(`${modelId} 已 ${idx >= 0 ? '移除' : '加入'} 允许列表（配置文件: ${cfg.CONFIG_PATH}）`);
      } catch (e) {
        vscode.window.showErrorMessage('更新配置失败');
      }
    })
  );

  // 设置/取消默认模型（右键菜单触发）
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotApi.setDefaultModel', async (arg: unknown) => {
      try {
        const modelId = resolveModelId(arg);
        if (!modelId) {
          vscode.window.showErrorMessage('无法解析模型 ID');
          return;
        }
        // 使用 VS Code 用户设置存储 defaultModel（仅用于本地/演示回退），写入全局用户设置
        const conf = vscode.workspace.getConfiguration('copilotApi');
        const cur = conf.get<string>('defaultModel');
        if (cur === modelId) {
          await conf.update('defaultModel', undefined, vscode.ConfigurationTarget.Global);
          provider.refresh();
          vscode.window.showInformationMessage(`${modelId} 已从默认模型中移除（已写入用户设置）`);
        } else {
          await conf.update('defaultModel', modelId, vscode.ConfigurationTarget.Global);
          // 同步到 allowedModels（确保本地演示时可用）
          const curAllowed = cfg.getAllowedModels();
          if (!Array.isArray(curAllowed) || curAllowed.indexOf(modelId) === -1) {
            const next = Array.isArray(curAllowed) ? curAllowed.slice() : [];
            next.push(modelId);
            await cfg.setAllowedModels(next);
          }
          provider.refresh();
          vscode.window.showInformationMessage(`${modelId} 已设置为默认模型（已写入用户设置，并加入 allowedModels）`);
        }
      } catch (e) {
        vscode.window.showErrorMessage('设置默认模型失败');
      }
    })
  );
}

/**
 * 插件停用时注销并停止服务器
 */
export async function deactivate(): Promise<void> {
  if (_isLocalServer) {
    _activePort = 0;
    _isLocalServer = false;
    await stopServer();
  }
}
