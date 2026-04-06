import * as vscode from "vscode";
import { Translations } from "../types";
import { IniIndexManager } from "../indexManager";
import { TypeInference } from "./typeInference";

interface SectionWithComment {
  name: string;
  line: number;
  comment?: string;
}

export class RegisterHelper {
  constructor(
    private translations: Translations,
    private indexManager: IniIndexManager,
    private typeInference: TypeInference,
    private outputChannel: vscode.OutputChannel
  ) { }

  getRegisterLabel(registerName: string): string | undefined {
    const config = this.getRegisterConfig(registerName);
    return config?.label;
  }

  getRegisterConfig(
    registerName: string
  ): { label: string; value: string; mode?: "append" | "keyValue"; defaultValue?: string } | undefined {
    if (!this.translations.registerType) {
      return undefined;
    }
    return this.translations.registerType.find((r) => r.value === `[${registerName}]`);
  }

  getRegisterMode(registerName: string): "append" | "keyValue" {
    const config = this.getRegisterConfig(registerName);
    return config?.mode || "append";
  }

  getRegisterSections(): string[] {
    const registers = new Set<string>();
    for (const config of Object.values(this.translations.typeMapping)) {
      for (const reg of config.registers) {
        registers.add(reg);
      }
    }
    return Array.from(registers);
  }

  getRegisterSectionsForType(typeName: string): string[] {
    const config = this.translations.typeMapping[typeName];
    return config?.registers || [];
  }

  inferRegisterNamesForSection(sectionName: string, filePath?: string): string[] {
    const inference = this.typeInference.inferSectionTypeDetailed(sectionName, filePath);
    if (!inference.typeName) {
      return this.getRegisterSections();
    }

    const registerNames = inference.candidateRegisters.length > 0
      ? inference.candidateRegisters
      : this.getRegisterSectionsForType(inference.typeName);

    return registerNames.length > 0 ? registerNames : this.getRegisterSections();
  }

  inferRegisterNamesForSectionStrict(sectionName: string, filePath?: string): string[] {
    const inference = this.typeInference.inferSectionTypeDetailed(sectionName, filePath);
    if (!inference.typeName) {
      return [];
    }

    // 严格模式仅接受中高置信度，避免误注册。
    if (inference.confidence === "low" || inference.confidence === "unknown") {
      return [];
    }

    const registerNames = (inference.candidateRegisters.length > 0
      ? inference.candidateRegisters
      : this.getRegisterSectionsForType(inference.typeName))
      .filter((name) => this.getRegisterSections().includes(name));

    return Array.from(new Set(registerNames));
  }

  isRegisterSection(sectionName: string): boolean {
    return this.getRegisterSections().includes(sectionName);
  }

  getDefinedSections(document: vscode.TextDocument): SectionWithComment[] {
    const sections: SectionWithComment[] = [];
    const lines = document.getText().split("\n");
    const registerSections = new Set(this.getRegisterSections());

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const match = line.match(/^\[([^\]]+)\]/);
      if (!match) {
        continue;
      }

      const sectionName = match[1].trim();
      if (registerSections.has(sectionName)) {
        continue;
      }

      let comment: string | undefined;
      const sameLineComment = lines[i].match(/\]\s*(;|#)\s*(.+)$/);
      if (sameLineComment) {
        comment = sameLineComment[2].trim();
      } else if (i > 0) {
        const prevLine = lines[i - 1].trim();
        const prevComment = prevLine.match(/^(;|#)\s*(.+)$/);
        if (prevComment) {
          comment = prevComment[2].trim();
        }
      }

      sections.push({ name: sectionName, line: i, comment });
    }

    return sections;
  }

  getRegisteredSectionsGlobal(registerName?: string): Set<string> {
    const registered = new Set<string>();
    const registerSections = registerName ? new Set([registerName]) : new Set(this.getRegisterSections());

    for (const regName of registerSections) {
      const values = this.indexManager.getRegisteredValues(regName);
      values.forEach((v) => registered.add(v));
    }

    return registered;
  }

  getRegisteredSections(document: vscode.TextDocument): Set<string> {
    const registered = new Set<string>();
    const registerSections = new Set(this.getRegisterSections());
    const lines = document.getText().split("\n");
    let currentSection = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const sectionMatch = line.match(/^\[([^\]]+)\]/);
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim();
        continue;
      }

      if (!registerSections.has(currentSection)) {
        continue;
      }

