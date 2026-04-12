import * as vscode from "vscode";
import { IniIndexManager } from "../indexManager";
import { Translations } from "../types";
import { collectSectionHeaders, buildInheritanceChain } from "./sectionUtils";

export interface DiagnosticRunOptions {
  includeCrossFileChecks?: boolean;
}

type ValueReference = {
  name: string;
  line: number;
  start: number;
  end: number;
};

const SKIP_DUPLICATE_KEYS = new Set([
  "uiname",
  "name",
  "prerequisite",
  "primary",
  "strength",
  "category",
  "turnet",
  "cost",
  "armor",
  "sight",
  "speed",
]);

function stripInlineComment(line: string): string {
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if ((char === ";" || char === "#") && !inQuotes) {
      return line.substring(0, i).trim();
    }
  }

  return line.trim();
}

function collectReferenceKeys(translations?: Translations): Set<string> {
  const keys = new Set<string>();
  if (!translations?.typeMapping) {
    return keys;
  }

  for (const typeConfig of Object.values(translations.typeMapping)) {
    for (const registerName of typeConfig.registers) {
      keys.add(registerName.toLowerCase());
    }
  }

  return keys;
}

function collectRegisterSectionNames(translations?: Translations): Set<string> {
  const registerSections = new Set<string>();

  if (translations?.sections) {
    for (const sectionName of Object.keys(translations.sections)) {
      registerSections.add(sectionName);
    }
  }

  if (translations?.registerType) {
    for (const item of translations.registerType) {
      const match = item.value.match(/^\[([^\]]+)\]$/);
      if (match) {
        registerSections.add(match[1]);
      }
    }
  }

  return registerSections;
}

function collectRegisterNames(translations?: Translations): string[] {
  if (!translations?.registerType) {
    return [];
  }

  const names = new Set<string>();
  for (const item of translations.registerType) {
    const match = item.value.match(/^\[([^\]]+)\]$/);
    if (match) {
      names.add(match[1]);
    }
  }

  return Array.from(names);
}

