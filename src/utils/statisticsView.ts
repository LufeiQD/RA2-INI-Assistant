/**
 * 侧边栏统计信息 Tree View 提供程序
 */

import * as vscode from "vscode";
import { StatisticsCollector, FileStatistics, WorkspaceStatistics } from "./statisticsCollector";

export class StatisticsTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    public data?: any
  ) {
    super(label, collapsibleState);
  }
}

export class StatisticsTreeDataProvider
  implements vscode.TreeDataProvider<StatisticsTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    StatisticsTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private collector: StatisticsCollector;
  private currentFileStats: FileStatistics | null = null;
  private workspaceStats: WorkspaceStatistics | null = null;
  private currentDocument: vscode.TextDocument | null = null;

  constructor(collector: StatisticsCollector) {
    this.collector = collector;
  }

  async refresh(document?: vscode.TextDocument) {
    if (document && document.languageId === "ini") {
      this.currentDocument = document;
      this.currentFileStats = await this.collector.collectFileStatistics(document);
    }
    this.workspaceStats = await this.collector.collectWorkspaceStatistics();
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: StatisticsTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(
    element?: StatisticsTreeItem
  ): Promise<StatisticsTreeItem[]> {
    if (!element) {
      // 根节点
      return this.getRootChildren();
    }

    // 子节点
    if (element.label === "📄 当前文件统计") {
      return this.getFileStatChildren();
    } else if (element.label === "🌍 工作区统计") {
      return this.getWorkspaceStatChildren();
    } else if (
      element.label?.toString().includes("重复的键") ||
      element.label?.toString().includes("无效引用")
    ) {
      return this.getDetailChildren(element);
    }

    return [];
  }

  private getRootChildren(): StatisticsTreeItem[] {
    const children: StatisticsTreeItem[] = [];

    // 当前文件统计
    if (this.currentDocument) {
      children.push(
        new StatisticsTreeItem(
          "📄 当前文件统计",
          vscode.TreeItemCollapsibleState.Expanded
        )
      );
    } else {
      children.push(
        new StatisticsTreeItem(
          "📄 当前文件统计 (未打开 INI 文件)",
          vscode.TreeItemCollapsibleState.None
        )
      );
    }

    // 工作区统计
    children.push(
      new StatisticsTreeItem(
        "🌍 工作区统计",
        vscode.TreeItemCollapsibleState.Expanded
      )
    );

    return children;
  }

  private getFileStatChildren(): StatisticsTreeItem[] {
    if (!this.currentFileStats) {
      return [new StatisticsTreeItem("加载中...", vscode.TreeItemCollapsibleState.None)];
    }

    const stats = this.currentFileStats;
    const children: StatisticsTreeItem[] = [];

    const filePath = this.currentDocument?.fileName || "未知文件";
    const fileName = filePath.split("\\").pop() || filePath;

    children.push(
      new StatisticsTreeItem(`📋 文件: ${fileName}`, vscode.TreeItemCollapsibleState.None)
    );

    children.push(
      new StatisticsTreeItem(
        `📦 总节数: ${stats.totalSections}`,
        vscode.TreeItemCollapsibleState.None
      )
    );

    children.push(
      new StatisticsTreeItem(
        `🔑 总键数: ${stats.totalKeys}`,
        vscode.TreeItemCollapsibleState.None
      )
    );

    // 重复定义的键
    if (stats.duplicateKeys > 0) {
      const dupItem = new StatisticsTreeItem(
        `⚠️  重复的键: ${stats.duplicateKeys}`,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      dupItem.iconPath = new vscode.ThemeIcon("warning");
      dupItem.data = { type: "duplicates", list: stats.duplicateList };
      children.push(dupItem);
    } else {
      children.push(
        new StatisticsTreeItem(
          `✅ 重复的键: 0`,
          vscode.TreeItemCollapsibleState.None
        )
      );
    }

    return children;
  }

  private getWorkspaceStatChildren(): StatisticsTreeItem[] {
    if (!this.workspaceStats) {
      return [new StatisticsTreeItem("加载中...", vscode.TreeItemCollapsibleState.None)];
    }

    const stats = this.workspaceStats;
    const children: StatisticsTreeItem[] = [];

    children.push(
      new StatisticsTreeItem(
        `📁 总文件数: ${stats.totalFiles}`,
        vscode.TreeItemCollapsibleState.None
      )
    );

    children.push(
      new StatisticsTreeItem(
        `📦 总节数: ${stats.totalSections}`,
        vscode.TreeItemCollapsibleState.None
      )
    );

    // 节类型分布
    const typeItem = new StatisticsTreeItem(
      "📊 节类型分布",
      vscode.TreeItemCollapsibleState.Collapsed
    );
    typeItem.data = { type: "type-distribution", map: stats.sectionsByType };
    children.push(typeItem);

    return children;
  }

  private getDetailChildren(parent: StatisticsTreeItem): StatisticsTreeItem[] {
    const children: StatisticsTreeItem[] = [];
    const data = parent.data;

    if (data?.type === "duplicates") {
      for (const item of data.list) {
        const linesStr = item.lines.join(", ");
        children.push(
          new StatisticsTreeItem(
            `${item.key} (第 ${linesStr} 行)`,
            vscode.TreeItemCollapsibleState.None
          )
        );
      }
    } else if (data?.type === "invalid-refs") {
      for (const item of data.list) {
        children.push(
          new StatisticsTreeItem(
            `${item.key}=${item.value} (第 ${item.line} 行)`,
            vscode.TreeItemCollapsibleState.None
          )
        );
      }
    } else if (data?.type === "type-distribution") {
      const map = data.map as Map<string, number>;
      for (const [type, count] of map) {
        children.push(
          new StatisticsTreeItem(
            `${type}: ${count}`,
            vscode.TreeItemCollapsibleState.None
          )
        );
      }
    }

    return children;
  }
}