      const mode = this.getRegisterMode(currentSection);
      if (mode === "keyValue") {
        const keyValueMatch = line.match(/^\s*([^=\s;#]+)\s*=/);
        if (keyValueMatch) {
          registered.add(keyValueMatch[1].trim());
        }
      } else {
        const appendMatch = line.match(/^\s*\+=\s*([^\s;#]+)/);
        const numMatch = line.match(/^\s*\d+\s*=\s*([^\s;#]+)/);

        if (appendMatch) {
          registered.add(appendMatch[1].trim());
        } else if (numMatch) {
          registered.add(numMatch[1].trim());
        }
      }
    }

    return registered;
  }

  getUnregisteredSections(document: vscode.TextDocument): SectionWithComment[] {
    const defined = this.getDefinedSections(document);
    const enableMultiFile = vscode.workspace
      .getConfiguration("ini-ra2")
      .get<boolean>("enableMultiFileSearch", true);

    if (enableMultiFile) {
      const registeredGlobal = this.getRegisteredSectionsGlobal();
      return defined.filter((s) => !registeredGlobal.has(s.name));
    }

    const registered = this.getRegisteredSections(document);
    return defined.filter((s) => !registered.has(s.name));
  }

  private isFileInWhitelist(fileName: string): boolean {
    const relatedFiles = vscode.workspace.getConfiguration("ini-ra2").get<string[]>("relatedFiles", []);

    if (relatedFiles.length === 0) {
      return true;
    }

    const lowerFileName = fileName.toLowerCase();
    return relatedFiles.some((pattern) => {
      const lowerPattern = pattern.toLowerCase();
      if (lowerPattern.includes("*")) {
        const regex = new RegExp("^" + lowerPattern.replace(/\*/g, ".*") + "$");
        return regex.test(lowerFileName);
      }
      return lowerFileName === lowerPattern;
    });
  }

  async getAllDefinedSectionsGlobal(): Promise<SectionWithComment[]> {
    const sections: SectionWithComment[] = [];
    const registerSections = new Set(this.getRegisterSections());
    const allSectionNames = this.indexManager.getAllSections();

    for (const sectionName of allSectionNames) {
      if (registerSections.has(sectionName)) {
        continue;
      }

      const defs = this.indexManager.findSectionDefinitions(sectionName);
      if (defs.length === 0) {
        continue;
      }

      const firstDef = defs[0];
      const fileName = firstDef.file.split(/[\\/]/).pop() || "";
      if (!this.isFileInWhitelist(fileName)) {
        continue;
      }

      let comment: string | undefined;
      try {
        const uri = vscode.Uri.file(firstDef.file);
        const doc = await vscode.workspace.openTextDocument(uri);
        const lines = doc.getText().split("\n");
        if (firstDef.line < lines.length) {
          const line = lines[firstDef.line];
          const sameLineComment = line.match(/\]\s*(;|#)\s*(.+)$/);
          if (sameLineComment) {
            comment = sameLineComment[2].trim();
          } else if (firstDef.line > 0) {
            const prevLine = lines[firstDef.line - 1].trim();
            const prevComment = prevLine.match(/^(;|#)\s*(.+)$/);
            if (prevComment) {
              comment = prevComment[2].trim();
            }
          }
        }
      } catch {
        // ignore file read errors
      }

      sections.push({ name: sectionName, line: firstDef.line, comment });
    }

    return sections;
  }

  async getUnregisteredSectionsGlobal(currentDocument: vscode.TextDocument): Promise<SectionWithComment[]> {
    const enableMultiFile = vscode.workspace
      .getConfiguration("ini-ra2")
      .get<boolean>("enableMultiFileSearch", true);

    if (!enableMultiFile) {
      return this.getUnregisteredSections(currentDocument);
    }

    const currentFileSections = this.getDefinedSections(currentDocument);
    const allSections = await this.getAllDefinedSectionsGlobal();

    const sectionMap = new Map<string, SectionWithComment>();
    for (const section of [...currentFileSections, ...allSections]) {
      if (!sectionMap.has(section.name)) {
        sectionMap.set(section.name, section);
      }
    }

    const registeredGlobal = this.getRegisteredSectionsGlobal();
    return Array.from(sectionMap.values()).filter((s) => !registeredGlobal.has(s.name));
  }

  hasRegisterSection(document: vscode.TextDocument, registerName: string): { exists: boolean; line?: number } {
    const lines = document.getText().split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].trim().match(/^\[([^\]]+)\]/);
      if (match && match[1].trim() === registerName) {
        return { exists: true, line: i };
      }
    }
    return { exists: false };
  }

  async generateRegisterCode(
    document: vscode.TextDocument,
    sectionName: string,
    registerName: string
  ): Promise<vscode.WorkspaceEdit | null> {
    const edit = new vscode.WorkspaceEdit();
    const registerInfo = this.hasRegisterSection(document, registerName);

    const sections = this.getDefinedSections(document);
    const section = sections.find((s) => s.name === sectionName);
    const label = section?.comment || sectionName;
    const config = this.getRegisterConfig(registerName);
    const mode = config?.mode || "append";
    const defaultValue = config?.defaultValue || "";

    if (registerInfo.exists && registerInfo.line !== undefined) {
      const lines = document.getText().split("\n");
      let insertLine = registerInfo.line + 1;

      for (let i = registerInfo.line + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.match(/^\[/)) {
          insertLine = i;
          break;
        }
        if (line !== "" && !line.startsWith(";") && !line.startsWith("#")) {
          insertLine = i + 1;
        }
      }

      const insertPos = new vscode.Position(insertLine, 0);
      const registerLine =
        mode === "keyValue"
          ? `${sectionName}=${defaultValue} ; ${label}\n`
          : `+=${sectionName} ; ${label}\n`;
      edit.insert(document.uri, insertPos, registerLine);
    } else {
      const insertPos = new vscode.Position(document.lineCount, 0);
      const prefix = document.lineCount > 0 ? "\n\n" : "";
      const registerLine =
        mode === "keyValue"
          ? `${sectionName}=${defaultValue} ; ${label}\n`
          : `+=${sectionName} ; ${label}\n`;
      const registerBlock = `${prefix}[${registerName}]\n${registerLine}`;
      edit.insert(document.uri, insertPos, registerBlock);
    }

    return edit;
  }

  async registerSectionByName(sectionName: string, registerName?: string): Promise<boolean> {
    const defs = this.indexManager.findSectionDefinitions(sectionName);
    if (defs.length === 0) {
      return false;
    }

    let targetRegister = registerName;
    if (!targetRegister) {
      const options = this.inferRegisterNamesForSection(sectionName, defs[0].file);
      if (options.length === 0) {
        return false;
      }
      if (options.length === 1) {
        targetRegister = options[0];
      } else {
        const pick = await vscode.window.showQuickPick(
          options.map((name) => ({
            label: `[${name}]`,
            description: this.getRegisterLabel(name),
            value: name,
          })),
          { placeHolder: `Select register list for ${sectionName}` }
        );
        if (!pick) {
          return false;
        }
        targetRegister = pick.value;
      }
    }

    const targetDef = defs[0];
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetDef.file));
    const edit = await this.generateRegisterCode(document, sectionName, targetRegister);
    if (!edit) {
      return false;
    }

    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) {
      this.outputChannel.appendLine(`[Register] Registered [${sectionName}] -> [${targetRegister}]`);
    }
    return applied;
  }

  async provideRegisterCompletions(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[]> {
    const line = document.lineAt(position.line);
    const beforeCursor = line.text.substring(0, position.character);

    let currentSection = "";
    for (let i = position.line - 1; i >= 0; i--) {
      const text = document.lineAt(i).text.trim();
      const match = text.match(/^\[([^\]]+)\]/);
      if (match) {
        currentSection = match[1].trim();
        break;
      }
    }

    if (!this.isRegisterSection(currentSection)) {
      return [];
    }

    const mode = this.getRegisterMode(currentSection);
    if (mode === "keyValue") {
      if (!beforeCursor.match(/^\s*[^=\s;#]*$/)) {
        return [];
      }
    } else if (!beforeCursor.match(/^\s*(\+=|(\d+)\s*=)\s*$/)) {
      return [];
    }

    const unregistered = await this.getUnregisteredSectionsGlobal(document);

    return unregistered.map((section) => {
      const item = new vscode.CompletionItem(section.name, vscode.CompletionItemKind.Reference);
      item.detail = `Register to [${currentSection}]`;
      item.documentation = section.comment
        ? new vscode.MarkdownString(`Comment: ${section.comment}`)
        : undefined;
      item.insertText = section.name;
      item.sortText = `0_${section.name}`;
      return item;
    });
  }

  provideRegisterCodeAction(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const text = document.lineAt(range.start.line).text.trim();

    const sectionMatch = text.match(/^\[([^\]]+)\]/);
    if (!sectionMatch) {
      return [];
    }

    const sectionName = sectionMatch[1].trim();

    const enableMultiFile = vscode.workspace
      .getConfiguration("ini-ra2")
      .get<boolean>("enableMultiFileSearch", true);

    const registered = enableMultiFile
      ? this.getRegisteredSectionsGlobal()
      : this.getRegisteredSections(document);

    if (registered.has(sectionName) || this.isRegisterSection(sectionName)) {
      return [];
    }

    let registerNames = this.inferRegisterNamesForSection(sectionName, document.uri.fsPath);
    if (registerNames.length === 0) {
      registerNames = this.getRegisterSections();
    }

    for (const registerName of registerNames) {
      const label = this.getRegisterLabel(registerName);
      const actionTitle = label
        ? `Register to [${registerName}] - ${label}`
        : `Register to [${registerName}]`;

      const action = new vscode.CodeAction(actionTitle, vscode.CodeActionKind.RefactorRewrite);
      action.command = {
        title: "Register section",
        command: "ini-ra2.registerSection",
        arguments: [document, sectionName, registerName],
      };
      actions.push(action);
    }

    return actions;
  }
}