export function setupDiagnostics(
  diagnosticCollection: vscode.DiagnosticCollection,
  indexManager?: IniIndexManager,
  translations?: Translations
): (document: vscode.TextDocument, options?: DiagnosticRunOptions) => void {
  const referenceKeys = collectReferenceKeys(translations);
  const registerSections = collectRegisterSectionNames(translations);
  const registerNames = collectRegisterNames(translations);

  return function checkDuplicateDefinitions(
    document: vscode.TextDocument,
    options?: DiagnosticRunOptions
  ): void {
    if (document.languageId !== "ini") {
      return;
    }

    const includeCrossFileChecks = options?.includeCrossFileChecks ?? true;
    const enableMultiFile =
      includeCrossFileChecks &&
      vscode.workspace
        .getConfiguration("ini-ra2")
        .get<boolean>("enableMultiFileSearch", true);

    const diagnostics: vscode.Diagnostic[] = [];
    const lines = document.getText().split("\n");

    const sectionRanges = new Map<string, { start: number; end: number }>();
    const definedSections: Array<{ name: string; line: number }> = [];
    const valueReferences: ValueReference[] = [];

    let currentSection = "";
    const sectionKeyMap = new Map<
      string,
      Map<string, { originalKey: string; lineNumbers: number[] }>
    >();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      if (
        trimmedLine === "" ||
        trimmedLine.startsWith(";") ||
        trimmedLine.startsWith("#") ||
        trimmedLine.startsWith("//")
      ) {
        continue;
      }

      if (trimmedLine.startsWith("[")) {
        if (!trimmedLine.includes("]")) {
          const range = new vscode.Range(
            new vscode.Position(i, 0),
            new vscode.Position(i, line.length)
          );
          const diagnostic = new vscode.Diagnostic(
            range,
            "节名格式错误：缺少闭括号 ]",
            vscode.DiagnosticSeverity.Error
          );
          diagnostic.source = "INI语法检测";
          diagnostic.code = "invalid-section-format";
          diagnostics.push(diagnostic);
          continue;
        }

        const bracketStart = trimmedLine.indexOf("[");
        const bracketEnd = trimmedLine.indexOf("]");
        if (bracketStart >= 0 && bracketEnd > bracketStart) {
          const sectionContent = trimmedLine
            .substring(bracketStart + 1, bracketEnd)
            .trim();
          const colonIndex = sectionContent.indexOf(":");
          const sectionName =
            colonIndex >= 0
              ? sectionContent.substring(0, colonIndex).trim()
              : sectionContent;

          if (currentSection && sectionRanges.has(currentSection)) {
            sectionRanges.get(currentSection)!.end = i - 1;
          }

          currentSection = sectionName;
          sectionRanges.set(currentSection, { start: i, end: lines.length - 1 });
          definedSections.push({ name: sectionName, line: i });
        }
      }

      const contentLine = stripInlineComment(trimmedLine);

      if (contentLine.startsWith("[") && contentLine.endsWith("]")) {
        continue;
      }

      const equalsIndex = contentLine.indexOf("=");
      const appendIndex = contentLine.indexOf("+=");

      if (appendIndex !== -1 && currentSection) {
        let originalKey = "";
        let afterAppend = "";

        if (contentLine.startsWith("+=")) {
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
              "语法错误：+= 前面缺少键名",
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
            "语法警告：+= 后面缺少值",
            vscode.DiagnosticSeverity.Warning
          );
          diagnostic.source = "INI语法检测";
          diagnostic.code = "RA2-INI-Assistant";
          diagnostics.push(diagnostic);
        }

        continue;
      }

      if (equalsIndex > 0 && currentSection) {
        const originalKey = contentLine.substring(0, equalsIndex).trim();
        const normalizedKey = originalKey.toLowerCase();

        if (SKIP_DUPLICATE_KEYS.has(normalizedKey)) {
          continue;
        }

        if (!sectionKeyMap.has(currentSection)) {
          sectionKeyMap.set(currentSection, new Map());
        }

        const keyMap = sectionKeyMap.get(currentSection)!;

        if (keyMap.has(normalizedKey)) {
          const entry = keyMap.get(normalizedKey)!;
          entry.lineNumbers.push(i);

          for (const lineNum of entry.lineNumbers) {
            const duplicateLine = lines[lineNum];
            const duplicateContentLine = stripInlineComment(duplicateLine.trim());
            const dupEqualsIndex = duplicateContentLine.indexOf("=");
            if (dupEqualsIndex <= 0) {
              continue;
            }

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
              `重复定义: "${dupLineKey}" 在节 ${currentSection} 中出现多次（不区分大小写）`,
              vscode.DiagnosticSeverity.Warning
            );
            diagnostic.source = "INI重复定义检测";
            diagnostic.code = "RA2-INI-Assistant";
            diagnostics.push(diagnostic);
          }
        } else {
          keyMap.set(normalizedKey, {
            originalKey,
            lineNumbers: [i],
          });
        }

        if (referenceKeys.has(normalizedKey)) {
          const rawValue = contentLine.substring(equalsIndex + 1);
          const commentSplit = Math.min(
            rawValue.indexOf(";") >= 0 ? rawValue.indexOf(";") : Infinity,
            rawValue.indexOf("#") >= 0 ? rawValue.indexOf("#") : Infinity
          );

          const valuePart =
            commentSplit < Infinity
              ? rawValue.substring(0, commentSplit)
              : rawValue;
          const cleanValues = valuePart
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0 && !/^\d+$/.test(v));

          let searchOffset = valuePart.indexOf(cleanValues[0] ?? "");
          for (const value of cleanValues) {
            const index = valuePart.indexOf(value, Math.max(searchOffset, 0));
            const start = index >= 0 ? equalsIndex + 1 + index : equalsIndex + 1;
            const end = start + value.length;
            searchOffset = index + value.length;

            if (!value.includes(" ") && !value.includes("\\") && !value.includes("/")) {
              valueReferences.push({ name: value, line: i, start, end });
            }
          }
        }

        continue;
      }

      if (contentLine !== "" && currentSection) {
        const isPotentialKey =
          !contentLine.startsWith("[") &&
          !contentLine.startsWith(";") &&
          !contentLine.startsWith("#") &&
          contentLine.length > 0;

        if (!isPotentialKey) {
          continue;
        }

        let possibleKey = contentLine;
        let diagnosticMessage = "";
        let diagnosticSeverity = vscode.DiagnosticSeverity.Warning;

        const spaceIndex = contentLine.indexOf(" ");
        const tabIndex = contentLine.indexOf("\t");
        const separatorIndex = spaceIndex > -1 ? spaceIndex : tabIndex;

        if (separatorIndex > 0) {
          possibleKey = contentLine.substring(0, separatorIndex).trim();
          diagnosticMessage = `语法错误: 键 "${possibleKey}" 中间缺少等号 (=)`;
          diagnosticSeverity = vscode.DiagnosticSeverity.Error;
        } else {
          diagnosticMessage = `语法问题: "${possibleKey}" 缺少等号和值，应为 ${possibleKey}=...`;
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

    if (currentSection && sectionRanges.has(currentSection)) {
      sectionRanges.get(currentSection)!.end = lines.length - 1;
    }

    const sectionNameMap = new Map<string, number[]>();
    for (const section of definedSections) {
      if (!sectionNameMap.has(section.name)) {
        sectionNameMap.set(section.name, []);
      }
      sectionNameMap.get(section.name)!.push(section.line);
    }

    for (const [sectionName, lineNumbers] of sectionNameMap.entries()) {
      if (lineNumbers.length <= 1) {
        continue;
      }

      for (const lineNum of lineNumbers) {
        const line = lines[lineNum];
        const range = new vscode.Range(
          new vscode.Position(lineNum, 0),
          new vscode.Position(lineNum, line.length)
        );

        const diagnostic = new vscode.Diagnostic(
          range,
          `重复节名: [${sectionName}] 在文件中出现 ${lineNumbers.length} 次（行: ${lineNumbers.join(", ")}）`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.source = "INI语法检测";
        diagnostic.code = "duplicate-section";
        diagnostics.push(diagnostic);
      }
    }

    const headers = collectSectionHeaders(document);
    const parentMap = new Map<string, string>();
    const headerLineMap = new Map<string, number>();

    for (const header of headers) {
      headerLineMap.set(header.name, header.line);
      if (header.parent) {
        parentMap.set(header.name, header.parent);
      }
    }

    const warned = new Set<string>();
    for (const header of headers) {
      if (!header.parent || warned.has(header.name)) {
        continue;
      }

      const chain = buildInheritanceChain(header.name, parentMap);
      if (!chain.cycle) {
        continue;
      }

      for (const sectionName of chain.chain) {
        if (warned.has(sectionName)) {
          continue;
        }

        const lineNum = headerLineMap.get(sectionName);
        if (lineNum === undefined) {
          continue;
        }

        const lineText = lines[lineNum] ?? "";
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(
            new vscode.Position(lineNum, 0),
            new vscode.Position(lineNum, lineText.length)
          ),
          `检测到继承循环: ${chain.chain.join(" -> ")}`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.source = "INI继承检测";
        diagnostic.code = "inheritance-cycle";
        diagnostics.push(diagnostic);
        warned.add(sectionName);
      }
    }

    const definedSectionLowerSet = new Set(
      definedSections.map((section) => section.name.toLowerCase())
    );
    const referencedSectionLowerSet = new Set(
      valueReferences.map((reference) => reference.name.toLowerCase())
    );
    const crossFileDefinitionCache = new Map<string, boolean>();
    const crossFileReferenceCache = new Map<string, boolean>();

    for (const ref of valueReferences) {
      const nameLower = ref.name.toLowerCase();
      const definedLocally = definedSectionLowerSet.has(nameLower);

      let isDefined = definedLocally;
      if (!isDefined && enableMultiFile && indexManager) {
        let crossFileDefined = crossFileDefinitionCache.get(nameLower);
        if (crossFileDefined === undefined) {
          crossFileDefined = indexManager.findSectionDefinitions(ref.name).length > 0;
          crossFileDefinitionCache.set(nameLower, crossFileDefined);
        }
        isDefined = crossFileDefined;
      }

      if (isDefined) {
        continue;
      }

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
        target: vscode.Uri.parse(`section:${encodeURIComponent(ref.name)}`),
      };
      diagnostics.push(diagnostic);
    }

    const registeredValuesLower = new Set<string>();
    if (enableMultiFile && indexManager) {
      for (const registerName of registerNames) {
        const values = indexManager.getRegisteredValues(registerName);
        for (const value of values) {
          registeredValuesLower.add(value.toLowerCase());
        }
      }
    }

    for (const section of definedSections) {
      if (registerSections.has(section.name)) {
        continue;
      }

      const nameLower = section.name.toLowerCase();
      let hasReference =
        referencedSectionLowerSet.has(nameLower) ||
        registeredValuesLower.has(nameLower);

      if (!hasReference && enableMultiFile && indexManager) {
        let crossFileHasReference = crossFileReferenceCache.get(nameLower);
        if (crossFileHasReference === undefined) {
          crossFileHasReference =
            indexManager.findSectionReferences(section.name).length > 0;
          crossFileReferenceCache.set(nameLower, crossFileHasReference);
        }
        hasReference = crossFileHasReference;
      }

      if (hasReference) {
        continue;
      }

      const range = new vscode.Range(
        new vscode.Position(section.line, 0),
        new vscode.Position(section.line, lines[section.line]?.length ?? 0)
      );
      const diagnostic = new vscode.Diagnostic(
        range,
        `此节未被引用或词典库中不存在: [${section.name}]`,
        vscode.DiagnosticSeverity.Information
      );
      diagnostic.source = "INI引用检测";
      diagnostic.code = {
        value: "unused-section",
        target: vscode.Uri.parse(`section:${encodeURIComponent(section.name)}`),
      };
      diagnostics.push(diagnostic);
    }

    diagnosticCollection.set(document.uri, diagnostics);
  };
}
