/**
 * 注册表辅助工具
 * 提供注册表节名的自动注册和补全功能
 */

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

    /**
     * 获取注册表的中文标签
     */
    getRegisterLabel(registerName: string): string | undefined {
        const config = this.getRegisterConfig(registerName);
        return config?.label;
    }

    /**
     * 获取注册表配置
     */
    getRegisterConfig(registerName: string): { label: string; value: string; mode?: 'append' | 'keyValue'; defaultValue?: string } | undefined {
        if (!this.translations.registerType) {
            return undefined;
        }
        return this.translations.registerType.find(
            (r) => r.value === `[${registerName}]`
        );
    }

    /**
     * 获取注册表的注册模式
     */
    getRegisterMode(registerName: string): 'append' | 'keyValue' {
        const config = this.getRegisterConfig(registerName);
        return config?.mode || 'append'; // 默认为 append 模式
    }

    /**
     * 获取所有注册表节名列表
     */
    getRegisterSections(): string[] {
        const registers = new Set<string>();
        for (const config of Object.values(this.translations.typeMapping)) {
            for (const reg of config.registers) {
                registers.add(reg);
            }
        }
        return Array.from(registers);
    }

    /**
     * 根据节类型获取对应的注册表节名列表
     */
    getRegisterSectionsForType(typeName: string): string[] {
        const config = this.translations.typeMapping[typeName];
        return config?.registers || [];
    }

    /**
     * 检测节名是否是注册表节
     */
    isRegisterSection(sectionName: string): boolean {
        return this.getRegisterSections().includes(sectionName);
    }

    /**
     * 获取文档中已定义的节名（排除注册表节）
     */
    getDefinedSections(document: vscode.TextDocument): SectionWithComment[] {
        const sections: SectionWithComment[] = [];
        const lines = document.getText().split("\n");
        const registerSections = new Set(this.getRegisterSections());

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const match = line.match(/^\[([^\]]+)\]/);
            if (match) {
                const sectionName = match[1].trim();
                if (!registerSections.has(sectionName)) {
                    // 查找注释：上一行或同行右侧
                    let comment: string | undefined;

                    // 同行右侧注释
                    const sameLineComment = lines[i].match(/\]\s*(;|#)\s*(.+)$/);
                    if (sameLineComment) {
                        comment = sameLineComment[2].trim();
                    } else if (i > 0) {
                        // 上一行注释
                        const prevLine = lines[i - 1].trim();
                        const prevComment = prevLine.match(/^(;|#)\s*(.+)$/);
                        if (prevComment) {
                            comment = prevComment[2].trim();
                        }
                    }

                    sections.push({ name: sectionName, line: i, comment });
                }
            }
        }

        return sections;
    }

    /**
     * 获取已注册的节名集合（跨文件）
     */
    getRegisteredSectionsGlobal(registerName?: string): Set<string> {
        const registered = new Set<string>();
        const registerSections = registerName
            ? new Set([registerName])
            : new Set(this.getRegisterSections());

        // 1. 从索引管理器获取所有注册列表的值
        for (const regName of registerSections) {
            const values = this.indexManager.getRegisteredValues(regName);
            values.forEach((v) => registered.add(v));
        }

        return registered;
    }

    /**
     * 获取已注册的节名集合
     */
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

            if (registerSections.has(currentSection)) {
                const mode = this.getRegisterMode(currentSection);

                if (mode === 'keyValue') {
                    // keyValue 模式：解析 key=value 格式，key 就是节名
                    const keyValueMatch = line.match(/^\s*([^=\s;#]+)\s*=/);
                    if (keyValueMatch) {
                        registered.add(keyValueMatch[1].trim());
                    }
                } else {
                    // append 模式：解析注册项，支持 += 和数字键
                    const appendMatch = line.match(/^\s*\+=\s*([^\s;#]+)/);
                    const numMatch = line.match(/^\s*\d+\s*=\s*([^\s;#]+)/);

                    if (appendMatch) {
                        registered.add(appendMatch[1].trim());
                    } else if (numMatch) {
                        registered.add(numMatch[1].trim());
                    }
                }
            }
        }

        return registered;
    }

    /**
     * 获取未注册的节名列表（用于补全）
     */
    getUnregisteredSections(
        document: vscode.TextDocument
    ): SectionWithComment[] {
        const defined = this.getDefinedSections(document);
        const enableMultiFile = vscode.workspace
            .getConfiguration("ini-ra2")
            .get<boolean>("enableMultiFileSearch", true);

        if (enableMultiFile) {
            // 跨文件检查：获取全局已注册的节名
            const registeredGlobal = this.getRegisteredSectionsGlobal();
            return defined.filter((s) => !registeredGlobal.has(s.name));
        } else {
            // 仅当前文件检查
            const registered = this.getRegisteredSections(document);
            return defined.filter((s) => !registered.has(s.name));
        }
    }

    /**
     * 检查文件是否在白名单中
     */
    private isFileInWhitelist(fileName: string): boolean {
        const relatedFiles = vscode.workspace
            .getConfiguration("ini-ra2")
            .get<string[]>("relatedFiles", []);

        if (relatedFiles.length === 0) {
            return true; // 如果没有配置，默认允许所有文件
        }

        const lowerFileName = fileName.toLowerCase();
        return relatedFiles.some((pattern) => {
            const lowerPattern = pattern.toLowerCase();
            // 支持通配符 *
            if (lowerPattern.includes("*")) {
                const regex = new RegExp("^" + lowerPattern.replace(/\*/g, ".*") + "$");
                return regex.test(lowerFileName);
            }
            return lowerFileName === lowerPattern;
        });
    }

    /**
     * 获取所有已定义的节名（跨文件，包括其他 ini 文件如 art.ini）
     */
    getAllDefinedSectionsGlobal(): SectionWithComment[] {
        const sections: SectionWithComment[] = [];
        const registerSections = new Set(this.getRegisterSections());
        const allSectionNames = this.indexManager.getAllSections();

        for (const sectionName of allSectionNames) {
            if (!registerSections.has(sectionName)) {
                // 查找节的定义位置，尝试获取注释
                const defs = this.indexManager.findSectionDefinitions(sectionName);
                if (defs.length > 0) {
                    const firstDef = defs[0];
                    
                    // 检查文件是否在白名单中
                    if (!this.isFileInWhitelist(firstDef.file)) {
                        continue;
                    }
                    
                    // 尝试读取注释（从文件中）
                    let comment: string | undefined;
                    try {
                        const uri = vscode.Uri.file(firstDef.file);
                        vscode.workspace.openTextDocument(uri).then((doc) => {
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
                        });
                    } catch {
                        // 忽略读取错误
                    }

                    sections.push({ name: sectionName, line: firstDef.line, comment });
                }
            }
        }

        return sections;
    }

    /**
     * 获取未注册的节名列表（跨文件增强版，用于补全）
     */
    async getUnregisteredSectionsGlobal(
        currentDocument: vscode.TextDocument
    ): Promise<SectionWithComment[]> {
        const enableMultiFile = vscode.workspace
            .getConfiguration("ini-ra2")
            .get<boolean>("enableMultiFileSearch", true);

        if (!enableMultiFile) {
            return this.getUnregisteredSections(currentDocument);
        }

        // 收集当前文件的节
        const currentFileSections = this.getDefinedSections(currentDocument);

        // 收集其他文件的节（特别是 art 文件）
        const allSections = this.getAllDefinedSectionsGlobal();

        // 合并去重
        const sectionMap = new Map<string, SectionWithComment>();
        for (const section of [...currentFileSections, ...allSections]) {
            if (!sectionMap.has(section.name)) {
                sectionMap.set(section.name, section);
            }
        }

        // 获取全局已注册的节名
        const registeredGlobal = this.getRegisteredSectionsGlobal();

        // 过滤出未注册的
        return Array.from(sectionMap.values()).filter(
            (s) => !registeredGlobal.has(s.name)
        );
    }

    /**
     * 检查文档中是否已存在某个注册表节
     */
    hasRegisterSection(
        document: vscode.TextDocument,
        registerName: string
    ): { exists: boolean; line?: number } {
        const lines = document.getText().split("\n");
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].trim().match(/^\[([^\]]+)\]/);
            if (match && match[1].trim() === registerName) {
                return { exists: true, line: i };
            }
        }
        return { exists: false };
    }

    /**
     * 为节名生成注册代码
     */
    async generateRegisterCode(
        document: vscode.TextDocument,
        sectionName: string,
        registerName: string
    ): Promise<vscode.WorkspaceEdit | null> {
        const edit = new vscode.WorkspaceEdit();
        const registerInfo = this.hasRegisterSection(document, registerName);

        // 查找节名的注释（用于注册项的 label）
        const sections = this.getDefinedSections(document);
        const section = sections.find((s) => s.name === sectionName);
        const label = section?.comment || sectionName;
        const config = this.getRegisterConfig(registerName);
        const mode = config?.mode || 'append';
        const defaultValue = config?.defaultValue || '';

        if (registerInfo.exists && registerInfo.line !== undefined) {
            // 注册表节已存在，在节内追加
            const lines = document.getText().split("\n");
            let insertLine = registerInfo.line + 1;

            // 找到节的结束位置（下一个节或文件末尾）
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
            const registerLine = mode === 'keyValue'
                ? `${sectionName}=${defaultValue} ; ${label}\n`  // keyValue 模式：key=defaultValue ; comment
                : `+=${sectionName} ; ${label}\n`;  // append 模式：+=value ; comment
            edit.insert(document.uri, insertPos, registerLine);
        } else {
            // 注册表节不存在，创建新节
            const insertPos = new vscode.Position(document.lineCount, 0);
            const prefix = document.lineCount > 0 ? "\n\n" : "";
            const registerLine = mode === 'keyValue'
                ? `${sectionName}=${defaultValue} ; ${label}\n`
                : `+=${sectionName} ; ${label}\n`;
            const registerBlock = `${prefix}[${registerName}]\n${registerLine}`;
            edit.insert(document.uri, insertPos, registerBlock);
        }

        return edit;
    }

    /**
     * 提供注册表节内的补全项
     */
    async provideRegisterCompletions(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.CompletionItem[]> {
        const line = document.lineAt(position.line);
        const lineText = line.text;
        const beforeCursor = lineText.substring(0, position.character);

        // 查找当前所在的节
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

        // 根据模式检测触发条件
        if (mode === 'keyValue') {
            // keyValue 模式：检测是否在输入 key= 或已有内容的行
            if (!beforeCursor.match(/^\s*[^=\s;#]*$/)) {
                return [];
            }
        } else {
            // append 模式：检测是否在注册表节内输入 += 或数字=
            if (!beforeCursor.match(/^\s*(\+=|(\d+)\s*=)\s*$/)) {
                return [];
            }
        }

        // 获取未注册的节名（跨文件）
        const unregistered = await this.getUnregisteredSectionsGlobal(document);

        return unregistered.map((section) => {
            const item = new vscode.CompletionItem(
                section.name,
                vscode.CompletionItemKind.Reference
            );
            item.detail = `注册到 [${currentSection}]`;
            item.documentation = section.comment
                ? new vscode.MarkdownString(`注释：${section.comment}`)
                : undefined;
            item.insertText = section.name;
            item.sortText = `0_${section.name}`;
            return item;
        });
    }

    /**
     * 提供节定义后的注册 CodeAction
     */
    provideRegisterCodeAction(
        document: vscode.TextDocument,
        range: vscode.Range
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];
        const line = document.lineAt(range.start.line);
        const text = line.text.trim();

        // 检测是否是节头
        const sectionMatch = text.match(/^\[([^\]]+)\]/);
        if (!sectionMatch) {
            return [];
        }

        const sectionName = sectionMatch[1].trim();

        // 检查是否已注册（跨文件）
        const enableMultiFile = vscode.workspace
            .getConfiguration("ini-ra2")
            .get<boolean>("enableMultiFileSearch", true);

        const registered = enableMultiFile
            ? this.getRegisteredSectionsGlobal()
            : this.getRegisteredSections(document);

        if (registered.has(sectionName)) {
            return [];
        }

        // 检查是否是注册表节
        if (this.isRegisterSection(sectionName)) {
            return [];
        }

        // 推断节类型并获取注册表列表
        const typeName = this.typeInference.inferSectionType(sectionName);
        let registerNames: string[] = [];

        if (typeName) {
            registerNames = this.getRegisterSectionsForType(typeName);
        }

        // 如果无法推断类型，提供所有注册表选项
        if (registerNames.length === 0) {
            registerNames = this.getRegisterSections();
        }

        for (const registerName of registerNames) {
            const label = this.getRegisterLabel(registerName);
            const actionTitle = label
                ? `注册到 [${registerName}] - ${label}`
                : `注册到 [${registerName}]`;

            const action = new vscode.CodeAction(
                actionTitle,
                vscode.CodeActionKind.RefactorRewrite
            );
            action.command = {
                title: "注册节名",
                command: "ini-ra2.registerSection",
                arguments: [document, sectionName, registerName],
            };
            actions.push(action);
        }

        return actions;
    }
}
