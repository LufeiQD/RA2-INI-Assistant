/**
 * @name RA2-INI-Assistant 红警2.ini适用的一款简单的插件
 * @description 红警2.ini适用的插件，辅助各地图作者编写ini配置，这可能不适用于大型mod；
 * 词库可能会有遗漏或者错误，欢迎在战网作者群联系原作者补充或者修改；
 * 插件文档请查看README.md文件
 * @author 橙猫猫三天睡不着(qq:183354595)
 * @note 作者声明：本插件为简易工具，仅作辅助编写使用，由于第一次写vscode插件，可能存在其他问题，如有问题请联系作者反馈
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

// 导入模块化的组件
import { Translations } from "./types";
import { IniIndexManager } from "./indexManager";
import { TranslationLoader } from "./utils/translationLoader";
import { setupDiagnostics } from "./utils/diagnostics";
import { TypeInference } from "./utils/typeInference";
import { showIniReferenceQuickPick, preloadIniReference, batchRenameKeysCommand } from "./utils/iniReference";
import { StatisticsCollector } from "./utils/statisticsCollector";
import { StatisticsTreeDataProvider } from "./utils/statisticsView";
import { AutoRenameDetector } from "./utils/autoRenameDetector";
import { RegisterHelper } from "./utils/registerHelper";
import { IniSectionCodeLensProvider } from "./utils/sectionCodeLens";
import { UnregisteredSectionsProvider } from "./utils/unregisteredSectionsView";
import { parseSectionHeader } from "./utils/sectionUtils";


// 诊断收集器
let diagnosticCollection: vscode.DiagnosticCollection;
// 输出通道
let outputChannel: vscode.OutputChannel;
// 索引管理器
let indexManager: IniIndexManager;
// 类型推断器
let typeInference: TypeInference;
// 统计收集器
let statisticsCollector: StatisticsCollector;
// 统计 Tree View 提供程序
let statisticsTreeProvider: StatisticsTreeDataProvider;
let unregisteredSectionsProvider: UnregisteredSectionsProvider;
// 状态栏统计项
let statusBarStatistics: vscode.StatusBarItem;
// 作用域装饰类型
let scopeDecorationTypes: Map<number, vscode.TextEditorDecorationType> = new Map();
// 自动重命名检测实例（用于命令化重命名和提供器）
let autoRenameDetectorInstance: AutoRenameDetector | undefined;
// 注册表辅助实例
let registerHelper: RegisterHelper;

/**
 * 创建彩色作用域装饰线
 * @param index 节的索引，用于生成不同的颜色
 */
function getScopeDecorationType(index: number): vscode.TextEditorDecorationType {
  if (scopeDecorationTypes.has(index)) {
    return scopeDecorationTypes.get(index)!;
  }

  // 生成彩虹色列表
  const colors = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8",
    "#F7DC6F", "#BB8FCE", "#85C1E2", "#F8B88B", "#ABEBC6",
    "#F5A9BC", "#85D4F0", "#F9E79F", "#D5A6BD", "#A2D5C6"
  ];

  const color = colors[index % colors.length];
  const decorationType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    light: {
      backgroundColor: `${color}0C`
    },
    dark: {
      backgroundColor: `${color}1A`
    },
    overviewRulerColor: color,
    overviewRulerLane: vscode.OverviewRulerLane.Left
  });

  scopeDecorationTypes.set(index, decorationType);
  return decorationType;
}

/**
 * 更新文档的作用域装饰
 */
