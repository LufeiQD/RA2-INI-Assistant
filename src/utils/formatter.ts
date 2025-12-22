/**
 * INI 文件格式化功能
 * 修复常见的节名格式错误：缺少括号、中文括号、孤立的括号等
 */

import * as vscode from "vscode";

interface FormatFix {
  range: vscode.Range;
  newText: string;
  description: string;
}

/**
 * 分析 INI 文件并识别需要修复的格式问题
 */
function analyzeAndFixFormat(document: vscode.TextDocument): FormatFix[] {
  const fixes: FormatFix[] = [];
  const lines = document.getText().split("\n");
  const lineCount = lines.length;

  let i = 0;
  while (i < lineCount) {
    const trimmed = lines[i].trim();

    // 检测1: 中文括号 【Section】 -> [Section]
    if (trimmed.startsWith("【") && trimmed.includes("】")) {
      const sectionName = trimmed.slice(1, trimmed.indexOf("】"));
      const startPos = new vscode.Position(i, lines[i].indexOf("【"));
      const endPos = new vscode.Position(i, lines[i].indexOf("】") + 1);
      fixes.push({
        range: new vscode.Range(startPos, endPos),
        newText: `[${sectionName}]`,
        description: "中文括号 -> 英文括号"
      });
      i++;
      continue;
    }

    // 检测2: 缺少闭括号的节名 [Section (后面跟着配置项)
    if (trimmed.startsWith("[") && !trimmed.includes("]")) {
      const sectionName = trimmed.slice(1);

      // 查看后续行，确认是否有配置项
      let hasConfig = false;
      let endLine = i + 1;

      while (endLine < lineCount && endLine < i + 10) {
        const nextTrimmed = lines[endLine].trim();

        // 遇到新的节头或其他开括号，停止
        if (nextTrimmed.startsWith("[") || nextTrimmed.startsWith("【")) {
          break;
        }

        // 检查是否是配置项（含有 = 或 +=）
        if (nextTrimmed.includes("=") && !nextTrimmed.startsWith(";") && !nextTrimmed.startsWith("#")) {
          hasConfig = true;
          break;
        }

        // 跳过空行和注释
        if (nextTrimmed === "" || nextTrimmed.startsWith(";") || nextTrimmed.startsWith("#")) {
          endLine++;
          continue;
        }

        // 如果是孤立的闭括号或其他内容，停止
        break;
      }

      if (hasConfig) {
        // 在该行末尾添加闭括号
        const lineLength = lines[i].length;
        fixes.push({
          range: new vscode.Range(i, lineLength, i, lineLength),
          newText: "]",
          description: "添加缺失的闭括号"
        });
      }

      i++;
      continue;
    }

    // 检测3: 孤立的闭括号 或 包含闭括号的行，且前面不是完整节名
    // 例如 sjj] 或单独的 ]
    if ((trimmed === "]" || trimmed.endsWith("]")) && !trimmed.startsWith("[")) {
      // 如果是单纯的 ] 或末尾是 ]，且不是有效的闭合
      if (trimmed === "]") {
        // 完全删除这个孤立的闭括号
        const startPos = new vscode.Position(i, 0);
        const endPos = new vscode.Position(i, lines[i].length);
        fixes.push({
          range: new vscode.Range(startPos, endPos),
          newText: "",
          description: "删除孤立的闭括号"
        });
      } else {
        // 例如 sjj] - 提取可能的节名 sjj，将其转换为 [sjj]
        const match = trimmed.match(/^([^\s]+)\]$/);
        if (match) {
          const possibleSection = match[1];
          // 检查前面是否有未闭合的节
          let hasUnclosedSection = false;
          for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
            const prevTrimmed = lines[j].trim();
            if (prevTrimmed.startsWith("[") && !prevTrimmed.includes("]")) {
              hasUnclosedSection = true;
              break;
            }
            if (prevTrimmed.startsWith("[") && prevTrimmed.includes("]")) {
              break;
            }
          }

          if (hasUnclosedSection) {
            // 转换为完整的节名
            const startPos = new vscode.Position(i, 0);
            const endPos = new vscode.Position(i, lines[i].length);
            fixes.push({
              range: new vscode.Range(startPos, endPos),
              newText: `[${possibleSection}]`,
              description: `修复节名: ${possibleSection}`
            });
          }
        }
      }

      i++;
      continue;
    }

    i++;
  }

  return fixes;
}

/**
 * 创建格式化提供者
 */
export function createFormattingProvider(): vscode.DocumentFormattingEditProvider {
  return {
    provideDocumentFormattingEdits(
      document: vscode.TextDocument,
      options: vscode.FormattingOptions,
      token: vscode.CancellationToken
    ): vscode.TextEdit[] {
      if (document.languageId !== "ini") {
        return [];
      }

      const fixes = analyzeAndFixFormat(document);

      // 将 FormatFix 转换为 TextEdit
      return fixes.map(fix => new vscode.TextEdit(fix.range, fix.newText));
    }
  };
}

/**
 * 创建范围格式化提供者
 */
export function createRangeFormattingProvider(): vscode.DocumentRangeFormattingEditProvider {
  return {
    provideDocumentRangeFormattingEdits(
      document: vscode.TextDocument,
      range: vscode.Range,
      options: vscode.FormattingOptions,
      token: vscode.CancellationToken
    ): vscode.TextEdit[] {
      if (document.languageId !== "ini") {
        return [];
      }

      const fixes = analyzeAndFixFormat(document);

      // 只返回在选中范围内的修复
      return fixes
        .filter(fix => fix.range.start.line >= range.start.line && fix.range.end.line <= range.end.line)
        .map(fix => new vscode.TextEdit(fix.range, fix.newText));
    }
  };
}
