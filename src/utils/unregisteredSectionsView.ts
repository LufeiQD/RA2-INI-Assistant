import * as vscode from "vscode";
import { RegisterHelper } from "./registerHelper";

class UnregisteredSectionItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    public readonly sectionName?: string
  ) {
    super(label, collapsibleState);
  }
}

export class UnregisteredSectionsProvider
  implements vscode.TreeDataProvider<UnregisteredSectionItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    UnregisteredSectionItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private unregistered: Array<{ name: string; comment?: string }> = [];

  constructor(private registerHelper: RegisterHelper) {}

  async refresh(): Promise<void> {
    const allSections = await this.registerHelper.getAllDefinedSectionsGlobal();
    const registered = this.registerHelper.getRegisteredSectionsGlobal();

    this.unregistered = allSections
      .filter((s) => !registered.has(s.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: UnregisteredSectionItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: UnregisteredSectionItem): Promise<UnregisteredSectionItem[]> {
    if (!element) {
      const top: UnregisteredSectionItem[] = [];
      const batch = new UnregisteredSectionItem(`Batch register (${this.unregistered.length})`);
      batch.iconPath = new vscode.ThemeIcon("sparkle");
      batch.command = {
        command: "ini-ra2.registerAllUnregisteredSections",
        title: "Batch register",
      };
      top.push(batch);

      for (const section of this.unregistered) {
        const item = new UnregisteredSectionItem(section.name, vscode.TreeItemCollapsibleState.None, section.name);
        item.description = section.comment ? section.comment.slice(0, 40) : "";
        item.tooltip = section.comment ? `${section.name}\n${section.comment}` : section.name;
        item.iconPath = new vscode.ThemeIcon("symbol-class");
        item.command = {
          command: "ini-ra2.quickRegisterSectionByName",
          title: "Register section",
          arguments: [section.name],
        };
        top.push(item);
      }

      return top;
    }

    return [];
  }
}