function updateScopeDecorations(editor: vscode.TextEditor) {
  const document = editor.document;
  if (document.languageId !== "ini") {
    return;
  }

  // 检查是否启用作用域装饰
  const enableScopeDecorations = vscode.workspace
    .getConfiguration("ini-ra2")
    .get<boolean>("enableScopeDecorations", true);

  // 不再在每次调用时全部清空，避免闪烁

  if (!enableScopeDecorations) {
    return;
  }

  const sectionRanges: Map<number, vscode.Range[]> = new Map();
  let currentSectionIndex = -1;
  let sectionStartLine = -1;
  let foundAnySection = false;

  for (let i = 0; i < document.lineCount; i++) {
    const line = document.lineAt(i);
    const text = line.text.trim();

    // 检测节头 [SECTION] - 允许节名后面跟空白和注释，支持继承语法 [name]:[parent]
    if (text.match(/^\[[^\]]+\](\s*(;|#|\/).*)?$/)) {
      foundAnySection = true;
      currentSectionIndex++;
      sectionStartLine = i;

      // 将节头本身也添加到装饰范围
      if (!sectionRanges.has(currentSectionIndex)) {
        sectionRanges.set(currentSectionIndex, []);
      }
      sectionRanges.get(currentSectionIndex)!.push(line.range);
    }
    // 只有在找到了节头之后，才对后续行添加装饰
    else if (foundAnySection && currentSectionIndex >= 0 && sectionStartLine >= 0) {
      // 如果遇到不完整的节头或下一个节头，停止当前节的着色
      if (text.startsWith("[")) {
        // 检查是否是不完整的节名（缺少闭括号）
        if (!text.includes("]")) {
          // 不完整的节名，不开始新节，继续当前节
          continue;
        }
        // 这是一个新的完整节头，但不在顶层if中匹配到，说明格式有问题
        continue;
      }

      if (!sectionRanges.has(currentSectionIndex)) {
        sectionRanges.set(currentSectionIndex, []);
      }
      sectionRanges.get(currentSectionIndex)!.push(line.range);
    }
  }

  // 应用装饰：只更新变化的索引，并清除不再存在的索引，避免闪烁
  const presentIndices = new Set<number>();
  sectionRanges.forEach((ranges, index) => {
    presentIndices.add(index);
    const decorationType = getScopeDecorationType(index);
    editor.setDecorations(decorationType, ranges);
  });

  // 清理不再存在的装饰索引
  scopeDecorationTypes.forEach((decorationType, index) => {
    if (!presentIndices.has(index)) {
      editor.setDecorations(decorationType, []);
    }
  });
}

function getMinimapSectionHeaderSettings() {
  const config = vscode.workspace.getConfiguration("ini-ra2");
  return {
    region: config.get<boolean>("minimapRegionSectionHeaders", false),
    mark: config.get<boolean>("minimapMarkSectionHeaders", true),
  };
}

async function syncIniMinimapSectionHeaderSettings(): Promise<void> {
  const { region, mark } = getMinimapSectionHeaderSettings();
  const editorConfig = vscode.workspace.getConfiguration();
  const iniOverrides = editorConfig.get<Record<string, unknown>>("[ini]") ?? {};

  if (
    iniOverrides["editor.minimap.showRegionSectionHeaders"] === region &&
    iniOverrides["editor.minimap.showMarkSectionHeaders"] === mark
  ) {
    return;
  }

  const nextIniOverrides: Record<string, unknown> = {
    ...iniOverrides,
    "editor.minimap.showRegionSectionHeaders": region,
    "editor.minimap.showMarkSectionHeaders": mark,
  };

  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;

  await editorConfig.update("[ini]", nextIniOverrides, target);
}

export function activate(context: vscode.ExtensionContext) {
  // 创建输出通道
  outputChannel = vscode.window.createOutputChannel("RA2 INI Assistant");
  context.subscriptions.push(outputChannel);
  syncIniMinimapSectionHeaderSettings().catch((error) => {
    outputChannel.appendLine(`[Settings] Failed to sync minimap section header settings: ${error}`);
  });
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("ini-ra2.minimapRegionSectionHeaders") ||
        event.affectsConfiguration("ini-ra2.minimapMarkSectionHeaders")
      ) {
        syncIniMinimapSectionHeaderSettings().catch((error) => {
          outputChannel.appendLine(`[Settings] Failed to sync minimap section header settings: ${error}`);
        });
      }
    })
  );
  outputChannel.appendLine("INI RA2扩展已激活");

  // 初始化索引管理器
  indexManager = new IniIndexManager(outputChannel);

  // 检查是否启用多文件搜索
  const enableMultiFile = vscode.workspace
    .getConfiguration("ini-ra2")
    .get<boolean>("enableMultiFileSearch", true);

  let indexPromise: Promise<void> | undefined;

  if (enableMultiFile) {
    const relatedFiles = vscode.workspace
      .getConfiguration("ini-ra2")
      .get<string[]>("relatedFiles", []);
    outputChannel.appendLine(
      `多文件搜索已启用 - 白名单: ${relatedFiles.join(", ") || "所有文件"}`
    );
    // 异步索引工作区（不阻塞激活）
    indexPromise = indexManager.indexWorkspace().then(() => {
      outputChannel.appendLine("初始索引完成");
    });

    // 监听文件变化
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.languageId === "ini") {
          indexManager.updateFile(document.uri);
        }
      })
    );

    // 监听文件打开（当前打开的文件不受白名单限制）
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (document.languageId === "ini") {
          indexManager.updateFile(document.uri);
        }
      })
    );

    // 监听文件编辑，实时更新索引以支持即时代码补全
    let changeDebounce: NodeJS.Timeout | undefined;
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId === "ini") {
          // 防抖处理，避免频繁更新
          if (changeDebounce) {
            clearTimeout(changeDebounce);
          }
          changeDebounce = setTimeout(() => {
            indexManager.updateFile(event.document.uri);
          }, 200); // 200ms 防抖
        }
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidDeleteFiles((event) => {
        event.files.forEach(uri => indexManager.removeFile(uri));
      })
    );
  } else {
    outputChannel.appendLine("多文件搜索已禁用（仅当前文件）");
  }

  // 加载词典数据
  const translationLoader = new TranslationLoader(context.extensionPath, outputChannel);
  translationLoader.load();
  const translations = translationLoader.getTranslations();

  // 初始化类型推断器
  typeInference = new TypeInference(translations, indexManager);

  // 初始化注册表辅助工具
  registerHelper = new RegisterHelper(translations, indexManager, typeInference, outputChannel);

  // 初始化统计收集器和 Tree View
  statisticsCollector = new StatisticsCollector(indexManager, outputChannel);
  statisticsTreeProvider = new StatisticsTreeDataProvider(statisticsCollector);
  unregisteredSectionsProvider = new UnregisteredSectionsProvider(registerHelper);

  // 注册统计 Tree View
  const statisticsTreeView = vscode.window.createTreeView(
    "iniStatistics",
    { treeDataProvider: statisticsTreeProvider }
  );
  context.subscriptions.push(statisticsTreeView);

  const unregisteredTreeView = vscode.window.createTreeView(
    "iniUnregisteredSections",
    { treeDataProvider: unregisteredSectionsProvider }
  );
  context.subscriptions.push(unregisteredTreeView);

  // 初始化状态栏统计项
  statusBarStatistics = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarStatistics.command = "ini-ra2.showStatistics";
  context.subscriptions.push(statusBarStatistics);

  // 监听编辑器变化，更新统计信息
  const updateStatistics = async () => {
    const editor = vscode.window.activeTextEditor;
    await unregisteredSectionsProvider.refresh();
    if (editor && editor.document.languageId === "ini") {
      await statisticsTreeProvider.refresh(editor.document);
      const stats = await statisticsCollector.collectFileStatistics(editor.document);
      statusBarStatistics.text = `📊 ${stats.totalSections} 节 | ${stats.totalKeys} 键`;
      if (stats.duplicateKeys > 0 || stats.invalidReferences > 0) {
        statusBarStatistics.text += ` | ⚠️ ${stats.duplicateKeys + stats.invalidReferences}`;
      }
      statusBarStatistics.show();
    } else {
      statusBarStatistics.hide();
    }
  };

  // 初始化当前编辑器的统计
  updateStatistics();

  // 监听活动编辑器变化
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateStatistics)
  );

  // 监听文档变化
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === vscode.window.activeTextEditor?.document) {
        updateStatistics();
      }
    })
  );

  // 预加载 ARES 参考数据
  preloadIniReference().catch(err =>
    outputChannel.appendLine(`INI 参考数据预加载失败: ${err}`)
  );

  // 初始化自动重命名检测器（等待索引完成后启用）
  const config = vscode.workspace.getConfiguration('ini-ra2');
  const enableAutoRename = config.get<boolean>('enableAutoRename', true);
  const autoRenameTrigger = config.get<'idle' | 'save'>('autoRenameTrigger', 'save');
  let autoRenameInitTimer: NodeJS.Timeout | undefined;

  if (enableAutoRename) {
    if (enableMultiFile && indexPromise) {
      // 索引开始时显示进度消息，索引完成时自动关闭
      vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "正在初始化批量重命名...",
        cancellable: false
      }, async (progress) => {
        return indexPromise!; // 等待索引完成，消息自动关闭
      });

      // 索引完成后，延迟 3 秒启用检测器并显示初始化消息
      indexPromise.then(() => {
        autoRenameInitTimer = setTimeout(() => {
          const autoRenameDetector = new AutoRenameDetector(outputChannel, indexManager, autoRenameTrigger);
          autoRenameDetectorInstance = autoRenameDetector;
          autoRenameDetector.registerListeners(context);
          outputChannel.appendLine(`自动重命名检测已启用（触发方式：${autoRenameTrigger}）`);

          // 显示右下角初始化提示消息，3秒后自动关闭
          vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "✅ 批量重命名功能已初始化完成",
            cancellable: false
          }, async (progress) => {
            return new Promise(resolve => {
              setTimeout(() => {
                resolve(undefined);
              }, 3000);
            });
          });

          autoRenameInitTimer = undefined; // 清理引用
        }, 3000); // 延迟 3 秒，确保索引完全初始化
      });
    } else {
      // 未启用多文件索引，延迟 1 秒立即启用（给其他初始化流程时间）
      autoRenameInitTimer = setTimeout(() => {
        const autoRenameDetector = new AutoRenameDetector(outputChannel, indexManager, autoRenameTrigger);
        autoRenameDetectorInstance = autoRenameDetector;
        autoRenameDetector.registerListeners(context);
        outputChannel.appendLine(`自动重命名检测已启用（触发方式：${autoRenameTrigger}）`);

        // 显示右下角初始化提示消息，3秒后自动关闭
        vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: "✅ 批量重命名功能已初始化",
          cancellable: false
        }, async (progress) => {
          return new Promise(resolve => {
            setTimeout(() => {
              resolve(undefined);
            }, 3000);
          });
        });

        autoRenameInitTimer = undefined; // 清理引用
      }, 1000); // 延迟 1 秒
    }
  }

  // 注册清理函数：扩展停用时清除延时器
  context.subscriptions.push({
    dispose: () => {
      if (autoRenameInitTimer) {
        clearTimeout(autoRenameInitTimer);
        autoRenameInitTimer = undefined;
      }
    }
  });

  // ========== 代码补全 ==========
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    "ini",
    {
      provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
      ): vscode.ProviderResult<vscode.CompletionItem[]> {
        const line = document.lineAt(position.line);
        const lineText = line.text.substring(0, position.character);
        const trimmedLine = lineText.trim();

        // ========== 处理节名补全 [section ==========
        if (trimmedLine.startsWith("[")) {
          // 获取当前节名部分
          const bracketIndex = lineText.indexOf("[");
          const sectionPart = lineText.substring(bracketIndex + 1).trim();

          // 如果还没有关闭括号，提供节名补全
          if (!lineText.includes("]")) {
            const completionItems: vscode.CompletionItem[] = [];

            // 获取所有节名
            const enableMultiFile = vscode.workspace
              .getConfiguration("ini-ra2")
              .get<boolean>("enableMultiFileSearch", true);

            let allSections = new Set<string>();
            if (enableMultiFile) {
              allSections = indexManager.getAllSections();
            } else {
              // 从当前文件提取节名
              const text = document.getText();
              const lines = text.split("\n");
              for (const currentLine of lines) {
                const match = currentLine.trim().match(/^\[\s*([^:\]]+)\s*(\s*:\s*[^\]]+)?\s*\]/);
                if (match) {
                  allSections.add(match[1].trim());
                }
              }
            }

            // 为每个类型提供补全
            for (const [typeName, config] of Object.entries(translations.typeMapping)) {
              // 获取该类型的所有注册的节名
              const registerNames = config.registers;

              for (const registerName of registerNames) {
                const registeredSections = indexManager.getRegisteredValues(registerName);

                for (const sectionName of registeredSections) {
                  if (allSections.has(sectionName) && sectionName.toLowerCase().startsWith(sectionPart.toLowerCase())) {
                    const item = new vscode.CompletionItem(sectionName, vscode.CompletionItemKind.Class);

                    // 获取节的描述
                    const sectionDesc = translations.sections[sectionName] || `${typeName} 类型`;
                    let shortDesc = sectionDesc.split(/[。\n]/)[0].trim();
                    if (shortDesc.length > 40) {
                      shortDesc = shortDesc.substring(0, 40) + "...";
                    }

                    item.detail = `[${sectionName}] - ${typeName}`;
                    item.documentation = new vscode.MarkdownString(`**[${sectionName}]**\n\n${sectionDesc}`);
                    item.insertText = sectionName;
                    item.sortText = `0_${sectionName}`;

                    completionItems.push(item);
                  }
                }
              }
            }

            return completionItems;
          }

          return [];
        }

        // ========== 处理键名补全 ==========
        // 检查是否在节内且在等号前（即输入键名）
        const equalsIndex = lineText.indexOf("=");

        // 如果已经有等号，不提供补全
        if (equalsIndex !== -1) {
          return [];
        }

        // 检查当前行是否是注释或节名
        if (trimmedLine.startsWith(";") ||
          trimmedLine.startsWith("#") ||
          trimmedLine.startsWith("[")) {
          return [];
        }

        // 获取当前所在节，用于类型推断
        const currentSection = getCurrentSection(document, position.line);
        const sectionType = currentSection ? typeInference.inferSectionType(currentSection) : undefined;

        // 创建补全项
        const completionItems: vscode.CompletionItem[] = [];

        // 优先添加特定类型的补全项
        if (sectionType && translations.typeTranslations[sectionType]) {
          const typeTranslations = translations.typeTranslations[sectionType];
          for (const [key, description] of Object.entries(typeTranslations) as [string, string][]) {
            const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);

            // 提取第一句作为简短描述
            let shortDesc = description;
            const firstLine = description.split(/[。\n]/)[0].trim();
            if (firstLine && firstLine.length > 0) {
              shortDesc = firstLine.length > 40
                ? firstLine.substring(0, 40) + "..."
                : firstLine;
            }

            item.detail = `${shortDesc} [${sectionType}]`;
            item.documentation = new vscode.MarkdownString(description);
            item.insertText = `${key}=`;
            item.sortText = `0_${key}`; // 优先排序

            completionItems.push(item);
          }
        }

        // 然后添加通用的补全项
        for (const [key, description] of Object.entries(translations.common)) {
          // 如果已经在类型化补全中存在，跳过
          if (sectionType && translations.typeTranslations[sectionType] && translations.typeTranslations[sectionType][key]) {
            continue;
          }

          const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);

          // 提取第一句作为简短描述（右侧显示）
          let shortDesc = description;
          const firstLine = description.split(/[。\n]/)[0].trim();
          if (firstLine && firstLine.length > 0) {
            shortDesc = firstLine.length > 40
              ? firstLine.substring(0, 40) + "..."
              : firstLine;
          } else {
            shortDesc = description.length > 40
              ? description.substring(0, 40) + "..."
              : description;
          }

          item.detail = shortDesc;
          item.documentation = new vscode.MarkdownString(description);
          item.insertText = `${key}=`;
          item.sortText = `1_${key}`; // 次要排序

          completionItems.push(item);
        }

        return completionItems;
      },
    }
  );

  // ========== 注册表辅助补全 ==========
  const registerCompletionProvider = vscode.languages.registerCompletionItemProvider(
    "ini",
    {
      async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
      ): Promise<vscode.CompletionItem[]> {
        return await registerHelper.provideRegisterCompletions(document, position);
      },
    },
    "=",  // 触发字符：等号
    "+"   // 触发字符：加号（用于 +=）
  );

  // ========== 文档链接（为可跳转的值添加下划线样式） ==========
  // 检查用户是否启用了下划线功能
  const enableLinkUnderline = vscode.workspace
    .getConfiguration("ini-ra2")
    .get<boolean>("enableLinkUnderline", true);

  let linkProvider: vscode.Disposable | undefined;

  if (enableLinkUnderline) {
    linkProvider = vscode.languages.registerDocumentLinkProvider("ini", {
      provideDocumentLinks(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
      ): vscode.ProviderResult<vscode.DocumentLink[]> {
        const links: vscode.DocumentLink[] = [];
        const text = document.getText();
        const lines = text.split("\n");

        // 使用全局索引的所有节名（包括跨文件）
        const enableMultiFile = vscode.workspace
          .getConfiguration("ini-ra2")
          .get<boolean>("enableMultiFileSearch", true);

        // 读取是否启用跳转功能
        const enableJump = vscode.workspace
          .getConfiguration("ini-ra2")
          .get<boolean>("enableJumpToDefinition", true);

        const sectionNames = enableMultiFile
          ? indexManager.getAllSections()
          : new Set<string>();

        // 如果未启用跨文件或索引为空，则收集当前文件的节名
        if (sectionNames.size === 0) {
          for (const line of lines) {
            const trimmed = line.trim();
            const match = trimmed.match(/^\[\s*([^:\]]+)\s*(\s*:\s*[^\]]+)?\s*\]/);
            if (match) {
              sectionNames.add(match[1].trim());
            }
          }
        }

        // 查找键值对中的值是否为节名
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trim();

          // 跳过注释和节名
          if (trimmed.startsWith(";") ||
            trimmed.startsWith("#") ||
            trimmed.startsWith("[")) {
            continue;
          }

          const equalsIndex = line.indexOf("=");
          if (equalsIndex > 0) {
            const value = line.substring(equalsIndex + 1);

            // 移除注释
            let cleanValue = value;
            const commentIdx = Math.min(
              value.indexOf(";") >= 0 ? value.indexOf(";") : Infinity,
              value.indexOf("#") >= 0 ? value.indexOf("#") : Infinity
            );
            if (commentIdx < Infinity) {
              cleanValue = value.substring(0, commentIdx);
            }

            cleanValue = cleanValue.trim();

            // 处理逗号分隔的多个值
            const values = cleanValue.split(",").map(v => v.trim()).filter(v => v.length > 0);

            for (const value of values) {
              // 检查值是否为节名
              if (sectionNames.has(value)) {
                const startPos = line.indexOf(value, equalsIndex);
                if (startPos !== -1) {
                  const range = new vscode.Range(
                    new vscode.Position(i, startPos),
                    new vscode.Position(i, startPos + value.length)
                  );

                  // 创建链接，使用 # 作为 URI 的一部分
                  const link = new vscode.DocumentLink(
                    range,
                    vscode.Uri.parse(`command:editor.action.goToLocations?${encodeURIComponent(JSON.stringify([document.uri, range.start, []]))}`)
                  );
                  // 根据配置显示不同的 tooltip
                  link.tooltip = enableJump ? `跳转到 [${value}] 定义` : `查看 [${value}] 定义`;
                  links.push(link);
                }
              }
            }
          }
        }

        return links;
      },
    });
  }

  // ========== 跳转到定义 ==========
  const definitionProvider = vscode.languages.registerDefinitionProvider("ini", {
    async provideDefinition(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken
    ): Promise<vscode.Definition | null> {
      const line = document.lineAt(position.line);
      const lineText = line.text;

      // 获取当前单词
      const wordRange = document.getWordRangeAtPosition(position);
      if (!wordRange) {
        return null;
      }

      const word = document.getText(wordRange);

      // 读取配置
      const config = vscode.workspace.getConfiguration("ini-ra2");
      const enableJump = config.get<boolean>("enableJumpToDefinition", true);

      // 检查是否在节名中（点击节名跳转到该节的其他引用位置没有意义，所以跳过）
      const trimmedLine = lineText.trim();
      if (trimmedLine.startsWith("[") && trimmedLine.includes("]")) {
        // 在节名内，不提供跳转
        return null;
      }

      // 检查是否在键值对的键上（key 不需要跳转）
      const equalsIndex = lineText.indexOf("=");
      if (equalsIndex > 0) {
        const keyStart = lineText.indexOf(lineText.trim());
        const keyEnd = keyStart + lineText.substring(keyStart, equalsIndex).trim().length;

        // 如果光标在键名上，不提供跳转
        if (position.character >= keyStart && position.character <= keyEnd) {
          return null;
        }

        // 光标在值上，查找该值是否为节名
        const value = lineText.substring(equalsIndex + 1).trim();

        // 移除注释部分
        let cleanValue = value;
        const commentIndex = Math.min(
          value.indexOf(";") >= 0 ? value.indexOf(";") : Infinity,
          value.indexOf("#") >= 0 ? value.indexOf("#") : Infinity
        );
        if (commentIndex < Infinity) {
          cleanValue = value.substring(0, commentIndex).trim();
        }

        // 检查当前单词是否在值的范围内
        if (!cleanValue.includes(word)) {
          return null;
        }

        const definitions: vscode.Location[] = [];
        const enableMultiFile = vscode.workspace
          .getConfiguration("ini-ra2")
          .get<boolean>("enableMultiFileSearch", false);

        if (enableMultiFile) {
          // 多文件搜索
          const sectionDefs = indexManager.findSectionDefinitions(word);
          for (const def of sectionDefs) {
            const uri = vscode.Uri.file(def.file);
            const range = new vscode.Range(
              new vscode.Position(def.line, 0),
              new vscode.Position(def.line, 100)
            );
            definitions.push(new vscode.Location(uri, range));
          }
        } else {
          // 仅当前文件
          const text = document.getText();
          const lines = text.split("\n");

          for (let i = 0; i < lines.length; i++) {
            const currentLine = lines[i].trim();

            // 匹配节名 [word] 或 [word] ;注释
            const sectionRegex = new RegExp(`^\\[\\s*${word}\\s*\\]`);
            if (sectionRegex.test(currentLine)) {
              const range = new vscode.Range(
                new vscode.Position(i, 0),
                new vscode.Position(i, currentLine.length)
              );
              definitions.push(new vscode.Location(document.uri, range));
            }
          }
        }

        // 处理返回结果
        if (definitions.length === 0) {
          return null;
        }

        // 如果禁用了跳转功能，不返回定义以阻止默认跳转
        // 用户可以点击 hover 中的命令链接来预览
        if (!enableJump) {
          return null;
        }

        return definitions;
      }

      return null;
    },
  });

  // ========== 查找引用 ==========
  const referenceProvider = vscode.languages.registerReferenceProvider("ini", {
    async provideReferences(
      document: vscode.TextDocument,
      position: vscode.Position,
      context: vscode.ReferenceContext,
      token: vscode.CancellationToken
    ): Promise<vscode.Location[] | null> {
      const line = document.lineAt(position.line);
      const lineText = line.text;

      // 获取当前单词
      const wordRange = document.getWordRangeAtPosition(position);
      if (!wordRange) {
        return null;
      }

      const word = document.getText(wordRange);

      // 检查是否在节名中（支持继承写法 [new]:[old] 的两侧）
      const trimmedLine = lineText.trim();
      const currentHeader = parseSectionHeader(trimmedLine);
      const isHeaderWord = !!currentHeader &&
        (currentHeader.name.toLowerCase() === word.toLowerCase() ||
          currentHeader.parent?.toLowerCase() === word.toLowerCase());
      if (!isHeaderWord) {
        return null;
      }

      const references: vscode.Location[] = [];
      const enableMultiFile = vscode.workspace
        .getConfiguration("ini-ra2")
        .get<boolean>("enableMultiFileSearch", false);

      if (enableMultiFile) {
        // 多文件搜索
        // 添加定义位置
        const defs = indexManager.findSectionDefinitions(word);
        for (const def of defs) {
          const uri = vscode.Uri.file(def.file);
          const range = new vscode.Range(
            new vscode.Position(def.line, 0),
            new vscode.Position(def.line, 100)
          );
          references.push(new vscode.Location(uri, range));
        }

        // 添加引用位置
        const refs = indexManager.findSectionReferences(word);
        for (const ref of refs) {
          const uri = vscode.Uri.file(ref.file);
          const range = new vscode.Range(
            new vscode.Position(ref.line, 0),
            new vscode.Position(ref.line, 100)
          );
          references.push(new vscode.Location(uri, range));
        }
      } else {
        // 仅当前文件
        const text = document.getText();
        const lines = text.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const currentLine = lines[i];
          const trimmed = currentLine.trim();

          // 跳过注释行
          if (trimmed.startsWith(";") || trimmed.startsWith("#")) {
            continue;
          }

          const section = parseSectionHeader(trimmed);
          if (section) {
            // 左侧是定义
            if (section.name.toLowerCase() === word.toLowerCase()) {
              const range = new vscode.Range(
                new vscode.Position(i, 0),
                new vscode.Position(i, currentLine.length)
              );
              references.push(new vscode.Location(document.uri, range));
            }

            // 右侧父节名是引用
            if (section.parent && section.parent.toLowerCase() === word.toLowerCase()) {
              const parentPos = currentLine.toLowerCase().indexOf(section.parent.toLowerCase());
              const start = parentPos >= 0 ? parentPos : 0;
              const range = new vscode.Range(
                new vscode.Position(i, start),
                new vscode.Position(i, start + section.parent.length)
              );
              references.push(new vscode.Location(document.uri, range));
            }
            continue;
          }

          // 检查键值对的值是否包含该节名
          const equalsIndex = currentLine.indexOf("=");
          if (equalsIndex > 0) {
            const value = currentLine.substring(equalsIndex + 1);

            // 移除注释
            let cleanValue = value;
            const commentIndex = Math.min(
              value.indexOf(";") >= 0 ? value.indexOf(";") : Infinity,
              value.indexOf("#") >= 0 ? value.indexOf("#") : Infinity
            );
            if (commentIndex < Infinity) {
              cleanValue = value.substring(0, commentIndex);
            }

            // 使用正则匹配完整单词（避免部分匹配）
            const valueRegex = new RegExp(`\\b${word}\\b`);
            if (valueRegex.test(cleanValue)) {
              const startPos = currentLine.indexOf(word, equalsIndex);
              if (startPos !== -1) {
                const range = new vscode.Range(
                  new vscode.Position(i, startPos),
                  new vscode.Position(i, startPos + word.length)
                );
                references.push(new vscode.Location(document.uri, range));
              }
            }
          }
        }
      }

      return references.length > 0 ? references : null;
    },
  });

  // ========== 文档符号提供者（面包屑导航） ==========
  const symbolProvider = vscode.languages.registerDocumentSymbolProvider("ini", {
    provideDocumentSymbols(
      document: vscode.TextDocument,
      token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
      const symbols: vscode.DocumentSymbol[] = [];
      const text = document.getText();
      const lines = text.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // 检查是否为节名定义
        if (trimmed.startsWith("[") && trimmed.includes("]")) {
          const match = trimmed.match(/^\[\s*([^\]]+)\s*\]/);
          if (match) {
            const sectionName = match[1].trim();

            // 提取节名后的注释
            let detail = "";
            const commentMatch = trimmed.match(/\]\s*([;#])\s*(.+)$/);
            if (commentMatch) {
              detail = commentMatch[2].trim();
              // 截断超长注释（超过50个字符时）
              if (detail.length > 50) {
                detail = detail.substring(0, 50) + "...";
              }
            }

            // 查找该节的结束位置（下一个节或文件末尾）
            let endLine = lines.length - 1;
            for (let j = i + 1; j < lines.length; j++) {
              const nextLine = lines[j].trim();
              if (nextLine.startsWith("[") && nextLine.includes("]")) {
                endLine = j - 1;
                break;
              }
            }

            const range = new vscode.Range(
              new vscode.Position(i, 0),
              new vscode.Position(endLine, lines[endLine]?.length ?? 0)
            );

            const symbol = new vscode.DocumentSymbol(
              sectionName,
              detail,
              vscode.SymbolKind.Array, // 使用 Array 作为节的图标 但是可能会提示为数组类型，硬编码拼尽全力不知如何修改
              range,
              new vscode.Range(
                new vscode.Position(i, 0),
                new vscode.Position(i, line.length)
              )
            );

            symbols.push(symbol);
          }
        }
      }

      return symbols;
    },
  });

  const codeLensProvider = vscode.languages.registerCodeLensProvider(
    "ini",
    new IniSectionCodeLensProvider(indexManager, registerHelper)
  );

  // ========== 辅助函数：获取当前所在节 ==========
  function getCurrentSection(document: vscode.TextDocument, currentLine: number): string | undefined {
    // 从当前行往上查找最近的节名
    for (let i = currentLine; i >= 0; i--) {
      const line = document.lineAt(i).text.trim();
      if (line.startsWith("[") && line.includes("]")) {
        const match = line.match(/^\[\s*([^:\]]+)\s*(\s*:\s*[^\]]+)?\s*\]/);
        if (match) {
          return match[1].trim();
        }
      }
    }
    return undefined;
  }

  // 注册悬浮提示
  const hoverProvider = vscode.languages.registerHoverProvider("ini", {
    provideHover(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
      // 获取当前行
      const line = document.lineAt(position.line);
      const lineText = line.text;

      // 获取鼠标位置的单词
      const wordRange = document.getWordRangeAtPosition(position);
      if (!wordRange) {
        return null;
      }

      const hoveredWord = document.getText(wordRange);

      // ========== 处理节名 [name] ==========
      // 支持节名后有注释的情况，如 [SHK] ;磁暴步兵
      const trimmedLine = lineText.trim();
      if (trimmedLine.startsWith("[") && trimmedLine.includes("]")) {
        const sectionName = hoveredWord;

        // 检查是否在节名范围内
        const bracketStart = lineText.indexOf("[");
        const bracketEnd = lineText.indexOf("]");

        if (
          position.character >= bracketStart + 1 &&
          position.character <= bracketEnd - 1
        ) {
          const content = new vscode.MarkdownString();
          content.appendMarkdown(`### [${sectionName}]\n\n`);

          // 推断并显示节的类型
          const sectionType = typeInference.inferSectionType(sectionName);
          if (sectionType) {
            content.appendMarkdown(`**类型:** \`${sectionType}\`\n\n`);
          }

          // 显示节名描述（如果有）
          // 先检查 sections，再检查 common
          let sectionDescription = translations.sections[sectionName] ||
            translations.common[sectionName];

          if (sectionDescription) {
            content.appendMarkdown(sectionDescription);
            content.appendMarkdown("\n\n---\n\n");
          } else {
            // 即使没有定义也显示基本信息
            content.appendMarkdown("*该节名暂无详细说明*\n\n---\n\n");
          }

          // 查找所有引用该节名的键值对（并记录所属节）
          const text = document.getText();
          const lines = text.split("\n");
          const references: Array<{
            line: number;
            section: string;
            key: string;
            value: string
          }> = [];

          const sectionRegex = new RegExp(`\\b${sectionName}\\b`);
          let currentSection = "文件头部";

          for (let i = 0; i < lines.length; i++) {
            const currentLine = lines[i];
            const trimmed = currentLine.trim();

            // 更新当前所在节
            if (trimmed.startsWith("[") && trimmed.includes("]")) {
              const match = trimmed.match(/^\[\s*([^\]]+)\s*\]/);
              if (match) {
                currentSection = match[1].trim();
              }
              continue;
            }

            // 跳过注释行
            if (trimmed.startsWith(";") || trimmed.startsWith("#")) {
              continue;
            }

            // 检查键值对
            const eqIndex = currentLine.indexOf("=");
            if (eqIndex > 0) {
              const keyPart = currentLine.substring(0, eqIndex).trim();
              const valuePart = currentLine.substring(eqIndex + 1);

              // 移除注释
              let cleanValue = valuePart;
              const commentIdx = Math.min(
                valuePart.indexOf(";") >= 0 ? valuePart.indexOf(";") : Infinity,
                valuePart.indexOf("#") >= 0 ? valuePart.indexOf("#") : Infinity
              );
              if (commentIdx < Infinity) {
                cleanValue = valuePart.substring(0, commentIdx);
              }

              // 检查值是否包含该节名（完整单词匹配）
              if (sectionRegex.test(cleanValue.trim())) {
                references.push({
                  line: i + 1,
                  section: currentSection,
                  key: keyPart,
                  value: cleanValue.trim()
                });
              }
            }
          }

          // 显示其他文件中的节定义
          const enableMultiFile = vscode.workspace
            .getConfiguration("ini-ra2")
            .get<boolean>("enableMultiFileSearch", true);

          if (enableMultiFile) {
            const otherDefs = indexManager.findSectionDefinitions(sectionName)
              .filter(def => def.file !== document.uri.fsPath);

            if (otherDefs.length > 0) {
              content.appendMarkdown("**其他文件中的定义**：\n\n");
              for (const def of otherDefs) {
                const fileName = path.basename(def.file);
                content.appendMarkdown(`- 文件: **${fileName}** (行 ${def.line + 1})\n`);
              }
              content.appendMarkdown("\n");
            }
          }

          // 显示引用信息
          if (references.length > 0) {
            content.appendMarkdown(`**当前文件引用** (${references.length}处)：\n\n`);

            // 最多显示10个引用
            const maxShow = 10;
            const showReferences = references.slice(0, maxShow);

            for (const ref of showReferences) {
              content.appendMarkdown(
                `- 行 ${ref.line} **[${ref.section}]**: \`${ref.key}=${ref.value}\`\n`
              );
            }

            if (references.length > maxShow) {
              content.appendMarkdown(`\n*...还有 ${references.length - maxShow} 处引用*\n`);
            }
          } else {
            // 检查用户是否启用了显示空引用提示
            const showEmptyHint = vscode.workspace
              .getConfiguration("ini-ra2")
              .get<boolean>("showEmptyReferenceHint", true);

            if (showEmptyHint) {
              content.appendMarkdown("**当前文件引用**：未找到引用此节名的键值对\n");
            }
          }

          // 显示其他文件的引用
          if (enableMultiFile) {
            const otherRefs = indexManager.findSectionReferences(sectionName)
              .filter(ref => ref.file !== document.uri.fsPath);

            if (otherRefs.length > 0) {
              content.appendMarkdown(`\n**其他文件引用** (${otherRefs.length}处)：\n\n`);

              const maxShow = 5;
              const showRefs = otherRefs.slice(0, maxShow);

              for (const ref of showRefs) {
                const fileName = path.basename(ref.file);
                content.appendMarkdown(
                  `- **${fileName}** 行 ${ref.line + 1} [${ref.section}]: \`${ref.key}=${ref.value}\`\n`
                );
              }

              if (otherRefs.length > maxShow) {
                content.appendMarkdown(`\n*...还有 ${otherRefs.length - maxShow} 处引用*\n`);
              }
            }
          }

          content.isTrusted = true;
          content.supportHtml = false;

          return new vscode.Hover(content);
        }
      }

      // ========== 处理键值对 key=value ==========
      const equalsIndex = lineText.indexOf("=");
      if (equalsIndex > 0) {
        const key = lineText.substring(0, equalsIndex).trim();

        // 检查是否在键名上
        const keyStart = lineText.indexOf(key);
        if (
          position.character >= keyStart &&
          position.character <= keyStart + key.length
        ) {
          // 获取当前所在节
          const currentSection = getCurrentSection(document, position.line);

          // 获取键对应的值
          const value = lineText.substring(equalsIndex + 1).trim();
          const commentIndex = Math.min(
            value.indexOf(";") >= 0 ? value.indexOf(";") : Infinity,
            value.indexOf("#") >= 0 ? value.indexOf("#") : Infinity
          );
          const actualValue =
            commentIndex < Infinity
              ? value.substring(0, commentIndex).trim()
              : value;

          // 使用类型推断获取翻译
          let description: string | undefined;
          if (currentSection) {
            description = typeInference.getTranslationWithType(key, currentSection, actualValue);
          }

          // 如果没找到，尝试直接从common查找
          if (!description) {
            description = translations.common[key];
          }

          if (description) {
            const content = new vscode.MarkdownString();

            // 显示键名，不显示类型
            content.appendMarkdown(`### ${key}\n\n`);
            if (currentSection) {
              content.appendMarkdown(`*所在节: [${currentSection}]*\n\n`);
            }

            content.appendMarkdown(description);
            content.isTrusted = true;
            content.supportHtml = false;

            if (actualValue) {
              content.appendMarkdown(`\n\n**当前值:** \`${actualValue}\``);

              // 如果是布尔值，显示词典
              const lowerValue = actualValue.toLowerCase();
              if (
                lowerValue === "yes" ||
                lowerValue === "no" ||
                lowerValue === "true" ||
                lowerValue === "false"
              ) {
                content.appendMarkdown(
                  `\n**含义:** ${lowerValue === "yes" || lowerValue === "true"
                    ? "是/启用"
                    : "否/禁用"
                  }`
                );
              }
            }

            return new vscode.Hover(content);
          }
          // 在键名上但无 description，返回 null
          return null;
        }

        // 不在键名上，在值上
        const valuePart = lineText.substring(equalsIndex + 1);
        const commentIndex = Math.min(
          valuePart.indexOf(";") >= 0 ? valuePart.indexOf(";") : Infinity,
          valuePart.indexOf("#") >= 0 ? valuePart.indexOf("#") : Infinity
        );
        let cleanValue = valuePart;
        if (commentIndex < Infinity) {
          cleanValue = valuePart.substring(0, commentIndex);
        }

        // 检查是否在某个引用单词上（可能引用节名）
        if (hoveredWord && cleanValue.includes(hoveredWord)) {
          const config = vscode.workspace.getConfiguration("ini-ra2");
          const enableJump = config.get<boolean>("enableJumpToDefinition", true);

          // 获取所有节名集合（使用和下划线链接相同的逻辑）
          const enableMultiFile = vscode.workspace
            .getConfiguration("ini-ra2")
            .get<boolean>("enableMultiFileSearch", true);

          const sectionNames = enableMultiFile
            ? indexManager.getAllSections()
            : new Set<string>();

          // 如果未启用跨文件或索引为空，则收集当前文件的节名
          if (sectionNames.size === 0) {
            const text = document.getText();
            const lines = text.split("\n");
            for (const line of lines) {
              const trimmed = line.trim();
              const match = trimmed.match(/^\[\s*([^:\]]+)\s*(\s*:\s*[^\]]+)?\s*\]/);
              if (match) {
                sectionNames.add(match[1].trim());
              }
            }
          }

          // 检查 hoveredWord 是否是一个有效的节名
          const isValidSectionReference = sectionNames.has(hoveredWord);

          if (isValidSectionReference) {
            const content = new vscode.MarkdownString();

            // 根据配置显示不同的文案
            if (enableJump) {
              content.appendMarkdown(`**跳转到 [\`${hoveredWord}\`] 定义**\n\nCtrl+单击 快速跳转`);
            } else {
              content.appendMarkdown(`**预览 [\`${hoveredWord}\`] 定义**\n\n`);
              // 使用 JSON 作为参数
              const commandParam = JSON.stringify({
                uri: document.uri.toString(),
                section: hoveredWord
              });
              content.appendMarkdown(`[点击预览](command:ini-ra2.peekDefinition?${encodeURIComponent(commandParam)})`);
            }

            content.isTrusted = true;
            content.supportHtml = false;

            return new vscode.Hover(content);
          }
        }
      }

      return null;
    },
  });

  // 注册格式化
  // 从 typeMapping 动态获取所有注册列表节名
  const sectionsToSort: string[] = [];
  for (const config of Object.values(translations.typeMapping)) {
    sectionsToSort.push(...config.registers);
  }

  // 调试：输出需要排序的节
  outputChannel.appendLine(`[Format] 需要排序的节: ${sectionsToSort.join(", ")}`);

  // 配置项：从用户设置中读取
  const getMaxEmptyLines = () => {
    return vscode.workspace
      .getConfiguration("ini-ra2")
      .get<number>("maxEmptyLinesBetweenSections", 2);
  };

  // 配置项：注释对齐缩进（空格数）
  const COMMENT_ALIGN_INDENT = 0;

  const formattingProvider =
    vscode.languages.registerDocumentFormattingEditProvider("ini", {
      provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions
      ) {
        try {
          // 获取用户配置的空行数量
          const MAX_EMPTY_LINES_BETWEEN_SECTIONS = getMaxEmptyLines();

          const text = document.getText();
          const lines = text.split("\n");
          const formattedLines: string[] = [];

          let currentSection: string = "";
          let currentSectionLines: string[] = [];
          let inSection = false;
          let consecutiveEmptyLines = 0;
          let lastLineWasComment = false;

          // 对齐注释的函数
          const alignComment = (comment: string): string => {
            const trimmedComment = comment.trim();
            const spaces = " ".repeat(COMMENT_ALIGN_INDENT);

            let commentChar = "";
            let commentText = "";

            if (trimmedComment.startsWith(";")) {
              commentChar = ";";
              commentText = trimmedComment.substring(1).trim();
            } else if (trimmedComment.startsWith("#")) {
              commentChar = "#";
              commentText = trimmedComment.substring(1).trim();
            } else {
              return comment;
            }

            if (commentText && !commentText.startsWith(" ")) {
              commentText = " " + commentText;
            }

            return spaces + commentChar + commentText;
          };

          const processSectionLines = () => {
            if (currentSectionLines.length === 0) {
              return;
            }

            let regularLines: string[] = [];
            const appendLines: string[] = [];
            const otherLines: string[] = [];

            // 分离不同类型的行
            for (let line of currentSectionLines) {
              const trimmedLine = line.trim();

              // 空行
              if (trimmedLine === "") {
                otherLines.push("");
                continue;
              }

              // 处理独立的注释行（整行都是注释）
              if (trimmedLine.startsWith(";") || trimmedLine.startsWith("#")) {
                // 对齐注释
                otherLines.push(alignComment(line));
                continue;
              }

              // 处理键值对
              const equalsIndex = trimmedLine.indexOf("=");
              if (equalsIndex > 0) {
                const beforeEquals = trimmedLine.substring(0, equalsIndex).trim();
                const afterEquals = trimmedLine.substring(equalsIndex + 1);

                // 检查是否是 += 操作符
                const isAppendOperator = beforeEquals.endsWith("+");

                // 分离值和注释
                let value = afterEquals;
                let comment = "";

                // 查找注释起始位置
                const commentIndex = Math.min(
                  afterEquals.indexOf(";") >= 0
                    ? afterEquals.indexOf(";")
                    : Infinity,
                  afterEquals.indexOf("#") >= 0
                    ? afterEquals.indexOf("#")
                    : Infinity
                );

                if (commentIndex < Infinity && commentIndex >= 0) {
                  value = afterEquals.substring(0, commentIndex);
                  comment = afterEquals.substring(commentIndex);
                }

                // 清理键：去除所有空格
                let cleanKey = beforeEquals.replace(/\s+/g, "");

                // 处理 += 操作符
                if (isAppendOperator) {
                  // 确保键是 += 格式
                  cleanKey = cleanKey.endsWith("+") ? "+=" : cleanKey + "=";
                } else {
                  cleanKey += "=";
                }

                // 清理值：去除首尾空格，但保留中间空格
                const cleanValue = value.trim();

                // 构建格式化后的行
                let formattedLine = `${cleanKey}${cleanValue}`;
                if (comment) {
                  if (!cleanValue.endsWith(" ") && !comment.startsWith(" ")) {
                    formattedLine += " ";
                  }
                  formattedLine += comment;
                }

                if (isAppendOperator) {
                  appendLines.push(formattedLine);
                } else {
                  regularLines.push(formattedLine);
                }
              } else {
                otherLines.push(line);
              }
            }

            // 对特定节的键值进行排序（只排序数字键，如 1=, 2=）
            if (sectionsToSort.includes(currentSection)) {
              outputChannel.appendLine(`[Format] 正在排序节: ${currentSection}`);
              // 只对数字键进行排序，非数字键保持原有顺序
              const numericLines: string[] = [];
              const nonNumericLines: string[] = [];

              for (const line of regularLines) {
                const key = line.split("=")[0].trim();
                const num = parseInt(key);
                if (!isNaN(num) && key === num.toString()) {
                  // 纯数字键（如 1=, 2=）
                  numericLines.push(line);
                } else {
                  // 非数字键（如 Name=, Primary=）
                  nonNumericLines.push(line);
                }
              }

              // 对数字键排序
              numericLines.sort((a, b) => {
                const numA = parseInt(a.split("=")[0].trim());
                const numB = parseInt(b.split("=")[0].trim());
                return numA - numB;
              });

              // 合并：数字键在前，非数字键保持原有顺序
              regularLines = [...numericLines, ...nonNumericLines];

              // += 操作符排序（保持原有逻辑）
              if (appendLines.length > 0) {
                appendLines.sort((a, b) => {
                  const keyMatchA = a.match(/^\+=(\S+)/);
                  const keyMatchB = b.match(/^\+=(\S+)/);

                  if (keyMatchA && keyMatchB) {
                    const keyA = keyMatchA[1];
                    const keyB = keyMatchB[1];

                    const numA = parseInt(keyA);
                    const numB = parseInt(keyB);

                    if (!isNaN(numA) && !isNaN(numB)) {
                      return numA - numB;
                    }

                    // 非数字的 += 保持相对顺序
                    return 0;
                  }
                  return 0;
                });
              }

              // 重新构建节内容
              const sortedLines: string[] = [];

              // 1. 添加非+=的行
              for (let i = 0; i < regularLines.length; i++) {
                sortedLines.push(regularLines[i]);
              }

              // 2. 添加+=行
              for (let i = 0; i < appendLines.length; i++) {
                sortedLines.push(appendLines[i]);
              }

              // 3. 合并其他行
              for (let i = 0; i < otherLines.length; i++) {
                sortedLines.push(otherLines[i]);
              }

              // 4. 替换原来的节内容
              currentSectionLines = sortedLines;
            }

            // 将处理后的节内容添加到结果中
            for (let i = 0; i < currentSectionLines.length; i++) {
              formattedLines.push(currentSectionLines[i]);
            }

            // 重置
            currentSectionLines = [];
            lastLineWasComment = false;
          };

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // 处理节标题 - 匹配 [ 开头的行（可能 ] 在后续行）
            if (trimmedLine.startsWith("[")) {
              // 处理前一个节的内容
              if (inSection) {
                processSectionLines();
              }

              // 收集完整的节名（可能跨多行）
              let fullSectionText = trimmedLine;
              let j = i;

              // 如果当前行没有 ]，继续查找后续行
              while (!fullSectionText.includes("]") && j < lines.length - 1) {
                j++;
                fullSectionText += lines[j].trim();
              }

              // 更新索引，跳过已处理的行
              i = j;

              // 查找 ] 的位置
              const bracketEndIndex = fullSectionText.indexOf("]");
              if (bracketEndIndex > 0) {
                // 提取节名内容
                const sectionContent = fullSectionText.substring(1, bracketEndIndex);
                const afterSection = fullSectionText.substring(bracketEndIndex + 1);

                // 清理节名：去除所有空格、换行符、制表符等空白字符
                const cleanSectionName = sectionContent.replace(/\s+/g, "");

                // 重新构建节名
                let cleanSection = `[${cleanSectionName}]`;

                // 添加节后的内容（可能是注释）
                if (afterSection.trim()) {
                  const afterContent = afterSection.trim();
                  if (
                    !afterContent.startsWith(" ") &&
                    !cleanSection.endsWith(" ")
                  ) {
                    cleanSection += " ";
                  }
                  cleanSection += afterContent;
                }

                // 在节前添加空行（如果不是第一个元素且前一行不是注释）
                if (formattedLines.length > 0) {
                  // 检查最后一行是否是注释（忽略空行）
                  let lastNonEmptyLine = "";
                  for (let k = formattedLines.length - 1; k >= 0; k--) {
                    if (formattedLines[k].trim() !== "") {
                      lastNonEmptyLine = formattedLines[k].trim();
                      break;
                    }
                  }

                  const isLastLineComment =
                    lastNonEmptyLine.startsWith(";") ||
                    lastNonEmptyLine.startsWith("#");

                  // 只有当前一行不是注释时，才添加空行
                  if (!isLastLineComment) {
                    // 移除已有的多余空行
                    while (
                      formattedLines.length > 0 &&
                      formattedLines[formattedLines.length - 1] === ""
                    ) {
                      formattedLines.pop();
                    }

                    // 添加1-2个空行（根据配置）
                    for (
                      let j = 0;
                      j < Math.min(MAX_EMPTY_LINES_BETWEEN_SECTIONS, 2);
                      j++
                    ) {
                      formattedLines.push("");
                    }
                  } else {
                    // 如果前一行是注释，只移除多余的空行（保持0或1个空行）
                    while (
                      formattedLines.length > 0 &&
                      formattedLines[formattedLines.length - 1] === ""
                    ) {
                      formattedLines.pop();
                    }
                  }
                }

                // 添加清理后的节标题
                formattedLines.push(cleanSection);

                // 更新状态
                currentSection = cleanSectionName; // 不带方括号，用于和sectionsToSort比较
                inSection = true;
                consecutiveEmptyLines = 0;
                lastLineWasComment = false;

                // 跳过节标题后的第一个空行（如果存在）
                let j = i + 1;
                while (j < lines.length && lines[j].trim() === "") {
                  j++;
                }
                i = j - 1;
                continue;
              }
            }

            // 如果不在节内，处理节外的行
            if (!inSection) {
              if (trimmedLine === "") {
                consecutiveEmptyLines++;
                // 限制连续空行数量
                if (consecutiveEmptyLines <= MAX_EMPTY_LINES_BETWEEN_SECTIONS) {
                  formattedLines.push("");
                }
                continue;
              } else {
                consecutiveEmptyLines = 0;
              }
            }

            // 处理独立的注释行（整行都是注释）
            if (trimmedLine.startsWith(";") || trimmedLine.startsWith("#")) {
              if (inSection) {
                // 节内的注释：对齐处理
                currentSectionLines.push(line);
              } else {
                // 节外的注释：对齐处理
                // 注释上下不加空行
                formattedLines.push(alignComment(line));
                lastLineWasComment = true;
              }
              continue;
            }

            // 处理键值对
            const equalsIndex = trimmedLine.indexOf("=");
            if (equalsIndex > 0) {
              if (inSection) {
                currentSectionLines.push(line);
              } else {
                // 如果不在节内，直接处理
                const beforeEquals = trimmedLine.substring(0, equalsIndex).trim();
                const afterEquals = trimmedLine.substring(equalsIndex + 1);

                // 清理键：去除所有空格
                let cleanKey = beforeEquals.replace(/\s+/g, "");

                // 检查是否是 += 操作符
                const isAppendOperator = cleanKey.endsWith("+");
                if (isAppendOperator) {
                  cleanKey = "+=";
                } else {
                  cleanKey += "=";
                }

                // 分离值和注释
                let value = afterEquals;
                let comment = "";

                // 查找注释起始位置
                const commentIndex = Math.min(
                  afterEquals.indexOf(";") >= 0
                    ? afterEquals.indexOf(";")
                    : Infinity,
                  afterEquals.indexOf("#") >= 0
                    ? afterEquals.indexOf("#")
                    : Infinity
                );

                if (commentIndex < Infinity && commentIndex >= 0) {
                  value = afterEquals.substring(0, commentIndex);
                  comment = afterEquals.substring(commentIndex);
                }

                // 清理值：去除首尾空格，但保留中间空格
                const cleanValue = value.trim();

                // 构建格式化后的行
                let formattedLine = `${cleanKey}${cleanValue}`;
                if (comment) {
                  if (!cleanValue.endsWith(" ") && !comment.startsWith(" ")) {
                    formattedLine += " ";
                  }
                  formattedLine += comment;
                }

                formattedLines.push(formattedLine);
                lastLineWasComment = false;
              }
              continue;
            }

            // 处理空行
            if (trimmedLine === "") {
              if (inSection) {
                // 节内的空行，保留用户手动添加的
                currentSectionLines.push("");
              } else {
                // 节外的空行已经在上面的逻辑中处理
              }
              lastLineWasComment = false;
              continue;
            }

            // 其他行保持原样
            if (inSection) {
              currentSectionLines.push(line);
            } else {
              formattedLines.push(line);
            }
            lastLineWasComment = false;
          }

          // 处理最后一个节
          if (inSection) {
            processSectionLines();
          }

          // 移除末尾的连续空行
          while (
            formattedLines.length > 0 &&
            formattedLines[formattedLines.length - 1] === ""
          ) {
            formattedLines.pop();
          }

          // 构建格式化后的文本
          const formattedText = formattedLines.join("\n");

          // 创建编辑操作
          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(text.length)
          );

          return [vscode.TextEdit.replace(fullRange, formattedText)];
        } catch (error) {
          outputChannel.appendLine(`格式化错误: ${error}`);
          vscode.window.showErrorMessage(`INI 格式化失败: ${error}`);
          return [];
        }
      },
    });

  // 注册节折叠范围提供者
  const foldingProvider = vscode.languages.registerFoldingRangeProvider("ini", {
    provideFoldingRanges(
      document: vscode.TextDocument,
      context: vscode.FoldingContext,
      token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.FoldingRange[]> {
      const foldingRanges = [];
      const text = document.getText();
      const lines = text.split("\n");

      let sectionStart = -1;
      let sectionName = "";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // 检测节头（兼容节名后有注释的情况）
        if (line.startsWith("[") && line.includes("]")) {
          // 如果之前有一个节开始，创建折叠范围
          if (sectionStart !== -1 && i > sectionStart) {
            foldingRanges.push(
              new vscode.FoldingRange(
                sectionStart,
                i - 1,
                vscode.FoldingRangeKind.Region
              )
            );
          }

          sectionStart = i;
          sectionName = line;
        }
      }

      // 处理最后一个节
      if (sectionStart !== -1 && sectionStart < lines.length - 1) {
        foldingRanges.push(
          new vscode.FoldingRange(
            sectionStart,
            lines.length - 1,
            vscode.FoldingRangeKind.Region
          )
        );
      }

      return foldingRanges;
    },
  });

  // ========== 重复定义检测 ==========
  // 创建诊断收集器（只用于显示警告）
  diagnosticCollection = vscode.languages.createDiagnosticCollection("ini");
  context.subscriptions.push(diagnosticCollection);

  // 防抖定时器
  let debounceTimer: NodeJS.Timeout | undefined;

  // 使用模块化的诊断功能
  const checkDuplicateDefinitions = setupDiagnostics(diagnosticCollection, indexManager, translations);

  // 为了兼容性保留原函数调用（如果还有其他地方引用）
  function checkDuplicateDefinitionsLegacy(document: vscode.TextDocument) {
    if (document.languageId !== "ini") {
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    const lines = text.split("\n");

    let currentSection = "";
    const sectionKeyMap = new Map<
      string,
      Map<string, { originalKey: string; lineNumbers: number[] }>
    >();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // 跳过空行和注释
      if (
        trimmedLine === "" ||
        trimmedLine.startsWith(";") ||
        trimmedLine.startsWith("#") ||
        trimmedLine.startsWith("//")
      ) {
        continue;
      }

      // ========== 重要修复：处理行内注释（分号后） ==========
      // 查找第一个非引号内的分号
      let contentLine = trimmedLine;
      let inQuotes = false;
      let commentStart = -1;

      for (let j = 0; j < trimmedLine.length; j++) {
        const char = trimmedLine[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ";" && !inQuotes) {
          commentStart = j;
          break;
        }
      }

      if (commentStart !== -1) {
        contentLine = trimmedLine.substring(0, commentStart).trim();
      }
      // ========== 修复结束 ==========

      // 检测节开始
      if (contentLine.startsWith("[") && contentLine.endsWith("]")) {
        currentSection = contentLine;
        continue;
      }

      // 检测是否有等号（包括+=）
      const equalsIndex = contentLine.indexOf("=");
      const appendIndex = contentLine.indexOf("+=");

      // ps1：有+=，这是追加操作，不检测重复
      // 处理 += 操作
      if (appendIndex !== -1 && currentSection) {
        let originalKey = "";
        let afterAppend = "";

        // ps1: +=value (独占一行)
        if (contentLine.startsWith("+=")) {
          originalKey = ""; // 没有显式键名，需要上下文
          afterAppend = contentLine.substring(2).trim();
        }
        // ps2: key+=value (同一行)
        else if (appendIndex > 0) {
          originalKey = contentLine.substring(0, appendIndex).trim();
          afterAppend = contentLine.substring(appendIndex + 2).trim();

          // 检查键名是否为空
          if (originalKey === "") {
            const range = new vscode.Range(
              new vscode.Position(i, 0),
              new vscode.Position(i, line.length)
            );

            const diagnostic = new vscode.Diagnostic(
              range,
              `⚠️ 语法错误: += 操作符前面缺少键名`,
              vscode.DiagnosticSeverity.Error
            );

            diagnostic.source = "INI语法检测";
            diagnostic.code = "RA2-INI-Assistant";
            diagnostics.push(diagnostic);
            continue;
          }
        }

        // 检查 += 后面是否有值
        if (afterAppend === "") {
          // 计算错误位置
          let errorStart = 0;
          let errorEnd = line.length;

          if (originalKey) {
            const originalKeyIndex = line.indexOf(originalKey);
            if (originalKeyIndex !== -1) {
              errorStart = originalKeyIndex;
              errorEnd = errorStart + originalKey.length + 2; // 包括 +=
            }
          }

          const range = new vscode.Range(
            new vscode.Position(i, errorStart),
            new vscode.Position(i, errorEnd)
          );

          const diagnostic = new vscode.Diagnostic(
            range,
            `⚠️ 语法警告: 追加操作符(+=)后面缺少需要注册的值`,
            vscode.DiagnosticSeverity.Warning
          );

          diagnostic.source = "INI语法检测";
          diagnostic.code = "RA2-INI-Assistant";
          diagnostics.push(diagnostic);
        }

        // +=操作符，不进行重复检测，直接跳过
        continue;
      }

      // ps2：有普通等号（不是+=），正常键值对
      else if (equalsIndex > 0 && currentSection) {
        const originalKey = contentLine.substring(0, equalsIndex).trim();
        const normalizedKey = originalKey.toLowerCase(); // 转换为小写用于比较

        // 跳过某些常用键的重复检测（如UIName等）
        const skipKeys = [
          "UIName",
          "Name",
          "Prerequisite",
          "Primary",
          "Strength",
          "Category",
          "Turnet",
          "Cost",
          "Armor",
          "Sight",
          "Speed",
        ];
        if (skipKeys.includes(originalKey)) {
          continue; // 跳过这些常用键的重复检测
        }

        // 初始化当前节的映射
        if (!sectionKeyMap.has(currentSection)) {
          sectionKeyMap.set(currentSection, new Map());
        }

        const keyMap = sectionKeyMap.get(currentSection)!;

        if (keyMap.has(normalizedKey)) {
          // 找到重复定义！
          const entry = keyMap.get(normalizedKey)!;
          entry.lineNumbers.push(i);

          // 为所有重复行添加警告（包括第一次出现）
          entry.lineNumbers.forEach((lineNum) => {
            const duplicateLine = lines[lineNum];
            // 处理重复行的注释
            let duplicateContentLine = duplicateLine.trim();
            const dupCommentIndex = duplicateContentLine.indexOf(";");
            if (dupCommentIndex !== -1) {
              duplicateContentLine = duplicateContentLine
                .substring(0, dupCommentIndex)
                .trim();
            }

            const dupEqualsIndex = duplicateContentLine.indexOf("=");
            if (dupEqualsIndex > 0) {
              const dupLineKey = duplicateContentLine
                .substring(0, dupEqualsIndex)
                .trim();
              const keyStart = duplicateLine.indexOf(dupLineKey);
              const keyEnd = keyStart + dupLineKey.length;

              // 创建警告范围
              const range = new vscode.Range(
                new vscode.Position(lineNum, keyStart),
                new vscode.Position(lineNum, keyEnd)
              );

              // 创建诊断（警告级别）
              const diagnostic = new vscode.Diagnostic(
                range,
                `⚠️ 重复定义: "${dupLineKey}" 在节 ${currentSection} 中已定义多次(不区分大小写)`,
                vscode.DiagnosticSeverity.Warning
              );

              diagnostic.source = "INI重复定义检测";
              diagnostic.code = "RA2-INI-Assistant";

              diagnostics.push(diagnostic);
            }
          });
        } else {
          // 第一次出现，记录行号
          keyMap.set(normalizedKey, {
            originalKey: originalKey,
            lineNumbers: [i],
          });
        }
      }
      // ps3：没有等号，但有非空内容（可能是缺失等号的键）
      else if (contentLine !== "" && currentSection) {
        // 检查是否可能是有效的键名（不是注释、不是节定义）
        const isPotentialKey =
          !contentLine.startsWith("[") &&
          !contentLine.startsWith(";") &&
          !contentLine.startsWith("#") &&
          contentLine.length > 0;

        if (isPotentialKey) {
          // 获取可能的键名（如果后面有值，取第一个词作为键名）
          let possibleKey = contentLine;
          let diagnosticMessage = "";
          let diagnosticSeverity = vscode.DiagnosticSeverity.Warning;

          // 检查是否有空格或制表符分隔的值
          const spaceIndex = contentLine.indexOf(" ");
          const tabIndex = contentLine.indexOf("\t");
          const separatorIndex = spaceIndex > -1 ? spaceIndex : tabIndex;

          if (separatorIndex > 0) {
            // 有分隔符，可能是 "name value" 格式
            possibleKey = contentLine.substring(0, separatorIndex).trim();
            diagnosticMessage = `❌ 语法错误: 键 "${possibleKey}" 中间缺少等号(=)`;
            diagnosticSeverity = vscode.DiagnosticSeverity.Error;
          } else {
            // 没有分隔符，只有单独的键名，如 "name"
            possibleKey = contentLine;
            diagnosticMessage = `⚠️ 语法问题: "${possibleKey}" 缺少等号和值，应为 ${possibleKey}=你要的值`;
            diagnosticSeverity = vscode.DiagnosticSeverity.Warning;
          }

          // 创建错误/警告范围
          const keyStart = line.indexOf(possibleKey);
          const keyEnd = keyStart + possibleKey.length;

          const range = new vscode.Range(
            new vscode.Position(i, keyStart),
            new vscode.Position(i, keyEnd)
          );

          // 创建诊断（错误级别或警告级别）
          const diagnostic = new vscode.Diagnostic(
            range,
            diagnosticMessage,
            diagnosticSeverity
          );

          diagnostic.source = "INI语法检测";
          diagnostic.code = "RA2-INI-Assistant";

          diagnostics.push(diagnostic);
        }
      }
    }

    // 设置诊断警告
    diagnosticCollection.set(document.uri, diagnostics);
  }

  // ========== 监听文档变化 ==========

  let scopeDebounceTimer: NodeJS.Timeout | undefined;

  // 1. 文档内容变化时检测（添加防抖）
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        checkDuplicateDefinitions(event.document);
      }, 500);

      // 更新作用域装饰（添加防抖避免闪烁）
      const editor = vscode.window.visibleTextEditors.find(e => e.document === event.document);
      if (editor && editor.document.languageId === "ini") {
        if (scopeDebounceTimer) {
          clearTimeout(scopeDebounceTimer);
        }
        scopeDebounceTimer = setTimeout(() => {
          updateScopeDecorations(editor);
        }, 300); // 300ms 防抖
      }
    })
  );

  // 2. 文档打开时检测
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      checkDuplicateDefinitions(document);
    })
  );

  // 3. 文档保存时检测
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      checkDuplicateDefinitions(document);
    })
  );

  // 4. 编辑器打开/切换时更新装饰
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      editors.forEach(editor => {
        if (editor.document.languageId === "ini") {
          updateScopeDecorations(editor);
        }
      });
    })
  );

  // 5. 初始化时检测当前文档
  if (vscode.window.activeTextEditor) {
    checkDuplicateDefinitions(vscode.window.activeTextEditor.document);
    if (vscode.window.activeTextEditor.document.languageId === "ini") {
      updateScopeDecorations(vscode.window.activeTextEditor);
    }
  }

  // 当索引发生变化（其他文件新增/删除/编辑）时，重新计算所有已打开 INI 文档的诊断
  // 解决：初始化或跨文件更新后，当前文件的蓝色波浪线未及时刷新
  const revalidateOpenIniDocs = () => {
    const openDocs = vscode.workspace.textDocuments.filter(doc => doc.languageId === "ini");
    for (const doc of openDocs) {
      try {
        checkDuplicateDefinitions(doc);
      } catch (err) {
        outputChannel.appendLine(`诊断刷新失败: ${doc.uri.fsPath} - ${err}`);
      }
    }
  };

  // 订阅索引变更事件，触发跨文件诊断刷新
  indexManager.onIndexChange(() => {
    // 轻量防抖，避免频繁触发导致卡顿
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      revalidateOpenIniDocs();
      void unregisteredSectionsProvider.refresh();
    }, 300);
  });

  // 诊断快速修复提供者（创建缺失节、删除未使用节）
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    "ini",
    new (class implements vscode.CodeActionProvider {
      provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range,
        context: vscode.CodeActionContext
      ): vscode.ProviderResult<vscode.CodeAction[]> {
        const actions: vscode.CodeAction[] = [];

        const getSectionRange = (line: number): vscode.Range => {
          let start = line;
          let end = document.lineCount - 1;

          for (let i = line - 1; i >= 0; i--) {
            const text = document.lineAt(i).text.trim();
            if (text.match(/^\s*\[/)) {
              start = i;
              break;
            }
          }

          for (let i = line + 1; i < document.lineCount; i++) {
            const text = document.lineAt(i).text.trim();
            if (text.match(/^\s*\[/)) {
              end = i - 1;
              break;
            }
          }

          const startPos = new vscode.Position(start, 0);
          const endPos = new vscode.Position(end, document.lineAt(end).text.length);
          return new vscode.Range(startPos, endPos);
        };

        const decodeSectionName = (diag: vscode.Diagnostic): string | undefined => {
          const code = diag.code as any;
          if (code && code.target && code.target.scheme === 'section') {
            const raw = code.target.path || '';
            return decodeURIComponent(raw.replace(/^\//, ''));
          }
          return undefined;
        };

        for (const diag of context.diagnostics) {
          const codeValue = typeof diag.code === 'object' && diag.code ? (diag.code as any).value : diag.code;
          const sectionName = decodeSectionName(diag);

          if (codeValue === 'undefined-section' && sectionName) {
            const action = new vscode.CodeAction(`创建节 [${sectionName}]`, vscode.CodeActionKind.QuickFix);
            action.diagnostics = [diag];
            const edit = new vscode.WorkspaceEdit();

            const insertLine = document.lineCount;
            const prefix = document.lineCount > 0 ? '\n\n' : '';
            edit.insert(
              document.uri,
              new vscode.Position(insertLine, 0),
              `${prefix}[${sectionName}]\n; TODO: 请填写节内容\n`
            );
            action.edit = edit;
            actions.push(action);
          }

          if (codeValue === 'unused-section' && sectionName) {
            const action = new vscode.CodeAction(`删除未引用的节 [${sectionName}]`, vscode.CodeActionKind.QuickFix);
            action.diagnostics = [diag];
            const edit = new vscode.WorkspaceEdit();
            const range = getSectionRange(diag.range.start.line);
            edit.delete(document.uri, range);
            action.edit = edit;
            actions.push(action);
          }
        }

        return actions;
      }
    })(),
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );

  // 注册表节名 CodeAction 提供器
  const registerCodeActionProvider = vscode.languages.registerCodeActionsProvider(
    "ini",
    {
      provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range
      ): vscode.ProviderResult<vscode.CodeAction[]> {
        return registerHelper.provideRegisterCodeAction(document, range);
      }
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite] }
  );

  // ========== 注册命令 ==========

  const revealRangeInEditor = async (uri: vscode.Uri, range: vscode.Range): Promise<void> => {
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, {
      preview: false,
      preserveFocus: false,
    });
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  };

  const findRegisteredEntryRange = async (
    uri: vscode.Uri,
    registerName: string,
    sectionName: string
  ): Promise<vscode.Range | undefined> => {
    const doc = await vscode.workspace.openTextDocument(uri);
    const lines = doc.getText().split("\n");
    const targetLower = sectionName.toLowerCase();
    const mode = registerHelper.getRegisterMode(registerName);
    let inTargetRegister = false;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();
      const header = parseSectionHeader(trimmed);
      if (header) {
        inTargetRegister = header.name.toLowerCase() === registerName.toLowerCase();
        continue;
      }

      if (!inTargetRegister || trimmed === "" || trimmed.startsWith(";") || trimmed.startsWith("#")) {
        continue;
      }

      if (mode === "keyValue") {
        const keyMatch = rawLine.match(/^\s*([^=\s;#]+)\s*=/);
        if (!keyMatch) {
          continue;
        }
        const value = keyMatch[1].trim();
        if (value.toLowerCase() !== targetLower) {
          continue;
        }
        const start = rawLine.indexOf(value);
        if (start < 0) {
          continue;
        }
        return new vscode.Range(new vscode.Position(i, start), new vscode.Position(i, start + value.length));
      }

      const appendMatch = rawLine.match(/^\s*\+=\s*([^\s;#]+)/);
      const numMatch = rawLine.match(/^\s*\d+\s*=\s*([^\s;#]+)/);
      const value = appendMatch?.[1]?.trim() || numMatch?.[1]?.trim();
      if (!value || value.toLowerCase() !== targetLower) {
        continue;
      }
      const start = rawLine.toLowerCase().indexOf(value.toLowerCase());
      if (start < 0) {
        continue;
      }
      return new vscode.Range(new vscode.Position(i, start), new vscode.Position(i, start + value.length));
    }

    return undefined;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("ini-ra2.noop", () => undefined)
  );

  // 命令：预览定义
  context.subscriptions.push(
    vscode.commands.registerCommand("ini-ra2.peekDefinition", async (param: any) => {
      try {
        // 调试：打印接收到的参数
        console.log('[INI] peekDefinition 接收参数:', param);
        console.log('[INI] 参数类型:', typeof param);

        let data;

        // 参数可能已经是对象（VS Code 自动解析），或者是字符串（需要手动解析）
        if (typeof param === 'string') {
          try {
            data = JSON.parse(param);
          } catch (parseError) {
            console.error('[INI] JSON 解析失败:', parseError, '原始参数:', param);
            vscode.window.showErrorMessage(`参数解析失败: ${parseError}`);
            return;
          }
        } else {
          // 参数已经是对象
          data = param;
        }

        const uri = vscode.Uri.parse(data.uri);
        const sectionName = data.section;

        console.log('[INI] 解析后的 URI:', uri.toString());
        console.log('[INI] 节名:', sectionName);

        if (!uri || !sectionName) {
          console.error('[INI] 缺少必要参数 - URI:', uri, '节名:', sectionName);
          return;
        }

        // 查找定义位置（支持跨文件）
        const enableMultiFile = vscode.workspace
          .getConfiguration("ini-ra2")
          .get<boolean>("enableMultiFileSearch", true);

        const definitions: vscode.Location[] = [];

        if (enableMultiFile) {
          // 使用 indexManager 进行跨文件搜索
          const sectionDefs = indexManager.findSectionDefinitions(sectionName);
          console.log('[INI] 跨文件查找到的定义数:', sectionDefs.length);

          for (const def of sectionDefs) {
            const defUri = vscode.Uri.file(def.file);
            const range = new vscode.Range(
              new vscode.Position(def.line, 0),
              new vscode.Position(def.line, 100)
            );
            definitions.push(new vscode.Location(defUri, range));
          }
        } else {
          // 仅在当前文件查找
          const document = await vscode.workspace.openTextDocument(uri);
          const text = document.getText();
          const lines = text.split("\n");

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const sectionRegex = new RegExp(`^\\[\\s*${sectionName}\\s*\\]`);
            if (sectionRegex.test(trimmed)) {
              const range = new vscode.Range(
                new vscode.Position(i, 0),
                new vscode.Position(i, line.length)
              );
              definitions.push(new vscode.Location(uri, range));
            }
          }
          console.log('[INI] 当前文件查找到的定义数:', definitions.length);
        }

        if (definitions.length === 0) {
          console.warn('[INI] 未找到节名的定义:', sectionName);
          vscode.window.showWarningMessage(`未找到节 [${sectionName}] 的定义`);
          return;
        }

        // 获取当前编辑器位置
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          console.error('[INI] 没有活跃编辑器');
          return;
        }

        console.log('[INI] 调用 peekLocations 命令，定义数:', definitions.length);

        // 调用 peekLocations 命令
        vscode.commands.executeCommand(
          'editor.action.peekLocations',
          uri,
          editor.selection.active,
          definitions,
          'peek',
          'Definitions'
        );
      } catch (error) {
        console.error('[INI] peekDefinition 命令执行失败:', error);
        vscode.window.showErrorMessage(`预览定义失败: ${error}`);
      }
    })
  );

  // 命令：注册节名到注册表
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ini-ra2.registerSection",
      async (document: vscode.TextDocument, sectionName: string, registerName: string) => {
        const edit = await registerHelper.generateRegisterCode(document, sectionName, registerName);
        if (edit) {
          const applied = await vscode.workspace.applyEdit(edit);
          if (applied) {
            vscode.window.showInformationMessage(`已将 [${sectionName}] 注册到 [${registerName}]`);
            await unregisteredSectionsProvider.refresh();
          } else {
            vscode.window.showErrorMessage("注册失败");
          }
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ini-ra2.quickRegisterSection",
      async (
        uri: vscode.Uri,
        sectionName: string,
        codeLensCandidates?: string[],
        codeLensPreviewTarget?: string
      ) => {
        try {
          const document = await vscode.workspace.openTextDocument(uri);
          const inferredCandidates = registerHelper.inferRegisterNamesForSection(sectionName);
          const candidatePool = codeLensCandidates && codeLensCandidates.length > 0
            ? codeLensCandidates
            : inferredCandidates;

          if (candidatePool.length === 0) {
            vscode.window.showWarningMessage(`无法自动注册 [${sectionName}]：没有可用注册列表`);
            return;
          }

          const targetRegister =
            codeLensPreviewTarget && candidatePool.includes(codeLensPreviewTarget)
              ? codeLensPreviewTarget
              : candidatePool[0];

          if (!targetRegister) {
            return;
          }

          const edit = await registerHelper.generateRegisterCode(document, sectionName, targetRegister);
          const applied = edit ? await vscode.workspace.applyEdit(edit) : false;
          if (applied) {
            const viewAction = "查看位置";
            const action = await vscode.window.showInformationMessage(
              `已注册 [${sectionName}] 到 [${targetRegister}]`,
              viewAction
            );
            if (action === viewAction) {
              const range = await findRegisteredEntryRange(uri, targetRegister, sectionName);
              if (range) {
                await revealRangeInEditor(uri, range);
              } else {
                vscode.window.showWarningMessage(`已注册，但未定位到 [${sectionName}] 的注册行`);
              }
            }
            await unregisteredSectionsProvider.refresh();
          } else {
            vscode.window.showWarningMessage(`注册失败: [${sectionName}]`);
          }
        } catch (err) {
          vscode.window.showErrorMessage(`注册失败: ${err}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ini-ra2.quickRegisterSectionChoose",
      async (
        uri: vscode.Uri,
        sectionName: string,
        codeLensCandidates?: string[]
      ) => {
        try {
          const document = await vscode.workspace.openTextDocument(uri);
          const inferredCandidates = registerHelper.inferRegisterNamesForSection(sectionName);
          const candidatePool = codeLensCandidates && codeLensCandidates.length > 0
            ? codeLensCandidates
            : inferredCandidates;

          if (candidatePool.length === 0) {
            vscode.window.showWarningMessage(`无法注册 [${sectionName}]：没有可用注册列表`);
            return;
          }

          const targetRegister = (await vscode.window.showQuickPick(
            candidatePool.map((name) => ({
              label: `[${name}]`,
              description: registerHelper.getRegisterLabel(name),
              value: name,
            })),
            { placeHolder: `选择 ${sectionName} 注册到哪个列表` }
          ))?.value;

          if (!targetRegister) {
            return;
          }

          const edit = await registerHelper.generateRegisterCode(document, sectionName, targetRegister);
          const applied = edit ? await vscode.workspace.applyEdit(edit) : false;
          if (applied) {
            const viewAction = "查看位置";
            const action = await vscode.window.showInformationMessage(
              `已注册 [${sectionName}] 到 [${targetRegister}]`,
              viewAction
            );
            if (action === viewAction) {
              const range = await findRegisteredEntryRange(uri, targetRegister, sectionName);
              if (range) {
                await revealRangeInEditor(uri, range);
              } else {
                vscode.window.showWarningMessage(`已注册，但未定位到 [${sectionName}] 的注册行`);
              }
            }
            await unregisteredSectionsProvider.refresh();
          } else {
            vscode.window.showWarningMessage(`注册失败: [${sectionName}]`);
          }
        } catch (err) {
          vscode.window.showErrorMessage(`注册失败: ${err}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ini-ra2.quickRegisterSectionByName",
      async (sectionName: string) => {
        const applied = await registerHelper.registerSectionByName(sectionName);
        if (applied) {
          vscode.window.showInformationMessage(`已注册 [${sectionName}]`);
          await unregisteredSectionsProvider.refresh();
        } else {
          vscode.window.showWarningMessage(`注册失败: [${sectionName}]`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ini-ra2.registerAllUnregisteredSections",
      async () => {
        const allSections = await registerHelper.getAllDefinedSectionsGlobal();
        const registered = registerHelper.getRegisteredSectionsGlobal();
        const unregistered = allSections.filter((s) => !registered.has(s.name));

        if (unregistered.length === 0) {
          vscode.window.showInformationMessage("没有可批量注册的节");
          return;
        }

        let success = 0;
        for (const section of unregistered) {
          const registerNames = registerHelper.inferRegisterNamesForSection(section.name);
          const targetRegister = registerNames[0];
          if (!targetRegister) {
            continue;
          }
          const applied = await registerHelper.registerSectionByName(section.name, targetRegister);
          if (applied) {
            success++;
          }
        }

        await unregisteredSectionsProvider.refresh();
        vscode.window.showInformationMessage(`批量注册完成: ${success}/${unregistered.length}`);
      }
    )
  );

  // 命令：手动检查重复配置
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

  // 命令：重新加载词典
  context.subscriptions.push(
    vscode.commands.registerCommand("ini.reloadTranslations", () => {
      try {
        translationLoader.reload();
        // 更新translations引用（因为是对象引用，已经自动更新）
        outputChannel.appendLine("词典重新加载成功");
        vscode.window.showInformationMessage("INI 词典已重新加载");
      } catch (error) {
        outputChannel.appendLine(`重新加载词典失败: ${error}`);
        vscode.window.showErrorMessage(`重新加载词典失败: ${error}`);
      }
    })
  );

  // 命令：格式化文档
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

  // 注意：主的 formattingProvider 已在前面定义，包含了完整的格式化逻辑
  // 不再使用 formatter.ts 中的提供者（避免冲突）

  // 命令：重建索引
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
        async (progress) => {
          indexManager.clear();
          await indexManager.indexWorkspace();
          vscode.window.showInformationMessage("INI 文件索引已重建");
        }
      );
    })
  );

  // 命令：INI 配置参考 (ARES & Phobos)
  context.subscriptions.push(
    vscode.commands.registerCommand("ini-ra2.insertIniReference", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "ini") {
        await showIniReferenceQuickPick(editor);
      } else {
        vscode.window.showWarningMessage("请在 INI 文件中运行此命令");
      }
    })
  );

  // 命令：显示统计面板
  context.subscriptions.push(
    vscode.commands.registerCommand("ini-ra2.showStatistics", async () => {
      await vscode.commands.executeCommand("iniStatistics.focus");
    })
  );

  // 命令：批量重命名键（交互式选择引用）
  context.subscriptions.push(
    vscode.commands.registerCommand('ini-ra2.batchRenameKeys', async () => {
      const editor = vscode.window.activeTextEditor;
      await batchRenameKeysCommand(editor);
    })
  );

  // 命令：官方批量重命名（带预览）
  context.subscriptions.push(
    vscode.commands.registerCommand('ini-ra2.batchRename', async () => {
      if (!autoRenameDetectorInstance) {
        vscode.window.showWarningMessage('重命名服务尚未初始化');
        return;
      }

      type RenameScopeOption = { label: string; value: 'indexed' | 'current' | 'workspace' };

      const scopePick = await vscode.window.showQuickPick<RenameScopeOption>([
        { label: '索引文件（推荐）', value: 'indexed' },
        { label: '当前文件', value: 'current' },
        { label: '全工作区扫描（可能较慢）', value: 'workspace' }
      ], { placeHolder: '选择重命名范围' });

      if (!scopePick) { return; }
      await autoRenameDetectorInstance.runInteractiveRename(scopePick.value);
    })
  );

  // 命令：查看索引与缓存状态
  context.subscriptions.push(
    vscode.commands.registerCommand('ini-ra2.showIndexStats', async () => {
      const indexStats = indexManager.getStats();
      const cacheStats = typeInference.getCacheStats();

      const summary = `索引: ${indexStats.files} 文件 / ${indexStats.sections} 节 / ${indexStats.references} 引用 / 版本 ${indexStats.globalVersion}\n缓存: 命中 ${cacheStats.hits}, 未命中 ${cacheStats.misses}, 清理 ${cacheStats.evictions}`;
      outputChannel.appendLine(summary);
      vscode.window.showInformationMessage(summary);
    })
  );

  // 命令：从其他文件复制节
  context.subscriptions.push(
    vscode.commands.registerCommand('ini-ra2.copySection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "ini") {
        vscode.window.showWarningMessage("请在 INI 文件中运行此命令");
        return;
      }

      try {
        // 先刷新索引，确保删除的文件已经从索引中移除
        await indexManager.indexWorkspace();

        // 获取所有节定义
        const allSections = indexManager.getAllSections();
        if (allSections.size === 0) {
          vscode.window.showInformationMessage("未找到任何 INI 节");
          return;
        }

        // 收集所有节的定义信息，包括文件路径和注释
        const sectionItems = [];
        for (const sectionName of allSections) {
          const definitions = indexManager.findSectionDefinitions(sectionName);
          for (const definition of definitions) {
            // 检查文件是否在当前工作区内
            const fileUri = vscode.Uri.file(definition.file);
            const relativePath = vscode.workspace.asRelativePath(fileUri, false);

            // 如果文件不在工作区内，跳过
            if (relativePath.startsWith('..')) {
              continue;
            }

            // 读取文件内容，提取节名后面的注释
            let comment = "";
            try {
              const document = await vscode.workspace.openTextDocument(fileUri);
              const sectionLine = document.lineAt(definition.line).text;
              const commentMatch = sectionLine.match(/\]\s*([;#])\s*(.+)$/);
              if (commentMatch) {
                comment = commentMatch[2].trim();
              }
            } catch (e) {
              // 文件可能已被删除，跳过
              continue;
            }

            const fileName = path.basename(definition.file);
            sectionItems.push({
              label: comment ? `[${sectionName}]     ; ${comment}` : sectionName,
              description: "",
              detail: `来自文件: ${fileName}`,
              comment: comment,
              definition: definition
            });
          }
        }

        // 排序
        sectionItems.sort((a, b) => {
          if (a.label !== b.label) {
            return a.label.localeCompare(b.label);
          }
          return a.description.localeCompare(b.description);
        });

        // 让用户选择一个节
        const selectedItem = await vscode.window.showQuickPick(sectionItems, {
          placeHolder: "选择要复制的节（可按节名、路径或注释搜索）",
          matchOnDescription: true,
          matchOnDetail: true,
          onDidSelectItem: (item) => {
            // 可以在这里添加额外的选择逻辑
          }
        });

        if (!selectedItem) {
          return;
        }

        // 获取选中的定义
        const definition = selectedItem.definition;
        const fileUri = vscode.Uri.file(definition.file);

        try {
          const document = await vscode.workspace.openTextDocument(fileUri);
          const lines = document.getText().split("\n");

          // 提取节内容，包括节名后面的注释
          const sectionLine = lines[definition.line];
          let sectionContent = sectionLine + "\n";
          let currentLine = definition.line + 1;

          // 读取直到下一个节或文件末尾
          while (currentLine < lines.length) {
            const line = lines[currentLine].trim();
            if (line.startsWith("[")) {
              break;
            }
            sectionContent += lines[currentLine] + "\n";
            currentLine++;
          }

          // 插入到当前文件
          await editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, sectionContent);
          });

          vscode.window.showInformationMessage(`已从 ${path.basename(definition.file)} 复制节 ${selectedItem.label}`);
        } catch (e) {
          vscode.window.showErrorMessage(`无法读取文件 ${path.basename(definition.file)}，可能已被删除`);
        }
      } catch (error) {
        console.error('[INI] 复制节失败:', error);
        vscode.window.showErrorMessage(`复制节失败: ${error}`);
      }
    })
  );

  // 命令：刷新统计信息
  context.subscriptions.push(
    vscode.commands.registerCommand("ini-ra2.refreshStatistics", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "ini") {
        await statisticsTreeProvider.refresh(editor.document);
        vscode.window.showInformationMessage("统计信息已刷新");
      }
    })
  );

  // VS Code 官方重命名支持（F2）
  const renameProvider = vscode.languages.registerRenameProvider("ini", {
    prepareRename(document, position) {
      const symbol = autoRenameDetectorInstance?.identifySymbolAtPosition(document, position);
      if (!symbol) {
        throw new Error("仅支持在节头或键名上重命名");
      }
      return symbol.range;
    },
    async provideRenameEdits(document, position, newName) {
      if (!autoRenameDetectorInstance) { return null; }
      const trimmed = newName.trim();
      if (!trimmed) { return null; }
      return autoRenameDetectorInstance.buildEditForProvider(document, position, trimmed, 'indexed');
    }
  });

  // 注册所有提供者
  const providers = [
    completionProvider,
    registerCompletionProvider,
    definitionProvider,
    referenceProvider,
    symbolProvider,
    codeLensProvider,
    formattingProvider,
    foldingProvider,
    hoverProvider,
    codeActionProvider,
    registerCodeActionProvider,
    renameProvider
  ];

  // 条件性注册 linkProvider
  if (linkProvider) {
    providers.push(linkProvider);
  }

  context.subscriptions.push(...providers);

  outputChannel.appendLine("所有功能已成功注册");
}

export function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
  // 清理所有装饰类型
  scopeDecorationTypes.forEach(decorationType => {
    decorationType.dispose();
  });
  scopeDecorationTypes.clear();
  if (outputChannel) {
    outputChannel.appendLine("INI RA2扩展已停用");
    outputChannel.dispose();
  }
}
