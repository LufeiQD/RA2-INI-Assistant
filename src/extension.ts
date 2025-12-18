// const vscode = require("vscode");
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

// 定义翻译数据类型
interface Translations {
  common: { [key: string]: string };
  sections: { [key: string]: string };
  values: { [key: string]: string };
}
// 诊断收集器
let diagnosticCollection: vscode.DiagnosticCollection;
/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context: {
  extensionPath: string;
  subscriptions: vscode.Disposable[];
}) {
  console.log("INI RA2扩展已激活");

  // 加载翻译数据
  let translations: Translations = {
    common: {},
    sections: {},
    values: {},
  };
  let translationFile = "";
  // 尝试多个可能的路径
  const possiblePaths = [
    path.join(context.extensionPath, "dist", "assets", "translations.json"),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      translationFile = p;
      break;
    }
  }

  if (translationFile) {
    try {
      const data = fs.readFileSync(translationFile, "utf8");
      const loaded = JSON.parse(data);
      if (loaded.common) {
        translations.common = { ...translations.common, ...loaded.common };
      }
      if (loaded.sections) {
        translations.sections = {
          ...translations.sections,
          ...loaded.sections,
        };
      }
    } catch (error) {
      console.error("加载翻译失败:", error);
    }
  } else {
    console.log("未找到翻译文件，将使用空数据");
  }

  console.log("1 可用的键翻译数量:", Object.keys(translations.common).length);
  console.log("2 可用的节翻译数量:", Object.keys(translations.sections).length);

  // 注册悬浮提示
  const hoverProvider = vscode.languages.registerHoverProvider("ini", {
    provideHover(
      document: {
        lineAt: (arg0: any) => any;
        getWordRangeAtPosition: (arg0: any) => any;
        getText: (arg0: any) => any;
      },
      position: { line: any; character: number },
      token: any
    ) {
      console.log("悬浮提示被触发，位置:", position.line, position.character);

      // 获取当前行
      const line = document.lineAt(position.line);
      const lineText = line.text;
      console.log("当前行文本:", lineText);

      // 获取鼠标位置的单词
      const wordRange = document.getWordRangeAtPosition(position);
      if (!wordRange) {
        console.log("未获取到单词范围");
        return null;
      }

      const hoveredWord = document.getText(wordRange);
      console.log("悬停的单词:", hoveredWord);

      // ========== 处理节名 [name] ==========
      if (lineText.startsWith("[") && lineText.endsWith("]")) {
        const sectionName = hoveredWord;

        // 检查是否在节名范围内
        const bracketStart = lineText.indexOf("[");
        const bracketEnd = lineText.indexOf("]");
        console.log(
          lineText,
          position.character,
          bracketStart + 1,
          position.character,
          bracketEnd - 1
        );

        if (
          position.character >= bracketStart + 1 &&
          position.character <= bracketEnd - 1
        ) {
          console.log("ssssss在范围nei", translations.sections, sectionName);
          // 在节名范围内
          if (translations.sections[sectionName]) {
            const content = new vscode.MarkdownString();
            content.appendMarkdown(`### [${sectionName}]\n\n`);
            content.appendMarkdown(translations.sections[sectionName]);
            content.isTrusted = true;

            return new vscode.Hover(content);
          }
          //    else {
          //     // 即使没有翻译，也显示基础信息
          //     const content = new vscode.MarkdownString();
          //     content.appendMarkdown(`### [${sectionName}]\n\n`);
          //     content.appendMarkdown(
          //       "这是一个配置节，表示一个新的配置块开始。\n\n"
          //     );
          //     content.appendMarkdown("**常见节类型：**\n");
          //     content.appendMarkdown("- 单位定义: `[E1]`, `[MTNK]`\n");
          //     content.appendMarkdown("- 武器定义: `[M60]`, `[120mm]`\n");
          //     content.appendMarkdown("- 建筑定义: `[GAPILE]`, `[GAREFN]`\n");
          //     content.appendMarkdown("- 音效定义: `[Sound]` 等");
          //     content.isTrusted = true;

          //     return new vscode.Hover(content);
          //   }
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
          if (translations.common[key]) {
            const content = new vscode.MarkdownString();
            content.appendMarkdown(`### ${key}\n\n`);
            content.appendMarkdown(translations.common[key]);
            content.isTrusted = true;

            // 显示当前行的值
            const value = lineText.substring(equalsIndex + 1).trim();
            const commentIndex = Math.min(
              value.indexOf(";") >= 0 ? value.indexOf(";") : Infinity,
              value.indexOf("#") >= 0 ? value.indexOf("#") : Infinity
            );

            const actualValue =
              commentIndex < Infinity
                ? value.substring(0, commentIndex).trim()
                : value;

            if (actualValue) {
              content.appendMarkdown(`\n\n**当前值:** \`${actualValue}\``);

              // 如果是布尔值，显示翻译
              const lowerValue = actualValue.toLowerCase();
              if (
                lowerValue === "yes" ||
                lowerValue === "no" ||
                lowerValue === "true" ||
                lowerValue === "false"
              ) {
                content.appendMarkdown(
                  `\n**含义:** ${
                    lowerValue === "yes" || lowerValue === "true"
                      ? "是/启用"
                      : "否/禁用"
                  }`
                );
              }
            }

            return new vscode.Hover(content);
          }
        }
      }

      return null;
    },
  });

  // 注册格式化
  const formattingProvider =
    vscode.languages.registerDocumentFormattingEditProvider("ini", {
      provideDocumentFormattingEdits(
        document: { getText: () => any; positionAt: (arg0: number) => any },
        options: any
      ) {
        const text = document.getText();
        const lines = text.split("\n");
        const formattedLines: string[] = [];

        let lastLineWasSection = false;
        let lastLineWasEmpty = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmedLine = line.trim();

          // 跳过文件开头的连续空行
          if (trimmedLine === "" && formattedLines.length === 0) {
            continue;
          }

          // 处理节标题
          if (trimmedLine.startsWith("[") && trimmedLine.endsWith("]")) {
            // 在节前添加空行（如果不是第一个节）
            if (formattedLines.length > 0 && !lastLineWasEmpty) {
              formattedLines.push("");
            }

            formattedLines.push(trimmedLine);
            lastLineWasSection = true;
            lastLineWasEmpty = false;
            continue;
          }

          // 处理注释
          if (trimmedLine.startsWith(";") || trimmedLine.startsWith("#")) {
            // 注释前不需要空行，直接添加
            formattedLines.push(line); // 保持原有缩进
            lastLineWasSection = false;
            lastLineWasEmpty = false;
            continue;
          }

          // 处理键值对
          const equalsIndex = trimmedLine.indexOf("=");
          if (equalsIndex > 0) {
            const beforeEquals = trimmedLine.substring(0, equalsIndex);
            const afterEquals = trimmedLine.substring(equalsIndex + 1);

            // 清理键：去除所有空格
            const cleanKey = beforeEquals.replace(/\s+/g, "");

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
            let formattedLine = `${cleanKey}=${cleanValue}`;
            if (comment) {
              // 在值和注释之间添加一个空格
              if (!cleanValue.endsWith(" ") && !comment.startsWith(" ")) {
                formattedLine += " ";
              }
              formattedLine += comment;
            }

            formattedLines.push(formattedLine);
            lastLineWasSection = false;
            lastLineWasEmpty = false;
            continue;
          }

          // 处理空行
          if (trimmedLine === "") {
            // 不添加连续的空行
            if (!lastLineWasEmpty && formattedLines.length > 0) {
              formattedLines.push("");
              lastLineWasEmpty = true;
            }
            lastLineWasSection = false;
            continue;
          }

          // 其他行保持原样
          formattedLines.push(line);
          lastLineWasSection = false;
          lastLineWasEmpty = false;
        }

        // 移除末尾的空行
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
      },
    });

  // 注册行尾注释命令
  const addCommentCommand = vscode.commands.registerCommand(
    "ini.addComment",
    function () {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "ini") {
        return;
      }

      const document = editor.document;
      const selection = editor.selection;

      // 获取当前行的文本
      const line = document.lineAt(selection.active.line);
      const lineText = line.text;

      // 计算缩进（制表符或空格）
      const indentMatch = lineText.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : "";

      // 检查是否已有注释
      if (lineText.includes(";")) {
        vscode.window.showInformationMessage("此行已有注释！");
        return;
      }

      // 计算需要添加的空格以达到下一个制表位
      const tabSize = (editor.options.tabSize as number) || 4;
      const currentLength = lineText.length;
      const spacesToAdd = tabSize - (currentLength % tabSize);

      // 创建新的行文本
      const newText = lineText + " ".repeat(spacesToAdd) + "; ";

      // 创建编辑
      editor
        .edit((editBuilder) => {
          const lineRange = new vscode.Range(line.range.start, line.range.end);
          editBuilder.replace(lineRange, newText);
        })
        .then(() => {
          // 将光标定位到注释后
          const newPosition = new vscode.Position(
            selection.active.line,
            newText.length - 1
          );
          const newSelection = new vscode.Selection(newPosition, newPosition);
          editor.selection = newSelection;
        });
    }
  );

  // 注册节折叠范围提供者
  const foldingProvider = vscode.languages.registerFoldingRangeProvider("ini", {
    provideFoldingRanges(document: { getText: () => any }, context: any) {
      const foldingRanges = [];
      const text = document.getText();
      const lines = text.split("\n");

      let sectionStart = -1;
      let sectionName = "";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // 检测节头
        if (line.startsWith("[") && line.endsWith("]")) {
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

  // ========== 重复定义检测（只检测不修复） ==========
  // 创建诊断收集器（只用于显示警告）
  diagnosticCollection = vscode.languages.createDiagnosticCollection("ini");
  context.subscriptions.push(diagnosticCollection);

  // 检测函数
  function checkDuplicateDefinitions(document: vscode.TextDocument) {
    if (document.languageId !== "ini") {
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    const lines = text.split("\n");

    let currentSection = "";
    // 存储每个节下的键定义位置：section -> key -> {originalKey, lineNumbers}
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
        trimmedLine.startsWith("#")
      ) {
        continue;
      }

      // 检测节开始
      if (trimmedLine.startsWith("[") && trimmedLine.endsWith("]")) {
        currentSection = trimmedLine;
        continue;
      }

      // 检测键值对（只处理当前节内的）
      const equalsIndex = trimmedLine.indexOf("=");
      if (equalsIndex > 0 && currentSection) {
        const originalKey = trimmedLine.substring(0, equalsIndex).trim();
        const normalizedKey = originalKey.toLowerCase(); // 转换为小写用于比较

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
            // 获取该行中实际的键名（保持原始大小写）
            const lineEqualsIndex = duplicateLine.indexOf("=");
            const lineKey = duplicateLine.substring(0, lineEqualsIndex).trim();
            const keyStart = duplicateLine.indexOf(lineKey);
            const keyEnd = keyStart + lineKey.length;

            // 创建警告范围
            const range = new vscode.Range(
              new vscode.Position(lineNum, keyStart),
              new vscode.Position(lineNum, keyEnd)
            );

            // 创建诊断（警告级别）
            const diagnostic = new vscode.Diagnostic(
              range,
              `⚠️ 重复定义: "${lineKey}" 在节 ${currentSection} 中已定义多次`,
              vscode.DiagnosticSeverity.Warning
            );

            diagnostic.source = "INI重复定义检测";
            diagnostic.code = "RA2-INI-Assistant";

            diagnostics.push(diagnostic);
          });
        } else {
          // 第一次出现，记录行号
          keyMap.set(normalizedKey, {
            originalKey: originalKey,
            lineNumbers: [i],
          });
        }
      }
    }

    // 设置诊断警告
    diagnosticCollection.set(document.uri, diagnostics);

    // 如果有重复，显示通知（可选）
    if (diagnostics.length > 0) {
      console.log(`检测到 ${diagnostics.length} 个重复定义警告`);
    }
  }

  // ========== 监听文档变化 ==========

  // 1. 文档内容变化时检测
  vscode.workspace.onDidChangeTextDocument((event: { document: any }) => {
    checkDuplicateDefinitions(event.document);
  });

  // 2. 文档打开时检测
  vscode.workspace.onDidOpenTextDocument((document: any) => {
    checkDuplicateDefinitions(document);
  });

  // 3. 文档保存时检测
  vscode.workspace.onDidSaveTextDocument((document: any) => {
    checkDuplicateDefinitions(document);
  });

  // 4. 初始化时检测当前文档
  if (vscode.window.activeTextEditor) {
    checkDuplicateDefinitions(vscode.window.activeTextEditor.document);
  }
  // 注册所有提供者
  context.subscriptions.push(
    formattingProvider,
    addCommentCommand,
    foldingProvider,
    hoverProvider
  );
}

function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
}

module.exports = {
  activate,
  deactivate,
};
