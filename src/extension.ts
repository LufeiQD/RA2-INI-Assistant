/**
 * @name RA2-INI-Assistant 红警2ini适用的一款简单的插件
 * @description 红警2ini适用的插件，辅助各地图作者编写ini配置，可能不适用于大型mod；
 * 词库可能会有遗漏或者错误，欢迎在战网作者群联系原作者补充或者修改；
 * 插件文档请查看README.md文件
 * @author 橙猫猫三天睡不着(qq:183354595)
 * @note 作者声明：本插件为简易工具，仅作辅助编写使用，由于第一次写vscode插件，可能存在其他问题，建议使用时做好文件备份
 */

// const vscode = require("vscode");
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

// 定义词典数据类型
interface Translations {
  common: { [key: string]: string };
  sections: { [key: string]: string };
  values: { [key: string]: string };
  registerType: Array<{
    label: "";
    value: "";
  }>;
}
// 诊断收集器
let diagnosticCollection: vscode.DiagnosticCollection;

function activate(context: {
  extensionPath: string;
  subscriptions: vscode.Disposable[];
}) {
  console.log("INI RA2扩展已激活");

  // 加载词典数据
  let translations: Translations = {
    common: {},
    sections: {},
    values: {},
    registerType: [],
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
      if (loaded.registerType) {
        translations.registerType = [
          ...translations.registerType,
          ...loaded.registerType,
        ];
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        "加载词典失败，未找到对应词典文件，请联系作者排查！"
      );
      console.error("加载词典失败:", error);
    }
  } else {
    console.log("未找到词典文件，将使用空数据");
  }

  console.log(
    "可用的词典数量:",
    JSON.parse(JSON.stringify(translations)),
    Object.keys(translations).length
  );

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
          //     // 即使没有词典，也显示基础信息
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

              // 如果是布尔值，显示词典
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
  // 获取注册节名数据  -  对+=的情况做特殊处理
  const sectionsToSort: string[] = translations.registerType.map(
    (item) => item.value
  );
  // 配置项：节之间最大空行数
  const MAX_EMPTY_LINES_BETWEEN_SECTIONS = 2;
  // 配置项：注释对齐缩进（空格数）
  const COMMENT_ALIGN_INDENT = 0;

  const formattingProvider =
    vscode.languages.registerDocumentFormattingEditProvider("ini", {
      provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions
      ) {
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
          if (currentSectionLines.length === 0) return;

          const regularLines: string[] = [];
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

          // 对特定节的键值进行排序
          if (sectionsToSort.includes(currentSection)) {
            // 按key从小到大排序
            regularLines.sort((a, b) => {
              const keyA = a.split("=")[0].trim();
              const keyB = b.split("=")[0].trim();

              const numA = parseInt(keyA);
              const numB = parseInt(keyB);

              if (!isNaN(numA) && !isNaN(numB)) {
                return numA - numB;
              }

              if (!isNaN(numA) && isNaN(numB)) return -1;
              if (isNaN(numA) && !isNaN(numB)) return 1;

              return keyA.localeCompare(keyB);
            });

            // += 操作符按key排序
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

                  if (!isNaN(numA) && isNaN(numB)) return -1;
                  if (isNaN(numA) && !isNaN(numB)) return 1;

                  return keyA.localeCompare(keyB);
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

          // 处理节标题 - 匹配 [ 开头 ] 结尾的行
          if (trimmedLine.startsWith("[") && trimmedLine.includes("]")) {
            // 处理前一个节的内容
            if (inSection) {
              processSectionLines();
            }

            // 查找 ] 的位置
            const bracketEndIndex = trimmedLine.indexOf("]");
            if (bracketEndIndex > 0) {
              // 提取节名内容
              const sectionContent = trimmedLine.substring(1, bracketEndIndex);
              const afterSection = trimmedLine.substring(bracketEndIndex + 1);

              // 清理节名：去除所有空格
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
              if (formattedLines.length > 0 && !lastLineWasComment) {
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
              }

              // 添加清理后的节标题
              formattedLines.push(cleanSection);

              // 更新状态
              currentSection = `[${cleanSectionName}]`;
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
      },
    });

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

  // ========== 重复定义检测 ==========
  // 创建诊断收集器（只用于显示警告）
  diagnosticCollection = vscode.languages.createDiagnosticCollection("ini");
  context.subscriptions.push(diagnosticCollection);

  // ini-eslint 简单检测函数
  function checkDuplicateDefinitions(document: vscode.TextDocument) {
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
