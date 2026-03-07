import * as vscode from "vscode";
import { IniIndexManager } from "../indexManager";
import { StatisticsTreeDataProvider } from "../utils/statisticsView";
import { TranslationLoader } from "../utils/translationLoader";

interface RegisterBasicCommandsDeps {
    checkDuplicateDefinitions: (document: vscode.TextDocument) => void;
    translationLoader: TranslationLoader;
    outputChannel: vscode.OutputChannel;
    statisticsTreeProvider: StatisticsTreeDataProvider;
    indexManager: IniIndexManager;
}

export function registerBasicCommands(
    context: vscode.ExtensionContext,
    deps: RegisterBasicCommandsDeps
): void {
    const {
        checkDuplicateDefinitions,
        translationLoader,
        outputChannel,
        statisticsTreeProvider,
        indexManager,
    } = deps;

    context.subscriptions.push(
        vscode.commands.registerCommand("ini-ra2.checkDuplicates", () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === "ini") {
                checkDuplicateDefinitions(editor.document);
                vscode.window.showInformationMessage("INI 重复检测已完成");
            } else {
                vscode.window.showWarningMessage("请在 INI 文件中运行此命令");
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("ini.reloadTranslations", () => {
            try {
                translationLoader.reload();
                outputChannel.appendLine("词典重新加载成功");
                vscode.window.showInformationMessage("INI 词典已重新加载");
            } catch (error) {
                outputChannel.appendLine(`重新加载词典失败: ${error}`);
                vscode.window.showErrorMessage(`重新加载词典失败: ${error}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("ini.formatDocument", async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === "ini") {
                await vscode.commands.executeCommand("editor.action.formatDocument");
            } else {
                vscode.window.showWarningMessage("请在 INI 文件中运行此命令");
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("ini-ra2.rebuildIndex", async () => {
            const enableMultiFile = vscode.workspace
                .getConfiguration("ini-ra2")
                .get<boolean>("enableMultiFileSearch", false);

            if (!enableMultiFile) {
                vscode.window.showInformationMessage(
                    "多文件搜索未启用，请在设置中启用 ini-ra2.enableMultiFileSearch"
                );
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "正在重建 INI 文件索引...",
                    cancellable: false,
                },
                async () => {
                    indexManager.clear();
                    await indexManager.indexWorkspace();
                    vscode.window.showInformationMessage("INI 文件索引已重建");
                }
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("ini-ra2.showStatistics", async () => {
            await vscode.commands.executeCommand("iniStatistics.focus");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("ini-ra2.refreshStatistics", async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === "ini") {
                await statisticsTreeProvider.refresh(editor.document);
                vscode.window.showInformationMessage("统计信息已刷新");
            }
        })
    );
}
