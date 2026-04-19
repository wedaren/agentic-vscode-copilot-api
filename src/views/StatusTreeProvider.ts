/**
 * StatusTreeProvider.ts
 * VS Code Activity Bar 侧边栏 TreeView：展示 Copilot API 服务器运行状态（运行中/已停止/端口信息）及模拟场景列表
 */

import * as vscode from 'vscode';
import { SCENARIOS } from '../scenarios';
import * as cfg from '../config';

/** 树节点类型标识 */
type NodeKind = 'root' | 'detail' | 'scenario-group' | 'scenario' | 'action' | 'model-group' | 'model';

/** 场景状态 */
type ScenarioStatus = 'idle' | 'running' | 'success' | 'failure';

/** 单个树节点 */
export class StatusTreeItem extends vscode.TreeItem {
  /** 场景 ID（仅 kind === 'scenario' 时有值） */
  public readonly scenarioId?: string;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: NodeKind,
    scenarioId?: string
  ) {
    super(label, collapsibleState);
    this.scenarioId = scenarioId;
  }
}

/** 服务状态 TreeDataProvider，实现 Activity Bar 侧边栏视图 */
export class StatusTreeProvider implements vscode.TreeDataProvider<StatusTreeItem> {
  /** 数据变化事件发射器，触发 TreeView 刷新 */
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<StatusTreeItem | undefined>();

  /** TreeDataProvider 必须暴露的只读事件 */
  readonly onDidChangeTreeData: vscode.Event<StatusTreeItem | undefined> =
    this._onDidChangeTreeData.event;

  /** 当前服务运行状态 */
  private _isRunning = false;
  /** 当前服务监听端口 */
  private _port = cfg.DEFAULT_PORT;
  /** 各场景当前执行状态（idle/running/success/failure） */
  private _scenarioStatuses: Record<string, ScenarioStatus> = {};
  /** 缓存的模型列表（用于在直接调用 selectChatModels 失败时回退显示/选择） */
  private _cachedModels: Array<{ id: string; label: string }> = [];

  /**
   * 更新服务状态并刷新 TreeView
   * @param isRunning 服务是否正在运行
   * @param port 服务监听端口
   */
  update(isRunning: boolean, port: number): void {
    this._isRunning = isRunning;
    this._port = port;
    this._onDidChangeTreeData.fire(undefined);
  }

  /** 更新单个场景状态并刷新视图 */
  setScenarioStatus(scenarioId: string, status: ScenarioStatus): void {
    this._scenarioStatuses[scenarioId] = status;
    this._onDidChangeTreeData.fire(undefined);
  }

  /** 重置所有场景状态为 idle */
  resetScenarioStatuses(): void {
    for (const s of SCENARIOS) {
      this._scenarioStatuses[s.id] = 'idle';
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  /** 刷新 TreeView（用于外部调用） */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: StatusTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: StatusTreeItem): Promise<StatusTreeItem[]> {
    if (!element) {
      // 顶层：先放置配置快捷入口，然后服务状态、模拟场景、模型管理
      const configureRoot = new StatusTreeItem('配置允许的模型', vscode.TreeItemCollapsibleState.None, 'action');
      configureRoot.iconPath = new vscode.ThemeIcon('gear');
      configureRoot.command = { command: 'copilotApi.configureModels', title: '配置允许的模型' };

      const statusLabel = '服务状态';
      const statusRoot = new StatusTreeItem(
        statusLabel,
        vscode.TreeItemCollapsibleState.Expanded,
        'root'
      );
      statusRoot.description = this._isRunning ? '运行中' : '已停止';
      // 使用图标并据状态着色：运行=绿色，已停止=红色
      statusRoot.iconPath = this._isRunning
        ? new vscode.ThemeIcon('circle-large', new vscode.ThemeColor('terminal.ansiGreen'))
        : new vscode.ThemeIcon('circle-large-outline', new vscode.ThemeColor('terminal.ansiRed'));

      const scenarioGroup = new StatusTreeItem(
        '模拟场景',
        vscode.TreeItemCollapsibleState.Expanded,
        'scenario-group'
      );

      const modelGroup = new StatusTreeItem(
        '模型管理',
        vscode.TreeItemCollapsibleState.Collapsed,
        'model-group'
      );

      return [configureRoot, statusRoot, scenarioGroup, modelGroup];
    }

    if (element.kind === 'root') {
      // 子节点：端口、地址（可点击复制）、接口信息
      const urlItem = new StatusTreeItem(
        `http://127.0.0.1:${this._port}`,
        vscode.TreeItemCollapsibleState.None,
        'detail'
      );
      urlItem.iconPath = new vscode.ThemeIcon('copy');
      urlItem.tooltip = '点击复制服务地址';
      urlItem.contextValue = 'url';
      urlItem.command = {
        command: 'copilotApi.copyUrl',
        title: '复制服务地址',
      };
      return [
        new StatusTreeItem(
          `端口：${this._port}`,
          vscode.TreeItemCollapsibleState.None,
          'detail'
        ),
        urlItem,
        new StatusTreeItem(
          '接口：/v1/models, /v1/chat/completions',
          vscode.TreeItemCollapsibleState.None,
          'detail'
        ),
      ];
    }

    if (element.kind === 'scenario-group') {
      // 子节点：播放全部 + 各模拟场景
      const playAll = new StatusTreeItem(
        '播放全部',
        vscode.TreeItemCollapsibleState.None,
        'action'
      );
      playAll.iconPath = new vscode.ThemeIcon('play');
      playAll.command = {
        command: 'copilotApi.runAllScenarios',
        title: '播放全部',
      };

        const items = SCENARIOS.map((s) => {
        const status = this._scenarioStatuses[s.id] ?? 'idle';
        const item = new StatusTreeItem(
          s.label,
          vscode.TreeItemCollapsibleState.None,
          'scenario',
          s.id
        );
        item.description = s.description;
        item.contextValue = 'scenario';
        // 根据场景状态选择图标与颜色：运行=黄（同步/转动），成功=绿，失败=红，空闲=播放图标（简化为图标而非前缀 emoji）
        if (status === 'running') {
          item.iconPath = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('terminal.ansiYellow'));
        } else if (status === 'success') {
          item.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('terminal.ansiGreen'));
        } else if (status === 'failure') {
          item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('terminal.ansiRed'));
        } else {
          item.iconPath = new vscode.ThemeIcon('play-circle');
        }
        item.command = {
          command: 'copilotApi.runScenario',
          title: '执行场景',
          arguments: [item],
        };
        return item;
      });

