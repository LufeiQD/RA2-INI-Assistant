/**
 * INI 文件诊断功能
 * 负责检测重复定义、语法错误等问题
 */

import * as vscode from "vscode";
import { IniIndexManager } from "../indexManager";
import { Translations } from "../types";

export function setupDiagnostics(
  diagnosticCollection: vscode.DiagnosticCollection,
  indexManager?: IniIndexManager,
  translations?: Translations
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

    // 记录节范围和引用信息，便于后续未定义/未使用检测
    const sectionRanges = new Map<string, { start: number; end: number }>();
    const definedSections: Array<{ name: string; line: number }> = [];
    const valueReferences: Array<{
      name: string;
      line: number;
      start: number;
      end: number;
    }> = [];

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

        const headerMatch = trimmedLine.match(/^\[([^\]\r\n]+)\]/);
        if (headerMatch) {
          const sectionName = headerMatch[1];

          // 记录节开始，上一节结束
          if (currentSection && sectionRanges.has(currentSection)) {
            sectionRanges.get(currentSection)!.end = i - 1;
          }

          currentSection = sectionName;
          sectionRanges.set(currentSection, { start: i, end: lines.length - 1 });
          definedSections.push({ name: sectionName, line: i });
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

      // 节名已在前面处理过，这里跳过
      if (contentLine.startsWith("[") && contentLine.endsWith("]")) {
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

        // 解析值引用，收集潜在的节名引用
        // 只有特定的键（如注册表键）的值才应该被视为节名引用
        const referenceKeys = new Set<string>();

        // 从 translations 中收集所有注册列表的键名（这些键的值应该是节名）
        if (translations?.typeMapping) {
          for (const typeConfig of Object.values(translations.typeMapping)) {
            for (const regName of typeConfig.registers) {
              referenceKeys.add(regName.toLowerCase());
            }
          }
        }

        // 只有在键是注册表键时，才将值视为节名引用
        if (referenceKeys.has(originalKey.toLowerCase())) {
          const rawValue = contentLine.substring(equalsIndex + 1);
          const commentSplit = Math.min(
            rawValue.indexOf(";") >= 0 ? rawValue.indexOf(";") : Infinity,
            rawValue.indexOf("#") >= 0 ? rawValue.indexOf("#") : Infinity
          );

          const valuePart = commentSplit < Infinity ? rawValue.substring(0, commentSplit) : rawValue;
          const cleanValues = valuePart
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0 && !/^\d+$/.test(v));

          let searchOffset = valuePart.indexOf(cleanValues[0] ?? "");
          for (const v of cleanValues) {
            const idx = valuePart.indexOf(v, Math.max(searchOffset, 0));
            const start = idx >= 0 ? equalsIndex + 1 + idx : equalsIndex + 1;
            const end = start + v.length;
            searchOffset = idx + v.length;

            // 排除明显不是节名的值（包含空格或路径）
            if (!v.includes(" ") && !v.includes("\\") && !v.includes("/")) {
              valueReferences.push({ name: v, line: i, start, end });
            }
          }
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

    // 记录最后一个节的结束行
    if (currentSection && sectionRanges.has(currentSection)) {
      sectionRanges.get(currentSection)!.end = lines.length - 1;
    }

    // 重复节名检测（区分大小写）
    const sectionNameMap = new Map<string, number[]>(); // 节名 -> 行号列表
    for (const section of definedSections) {
      if (!sectionNameMap.has(section.name)) {
        sectionNameMap.set(section.name, []);
      }
      sectionNameMap.get(section.name)!.push(section.line);
    }

    // 检测重复的节名
    for (const [sectionName, lineNumbers] of sectionNameMap.entries()) {
      if (lineNumbers.length > 1) {
        // 为每个重复出现的节名添加诊断
        for (const lineNum of lineNumbers) {
          const line = lines[lineNum];
          const range = new vscode.Range(
            new vscode.Position(lineNum, 0),
            new vscode.Position(lineNum, line.length)
          );

          const diagnostic = new vscode.Diagnostic(
            range,
            `⚠️ 重复的节名: [${sectionName}] 在文件中出现了 ${lineNumbers.length} 次（第 ${lineNumbers.join(", ")} 行）`,
            vscode.DiagnosticSeverity.Warning
          );

          diagnostic.source = "INI语法检测";
          diagnostic.code = "duplicate-section";

          diagnostics.push(diagnostic);
        }
      }
    }

    const enableMultiFile = vscode.workspace
      .getConfiguration("ini-ra2")
      .get<boolean>("enableMultiFileSearch", true);

    // 未定义节引用检测
    for (const ref of valueReferences) {
      const nameLower = ref.name.toLowerCase();
      const definedLocally = definedSections.some((s) => s.name.toLowerCase() === nameLower);

      let isDefined = definedLocally;
      if (!isDefined && enableMultiFile && indexManager) {
        const defs = indexManager.findSectionDefinitions(ref.name);
        isDefined = defs.length > 0;
      }

      if (!isDefined) {
        const range = new vscode.Range(
          new vscode.Position(ref.line, Math.max(ref.start, 0)),
          new vscode.Position(ref.line, Math.max(ref.end, 0))
        );
        const diagnostic = new vscode.Diagnostic(
          range,
          `未定义的节引用: ${ref.name}`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.source = "INI语法检测";
        diagnostic.code = {
          value: "undefined-section",
          target: vscode.Uri.parse(`section:${encodeURIComponent(ref.name)}`)
        };
        diagnostics.push(diagnostic);
      }
    }

    // 未使用节检测
    // 收集原版节名和注册表节名（这些节名不需要被引用）
    const registerSections = new Set<string>();
    
    // 添加原版节名（sections）- 游戏默认注册的节名
    if (translations?.sections) {
      for (const sectionName of Object.keys(translations.sections)) {
        registerSections.add(sectionName);
      }
    }
    
    // 添加注册表节名（从 registerType 中获取）
    if (translations?.registerType) {
      for (const item of translations.registerType) {
        // 从 "[RegisterName]" 格式中提取节名
        const match = item.value.match(/^\[([^\]]+)\]$/);
        if (match) {
          registerSections.add(match[1]);
        }
      }
    }

    // 收集所有注册列表中的值（这些值视为已使用的节名），统一小写匹配
    const registeredValuesLower = new Set<string>();
    if (indexManager && translations?.registerType) {
      for (const item of translations.registerType) {
        const match = item.value.match(/^\[([^\]]+)\]$/);
        const regName = match ? match[1] : undefined;
        if (!regName) { continue; }
        const vals = indexManager.getRegisteredValues(regName);
        for (const v of vals) {
          registeredValuesLower.add(v.toLowerCase());
        }
      }
    }

    for (const section of definedSections) {
      // 跳过注册表节名
      if (registerSections.has(section.name)) {
        continue;
      }

      const nameLower = section.name.toLowerCase();
      const referencedLocally = valueReferences.some((r) => r.name.toLowerCase() === nameLower);

      let hasReference = referencedLocally;
      // 注册列表已包含该节名，视为已使用
      if (!hasReference && registeredValuesLower.has(nameLower)) {
        hasReference = true;
      }
      // 跨文件引用检测（大小写不敏感，已在 IndexManager 中处理）
      if (!hasReference && enableMultiFile && indexManager) {
        const refs = indexManager.findSectionReferences(section.name);
        hasReference = refs.length > 0;
      }

      if (!hasReference) {
        const range = new vscode.Range(
          new vscode.Position(section.line, 0),
          new vscode.Position(section.line, lines[section.line]?.length ?? 0)
        );
        const diagnostic = new vscode.Diagnostic(
          range,
          `此节似乎未被引用或者词典库中不存在: [${section.name}]`,
          vscode.DiagnosticSeverity.Information
        );
        diagnostic.source = "INI引用检测";
        diagnostic.code = {
          value: "unused-section",
          target: vscode.Uri.parse(`section:${encodeURIComponent(section.name)}`)
        };
        diagnostics.push(diagnostic);
      }
    }

    diagnosticCollection.set(document.uri, diagnostics);
  };
}
