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
import { runScenario, SCENARIOS } from './scenarios';
import * as cfg from './config';

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
      // 使用配置的注册端口，避免硬编码 11435（支持开发时通过 COPILOT_API_PORT 覆盖）
      port: _configuredPort,
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
      // 使用配置的注册端口，不要硬编码
      port: _configuredPort,
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
  // 解析配置端口：在开发模式下优先使用环境变量 COPILOT_API_PORT（便于 dev 与已安装版本隔离）
  const resolveConfiguredPort = (): number => {
    const cfgPort = cfg.getPort();
    const envVal = process.env.COPILOT_API_PORT;
    if (context.extensionMode === vscode.ExtensionMode.Development && envVal) {
      const envPort = Number(envVal);
      if (Number.isInteger(envPort) && envPort > 0 && envPort <= 65535) {
        return envPort;
      }
    }
    return cfgPort;
  };

  // 使用解析后的配置端口（开发模式下可能被 COPILOT_API_PORT 覆盖）
  const port = resolveConfiguredPort();
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
      // start 命令同样使用解析逻辑，开发模式下尊重 COPILOT_API_PORT
      const cfg = resolveConfiguredPort();
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
        // 使用同样的解析逻辑确定当前配置端口
        const currentPort = resolveConfiguredPort();
        // 是否以模拟模式执行（读取配置文件）
        const simulate = cfg.getSimulate();
        // 更新状态并展示 OutputChannel
        provider.setScenarioStatus(scenarioId, 'running');
        outputChannel.show(true);
        const ok = await runScenario(scenarioId, currentPort, outputChannel, simulate);
        provider.setScenarioStatus(scenarioId, ok ? 'success' : 'failure');
      }
    )
  );

  // 注册播放全部场景命令（顺序执行，更新 TreeView 状态）
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotApi.runAllScenarios', async () => {
      const currentPort = resolveConfiguredPort();
      const simulate = cfg.getSimulate();
      outputChannel.show(true);
      provider.resetScenarioStatuses();
      for (const s of SCENARIOS) {
        provider.setScenarioStatus(s.id, 'running');
        const ok = await runScenario(s.id, currentPort, outputChannel, simulate);
        provider.setScenarioStatus(s.id, ok ? 'success' : 'failure');
        // 小间隔，视觉上更明显
        await new Promise((r) => setTimeout(r, 200));
      }
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
