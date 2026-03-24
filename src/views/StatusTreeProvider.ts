/**
 * StatusTreeProvider.ts
 * VS Code Activity Bar 侧边栏 TreeView：展示 Copilot API 服务器运行状态（运行中/已停止/端口信息）
 */

import * as vscode from 'vscode';

/** 树节点类型标识 */
type NodeKind = 'root' | 'detail';

/** 单个树节点 */
export class StatusTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: NodeKind
  ) {
    super(label, collapsibleState);
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
      // 返回根节点：服务状态（运行中用实心圆，已停止用空心圆）
      const label = this._isRunning ? '● 服务状态' : '○ 服务状态';
      const root = new StatusTreeItem(
        label,
        vscode.TreeItemCollapsibleState.Expanded,
        'root'
      );
      root.description = this._isRunning ? '运行中' : '已停止';
      return [root];
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

    return [];
  }
}
