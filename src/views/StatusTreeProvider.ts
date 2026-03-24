/**
 * StatusTreeProvider.ts
 * VS Code Activity Bar 侧边栏 TreeView：展示 Copilot API 服务器运行状态（运行中/已停止/端口信息）及模拟场景列表
 */

import * as vscode from 'vscode';

/** 树节点类型标识 */
type NodeKind = 'root' | 'detail' | 'scenario-group' | 'scenario';

/** 内置模拟场景定义 */
const SCENARIOS = [
  { id: 'list-models',    label: '获取模型列表',  description: 'GET /v1/models' },
  { id: 'chat-nonstream', label: '非流式对话',    description: 'POST /v1/chat/completions (stream:false)' },
  { id: 'chat-stream',    label: '流式对话',      description: 'POST /v1/chat/completions (stream:true)' },
];

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
  private _port = 11435;

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

  getTreeItem(element: StatusTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: StatusTreeItem): StatusTreeItem[] {
    if (!element) {
      // 顶层：服务状态根节点 + 模拟场景根节点（并列）
      const statusLabel = this._isRunning ? '● 服务状态' : '○ 服务状态';
      const statusRoot = new StatusTreeItem(
        statusLabel,
        vscode.TreeItemCollapsibleState.Expanded,
        'root'
      );
      statusRoot.description = this._isRunning ? '运行中' : '已停止';

      const scenarioGroup = new StatusTreeItem(
        '模拟场景',
        vscode.TreeItemCollapsibleState.Expanded,
        'scenario-group'
      );

      return [statusRoot, scenarioGroup];
    }

    if (element.kind === 'root') {
      // 子节点：端口、地址、接口信息
      return [
        new StatusTreeItem(
          `端口：${this._port}`,
          vscode.TreeItemCollapsibleState.None,
          'detail'
        ),
        new StatusTreeItem(
          '地址：127.0.0.1',
          vscode.TreeItemCollapsibleState.None,
          'detail'
        ),
        new StatusTreeItem(
          '接口：/v1/models, /v1/chat/completions',
          vscode.TreeItemCollapsibleState.None,
          'detail'
        ),
      ];
    }

    if (element.kind === 'scenario-group') {
      // 子节点：各模拟场景
      return SCENARIOS.map((s) => {
        const item = new StatusTreeItem(
          s.label,
          vscode.TreeItemCollapsibleState.None,
          'scenario',
          s.id
        );
        item.description = s.description;
        // 场景节点的 contextValue 用于 menus when 表达式匹配
        item.contextValue = 'scenario';
        // 播放图标
        item.iconPath = new vscode.ThemeIcon('play-circle');
        // 点击节点时执行 runScenario 命令，传入 item 本身
        item.command = {
          command: 'copilotApi.runScenario',
          title: '执行场景',
          arguments: [item],
        };
        return item;
      });
    }

    return [];
  }
}
