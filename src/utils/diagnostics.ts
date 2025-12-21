/**
 * INI 文件诊断功能
 * 负责检测重复定义、语法错误等问题
 */

import * as vscode from "vscode";

export function setupDiagnostics(
  diagnosticCollection: vscode.DiagnosticCollection
): (document: vscode.TextDocument) => void {
  return function checkDuplicateDefinitions(
    document: vscode.TextDocument
  ): void {
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

      // 检测不完整或格式错误的节名
      if (trimmedLine.startsWith("[")) {
        // 检查是否缺少闭括号
        if (!trimmedLine.includes("]")) {
          const range = new vscode.Range(
            new vscode.Position(i, 0),
            new vscode.Position(i, line.length)
          );
          const diagnostic = new vscode.Diagnostic(
            range,
            "节名格式错误：缺少闭括号 ']'",
            vscode.DiagnosticSeverity.Error
          );
          diagnostic.source = "INI语法检测";
          diagnostic.code = "invalid-section-format";
          diagnostics.push(diagnostic);
          continue;
        }
        // 检查是否不在行尾闭合或包含非法字符（允许后面有注释）
        if (!trimmedLine.match(/^\[[^\]\r\n]+\](\s*(;|#|\/).*)?$/)) {
          const range = new vscode.Range(
            new vscode.Position(i, 0),
            new vscode.Position(i, line.length)
          );
          const diagnostic = new vscode.Diagnostic(
            range,
            "节名格式错误：括号内包含非法字符或格式不正确",
            vscode.DiagnosticSeverity.Error
          );
          diagnostic.source = "INI语法检测";
          diagnostic.code = "invalid-section-format";
          diagnostics.push(diagnostic);
          continue;
        }
      }

      // 处理行内注释
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

      // 检测节开始
      if (contentLine.startsWith("[") && contentLine.endsWith("]")) {
        currentSection = contentLine;
        continue;
      }

      // 检测是否有等号
      const equalsIndex = contentLine.indexOf("=");
      const appendIndex = contentLine.indexOf("+=");

      // 处理 += 操作
      if (appendIndex !== -1 && currentSection) {
        let originalKey = "";
        let afterAppend = "";

        if (contentLine.startsWith("+=")) {
          originalKey = "";
          afterAppend = contentLine.substring(2).trim();
        } else if (appendIndex > 0) {
          originalKey = contentLine.substring(0, appendIndex).trim();
          afterAppend = contentLine.substring(appendIndex + 2).trim();

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

        if (afterAppend === "") {
          let errorStart = 0;
          let errorEnd = line.length;

          if (originalKey) {
            const originalKeyIndex = line.indexOf(originalKey);
            if (originalKeyIndex !== -1) {
              errorStart = originalKeyIndex;
              errorEnd = errorStart + originalKey.length + 2;
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

        continue;
      }

      // 处理普通等号
      else if (equalsIndex > 0 && currentSection) {
        const originalKey = contentLine.substring(0, equalsIndex).trim();
        const normalizedKey = originalKey.toLowerCase();

        // 跳过某些常用键的重复检测
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
          continue;
        }

        if (!sectionKeyMap.has(currentSection)) {
          sectionKeyMap.set(currentSection, new Map());
        }

        const keyMap = sectionKeyMap.get(currentSection)!;

        if (keyMap.has(normalizedKey)) {
          const entry = keyMap.get(normalizedKey)!;
          entry.lineNumbers.push(i);

          entry.lineNumbers.forEach((lineNum) => {
            const duplicateLine = lines[lineNum];
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

              const range = new vscode.Range(
                new vscode.Position(lineNum, keyStart),
                new vscode.Position(lineNum, keyEnd)
              );

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
          keyMap.set(normalizedKey, {
            originalKey: originalKey,
            lineNumbers: [i],
          });
        }
      }
      // 处理缺失等号的情况
      else if (contentLine !== "" && currentSection) {
        const isPotentialKey =
          !contentLine.startsWith("[") &&
          !contentLine.startsWith(";") &&
          !contentLine.startsWith("#") &&
          contentLine.length > 0;

        if (isPotentialKey) {
          let possibleKey = contentLine;
          let diagnosticMessage = "";
          let diagnosticSeverity = vscode.DiagnosticSeverity.Warning;

          const spaceIndex = contentLine.indexOf(" ");
          const tabIndex = contentLine.indexOf("\t");
          const separatorIndex = spaceIndex > -1 ? spaceIndex : tabIndex;

          if (separatorIndex > 0) {
            possibleKey = contentLine.substring(0, separatorIndex).trim();
            diagnosticMessage = `❌ 语法错误: 键 "${possibleKey}" 中间缺少等号(=)`;
            diagnosticSeverity = vscode.DiagnosticSeverity.Error;
          } else {
            possibleKey = contentLine;
            diagnosticMessage = `⚠️ 语法问题: "${possibleKey}" 缺少等号和值，应为 ${possibleKey}=你要的值`;
            diagnosticSeverity = vscode.DiagnosticSeverity.Warning;
          }

          const keyStart = line.indexOf(possibleKey);
          const keyEnd = keyStart + possibleKey.length;

          const range = new vscode.Range(
            new vscode.Position(i, keyStart),
            new vscode.Position(i, keyEnd)
          );

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

    diagnosticCollection.set(document.uri, diagnostics);
  };
}