      return [playAll, ...items];
    }

    if (element.kind === 'model-group') {
      // 顶部操作：配置 + 刷新
      const configure = new StatusTreeItem('配置允许的模型', vscode.TreeItemCollapsibleState.None, 'action');
      configure.iconPath = new vscode.ThemeIcon('gear');
      configure.command = { command: 'copilotApi.configureModels', title: '配置允许的模型' };

      const refresh = new StatusTreeItem('刷新模型列表', vscode.TreeItemCollapsibleState.None, 'action');
      refresh.iconPath = new vscode.ThemeIcon('refresh');
      refresh.command = { command: 'copilotApi.refreshModels', title: '刷新模型列表' };

      // 拉取模型列表（copilot 可能未授权）——展示全部模型，并在已允许模型上显示勾选图标，点击即可切换允许状态
      try {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        // 更新缓存（仅保存 id 与 label）
        this._cachedModels = models.map((m) => ({ id: m.id, label: m.id }));
        const allowed = cfg.getAllowedModels();

        // 排序规则：
        // 1) `gpt-5-mini` 始终排第一
        // 2) 分组优先级：gpt* -> claude* -> gemini* -> 其它
        // 3) 在同一组内，优先显示已允许的模型
        // 4) 最后按 id 字母序
        const groupPriority = (id: string) => {
          if (id === 'gpt-5-mini') return 0;
          if (/^gpt/i.test(id)) return 1;
          if (/^claude/i.test(id)) return 2;
          if (/^gemini/i.test(id)) return 3;
          return 4;
        };
        const sorted = models.slice().sort((a, b) => {
          const ga = groupPriority(a.id);
          const gb = groupPriority(b.id);
          if (ga !== gb) return ga - gb;

          const aAllowed = Array.isArray(allowed) && allowed.includes(a.id);
          const bAllowed = Array.isArray(allowed) && allowed.includes(b.id);
          if (aAllowed !== bAllowed) return aAllowed ? -1 : 1;

          return a.id.localeCompare(b.id);
        });

        // 默认模型从 VS Code 用户设置读取（如果未配置则为 undefined）
        const defaultModel = vscode.workspace.getConfiguration('copilotApi').get<string>('defaultModel');
        const modelItems = sorted.map((m) => {
          const allowedFlag = Array.isArray(allowed) && allowed.includes(m.id);
          const isDefault = defaultModel === m.id;
          const item = new StatusTreeItem(m.id, vscode.TreeItemCollapsibleState.None, 'model');
          // 如果是默认模型，在描述位置标注“默认”以便视觉识别；否则不额外描述
          item.description = isDefault ? '默认' : '';
          item.contextValue = 'model';
          // 优先用星形标识默认模型；否则用勾选/空圈表示是否允许
          if (isDefault) {
            item.iconPath = new vscode.ThemeIcon('star', new vscode.ThemeColor('terminal.ansiYellow'));
          } else {
            item.iconPath = allowedFlag
              ? new vscode.ThemeIcon('check', new vscode.ThemeColor('terminal.ansiGreen'))
              : new vscode.ThemeIcon('circle-large-outline');
          }
          // 不在 treeitem 上绑定点击命令，避免误触；通过右键或 inline 操作进行配置
          // tooltip 提示可通过右键或行内操作配置
          item.tooltip = (allowedFlag ? '已允许，右键或行内操作可取消' : '未允许，右键或行内操作可允许') + (isDefault ? '（当前默认）' : ' — 右键或行内操作可设为默认模型');
          return item;
        });

        if (modelItems.length === 0) {
          return [refresh, new StatusTreeItem('无可用模型（未授权或列表为空）', vscode.TreeItemCollapsibleState.None, 'detail')];
        }

        return [refresh, ...modelItems];
      } catch (e) {
        return [refresh, new StatusTreeItem('无法获取模型（可能未登录 Copilot）', vscode.TreeItemCollapsibleState.None, 'detail')];
      }
    }

    return [];
  }

  /** 返回当前缓存的模型列表（只读副本） */
  getCachedModels(): Array<{ id: string; label: string }> {
    return this._cachedModels.slice();
  }

}
