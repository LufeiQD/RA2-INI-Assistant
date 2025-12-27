import * as vscode from 'vscode';
import * as path from 'path';
import { IniIndexManager } from '../indexManager';

interface RenameCandidate {
    originalName: string;
    newName: string;
    isSection: boolean;
    triggerPosition: vscode.Position;
}

interface ReferenceMatch {
    uri: vscode.Uri;
    line: number;
    lineText: string;
    kind: 'section' | 'value';
}

type RenameScope = 'current' | 'indexed' | 'workspace';

/**
 * 自动重命名检测器：监听编辑并在停止输入后检测重命名并提示更新引用
 */
export class AutoRenameDetector {
    private debounceTimer: NodeJS.Timeout | undefined;
    private lastDocument: vscode.TextDocument | undefined;
    private lastCursorPosition: vscode.Position | undefined;
    private previousContent: Map<string, string> = new Map(); // uri -> content snapshot
    private pendingChanges: Map<string, { content: string; position: vscode.Position | undefined; timestamp: number }> = new Map();
    // 说明：不使用 isComposing 标志，避免误判导致检测被抑制
    private savedSnapshots: Map<string, string> = new Map(); // 保存模式下使用
    private mode: 'idle' | 'save';

    constructor(
        private outputChannel: vscode.OutputChannel,
        private indexManager: IniIndexManager,
        mode: 'idle' | 'save' = 'save'
    ) {
        this.mode = mode;
    }

      /**
       * 命令化重命名入口：基于当前光标符号执行预览重命名
       */
      public async runInteractiveRename(scope: RenameScope = 'indexed'): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'ini') {
          vscode.window.showWarningMessage('请在 INI 文件中运行此命令');
          return;
        }

        const symbol = this.identifySymbolAtPosition(editor.document, editor.selection.active);
        if (!symbol) {
          vscode.window.showInformationMessage('未检测到可重命名的节或键');
          return;
        }

        const newName = await vscode.window.showInputBox({
          prompt: symbol.isSection ? '输入新的节名' : '输入新的键名',
          value: symbol.name,
          validateInput: (value) => value.trim().length === 0 ? '名称不能为空' : undefined
        });

        if (!newName || newName.trim() === symbol.name) { return; }

        const references = await this.findReferences(symbol.name, symbol.isSection, scope, editor.document);
        if (references.length === 0) {
          vscode.window.showInformationMessage('没有找到可更新的引用');
          return;
        }

        const candidate: RenameCandidate = {
          originalName: symbol.name,
          newName: newName.trim(),
          isSection: symbol.isSection,
          triggerPosition: editor.selection.active
        };

        await this.showRenamePreview(candidate, references);
      }

      /**
       * 为 VS Code RenameProvider 构建 WorkspaceEdit
       */
      public async buildEditForProvider(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        scope: RenameScope = 'indexed'
      ): Promise<vscode.WorkspaceEdit | null> {
        const symbol = this.identifySymbolAtPosition(document, position);
        if (!symbol) {
          return null;
        }

        const candidate: RenameCandidate = {
          originalName: symbol.name,
          newName,
          isSection: symbol.isSection,
          triggerPosition: position
        };

        const references = await this.findReferences(symbol.name, symbol.isSection, scope, document);
        if (references.length === 0) {
          return null;
        }

        return this.buildWorkspaceEdit(candidate, references);
      }

    /**
     * 根据光标位置获取可重命名的符号
     */
    public identifySymbolAtPosition(
      document: vscode.TextDocument,
      position: vscode.Position
    ): { name: string; range: vscode.Range; isSection: boolean } | null {
      const line = document.lineAt(position.line);
      const text = line.text;

      // 节头 [Section]
      const sectionMatch = text.match(/^(\s*)\[([^\]]+)\]/);
      if (sectionMatch) {
        const startIdx = sectionMatch[1].length + 1;
        const endIdx = startIdx + sectionMatch[2].length;
        if (position.character >= startIdx && position.character <= endIdx) {
          return {
            name: sectionMatch[2],
            range: new vscode.Range(
              new vscode.Position(position.line, startIdx),
              new vscode.Position(position.line, endIdx)
            ),
            isSection: true
          };
        }
      }

      // 键名 key=
      const equalsIndex = text.indexOf("=");
      if (equalsIndex > 0) {
        const keyPart = text.substring(0, equalsIndex).trim();
        if (keyPart.length > 0) {
          const keyStart = text.indexOf(keyPart);
          const keyEnd = keyStart + keyPart.length;
          if (position.character >= keyStart && position.character <= keyEnd) {
            return {
              name: keyPart,
              range: new vscode.Range(
                new vscode.Position(position.line, keyStart),
                new vscode.Position(position.line, keyEnd)
              ),
              isSection: false
            };
          }
        }
      }

      return null;
    }

    /**
     * 注册文档变化监听器
     */
    public registerListeners(context: vscode.ExtensionContext): void {
        // 预加载所有已打开的 INI 文档快照（避免第一次编辑无法检测）
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.languageId === 'ini') {
                const docKey = editor.document.uri.toString();
                this.previousContent.set(docKey, editor.document.getText());

                // 保存模式：也需要预加载 savedSnapshots
                if (this.mode === 'save') {
                    this.savedSnapshots.set(docKey, editor.document.getText());
                }
            }
        }

        if (this.mode === 'idle') {
            // 空闲触发：监听文档内容变化（防抖）
            context.subscriptions.push(
                vscode.workspace.onDidChangeTextDocument((event) => {
                    if (event.document.languageId !== 'ini') { return; }
                    this.handleDocumentChange(event);
                })
            );
        } else {
            // 保存触发：监听保存事件
            context.subscriptions.push(
                vscode.workspace.onDidSaveTextDocument((document) => {
                    if (document.languageId !== 'ini') { return; }
                    this.handleDocumentSave(document);
                })
            );
        }

        // 监听新打开的文档（预加载快照）
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument((document) => {
                if (document.languageId !== 'ini') { return; }
                const docKey = document.uri.toString();
                if (!this.previousContent.has(docKey)) {
                    this.previousContent.set(docKey, document.getText());
                }
                if (this.mode === 'save' && !this.savedSnapshots.has(docKey)) {
                    this.savedSnapshots.set(docKey, document.getText());
                }
            })
        );

        // 监听光标位置变化（用于捕获用户当前编辑位置）
        context.subscriptions.push(
            vscode.window.onDidChangeTextEditorSelection((event) => {
                if (event.textEditor.document.languageId !== 'ini') { return; }
                this.lastCursorPosition = event.selections[0].active;
            })
        );
    }

    /**
     * 处理文档变化
     */
    private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        const doc = event.document;
        this.lastDocument = doc;

        // 不再试图推断 IME 输入状态，仅依赖稳定的内容变化与模式判断

        // 记录当前待处理的变化（不立即保存快照，等防抖后再确认）
        this.pendingChanges.set(doc.uri.toString(), {
            content: doc.getText(),
            position: this.lastCursorPosition,
            timestamp: Date.now()
        });

        // 清除之前的定时器
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        // 获取防抖时间配置（默认1000ms）
        const debounceTime = vscode.workspace.getConfiguration('ini-ra2').get<number>('autoRenameDebounce', 1000);

        // 设置新的防抖定时器
        this.debounceTimer = setTimeout(() => {
            this.detectRenameAndPrompt(doc);
        }, debounceTime);
    }

    /**
     * 保存触发：在保存时对比快照并检测重命名
     */
    private async handleDocumentSave(doc: vscode.TextDocument): Promise<void> {
        const key = doc.uri.toString();
        const current = doc.getText();
        const previous = this.savedSnapshots.get(key);

        // 首次保存：记录快照
        if (!previous) {
            this.savedSnapshots.set(key, current);
            return;
        }

        // 对比并检测候选
        const candidate = this.detectRenameCandidateByScan(previous, current);
        // 更新快照
        this.savedSnapshots.set(key, current);

        if (!candidate) { return; }

        this.outputChannel.appendLine(`[Auto Rename] (save) Detected: ${candidate.originalName} -> ${candidate.newName} (${candidate.isSection ? 'Section' : 'Key'})`);
        const references = await this.findReferences(candidate.originalName, candidate.isSection);
        if (references.length === 0) { return; }
        await this.showRenamePreview(candidate, references);
    }

    /**
     * 检测重命名并提示用户
     */
    private async detectRenameAndPrompt(doc: vscode.TextDocument): Promise<void> {
        try {
            const docKey = doc.uri.toString();

            // 获取待处理的变化
            const pending = this.pendingChanges.get(docKey);
            if (!pending) {
                return;
            }

            // 移除对 IME 的过度抑制逻辑，改为依赖后续的行模式检测

            // 清除待处理标记
            this.pendingChanges.delete(docKey);

            // 获取文档的上一次快照
            const previousContent = this.previousContent.get(docKey);
            const currentContent = doc.getText();

            // 放宽验证：若防抖期间发生变化，使用最新内容继续检测

            if (!previousContent) {
                // 第一次编辑，保存快照但不检测
                this.previousContent.set(docKey, currentContent);
                return;
            }

            // 如果内容实际上没有变化，跳过
            if (previousContent === currentContent) {
                this.outputChannel.appendLine(`[Auto Rename] No actual content change, skipping`);
                return;
            }

            // 更新快照（移到这里，确保只在真正需要检测时更新）
            this.previousContent.set(docKey, currentContent);

            // 检测节名或键名的变化
            const candidate = this.detectRenameCandidate(previousContent, currentContent, pending.position);
            if (!candidate) {
                return;
            }

            this.outputChannel.appendLine(`[Auto Rename] Detected: ${candidate.originalName} -> ${candidate.newName} (${candidate.isSection ? 'Section' : 'Key'})`);

            // 查找引用
            const references = await this.findReferences(candidate.originalName, candidate.isSection);
            if (references.length === 0) {
                this.outputChannel.appendLine(`[Auto Rename] No references found`);
                return;
            }

            this.outputChannel.appendLine(`[Auto Rename] Found ${references.length} references`);

            // 显示预览并提示用户
            await this.showRenamePreview(candidate, references);
        } catch (err) {
            this.outputChannel.appendLine(`[Auto Rename] Error: ${err}`);
        }
    }

    /**
     * 检测重命名候选（通过对比前后内容）
     */
    private detectRenameCandidate(
        previousContent: string,
        currentContent: string,
        cursorPosition?: vscode.Position
    ): RenameCandidate | null {
        if (!cursorPosition) { return null; }

        const prevLines = previousContent.split('\n');
        const currLines = currentContent.split('\n');

        if (cursorPosition.line >= currLines.length) { return null; }

        const prevLine = prevLines[cursorPosition.line] || '';
        const currLine = currLines[cursorPosition.line];

        if (prevLine === currLine) { return null; }

        // 检测节名变化 [Name] -> [NewName]
        const prevSectionMatch = prevLine.match(/^\s*\[([^\]]+)\]/);
        const currSectionMatch = currLine.match(/^\s*\[([^\]]+)\]/);
        if (prevSectionMatch && currSectionMatch && prevSectionMatch[1] !== currSectionMatch[1]) {
            return {
                originalName: prevSectionMatch[1],
                newName: currSectionMatch[1],
                isSection: true,
                triggerPosition: cursorPosition
            };
        }

        // 检测键名变化 Key= -> NewKey=
        const prevKeyMatch = prevLine.match(/^\s*([^=\s;#\[]+)\s*=/);
        const currKeyMatch = currLine.match(/^\s*([^=\s;#\[]+)\s*=/);
        if (prevKeyMatch && currKeyMatch && prevKeyMatch[1] !== currKeyMatch[1]) {
            return {
                originalName: prevKeyMatch[1],
                newName: currKeyMatch[1],
                isSection: false,
                triggerPosition: cursorPosition
            };
        }

        return null;
    }

    /**
     * 无需依赖光标位置，扫描所有行寻找节名或键名改动
     */
    private detectRenameCandidateByScan(previousContent: string, currentContent: string): RenameCandidate | null {
        const prevLines = previousContent.split('\n');
        const currLines = currentContent.split('\n');
        const max = Math.max(prevLines.length, currLines.length);

        for (let i = 0; i < max; i++) {
            const prevLine = prevLines[i] ?? '';
            const currLine = currLines[i] ?? '';
            if (prevLine === currLine) { continue; }

            // 节名变化 [Name] -> [NewName]
            const prevSectionMatch = prevLine.match(/^\s*\[([^\]]+)\]/);
            const currSectionMatch = currLine.match(/^\s*\[([^\]]+)\]/);
            if (prevSectionMatch && currSectionMatch && prevSectionMatch[1] !== currSectionMatch[1]) {
                return {
                    originalName: prevSectionMatch[1],
                    newName: currSectionMatch[1],
                    isSection: true,
                    triggerPosition: new vscode.Position(i, 0)
                };
            }

            // 键名变化 Key= -> NewKey=
            const prevKeyMatch = prevLine.match(/^\s*([^=\s;#\[]+)\s*=/);
            const currKeyMatch = currLine.match(/^\s*([^=\s;#\[]+)\s*=/);
            if (prevKeyMatch && currKeyMatch && prevKeyMatch[1] !== currKeyMatch[1]) {
                return {
                    originalName: prevKeyMatch[1],
                    newName: currKeyMatch[1],
                    isSection: false,
                    triggerPosition: new vscode.Position(i, 0)
                };
            }
        }

        return null;
    }

    /**
     * 查找工作区中的引用（利用现有的 indexManager）
     */
    private async findReferences(
      name: string,
      isSection: boolean,
      scope: RenameScope = 'indexed',
      currentDocument?: vscode.TextDocument
    ): Promise<ReferenceMatch[]> {
      const matches: ReferenceMatch[] = [];
      const dedupe = new Set<string>();
      const lowerName = name.toLowerCase();

      const pushMatch = (uri: vscode.Uri, line: number, lineText: string, kind: 'section' | 'value') => {
        const key = `${uri.fsPath}:${line}:${kind}`;
        if (dedupe.has(key)) { return; }
        dedupe.add(key);
        matches.push({ uri, line, lineText, kind });
      };

      const scanDocument = (doc: vscode.TextDocument) => {
        for (let i = 0; i < doc.lineCount; i++) {
          const lineText = doc.lineAt(i).text;
          const trimmed = lineText.trim();

          // 节定义
          const sectionMatch = trimmed.match(/^\[\s*([^\]]+)\s*\]/);
          if (sectionMatch && sectionMatch[1].trim().toLowerCase() === lowerName) {
            pushMatch(doc.uri, i, lineText, 'section');
          }

          if (trimmed.startsWith('[')) { continue; }

          const eq = lineText.indexOf('=');
          if (eq > 0) {
            const value = lineText.substring(eq + 1);
            const commentIdx = Math.min(
              value.indexOf(';') >= 0 ? value.indexOf(';') : Infinity,
              value.indexOf('#') >= 0 ? value.indexOf('#') : Infinity
            );
            const cleanValue = (commentIdx < Infinity ? value.substring(0, commentIdx) : value).trim();
            if (!cleanValue) { continue; }

            const values = cleanValue.split(',').map(v => v.trim()).filter(v => v.length > 0);
            for (const v of values) {
              if (v.toLowerCase() === lowerName) {
                pushMatch(doc.uri, i, lineText, 'value');
                break;
              }
            }
          }
        }
      };

      // 键名重命名仅在当前文档范围内处理，避免误报
      if (!isSection) {
        const targetDoc = currentDocument ?? vscode.window.activeTextEditor?.document;
        if (targetDoc) {
          scanDocument(targetDoc);
        }
        return matches;
      }

      if (scope !== 'workspace' && currentDocument) {
        scanDocument(currentDocument);
      }

      if (scope === 'indexed') {
        const defs = this.indexManager.findSectionDefinitions(name);
        defs.forEach(def => pushMatch(vscode.Uri.file(def.file), def.line, '', 'section'));

        const refs = this.indexManager.findSectionReferences(name);
        refs.forEach(ref => {
          try {
            const uri = vscode.Uri.file(ref.file);
            pushMatch(uri, ref.line, '', 'value');
          } catch { /* ignore */ }
        });

        // 已经有足够信息时不再全量扫描
        if (matches.length > 0) {
          return matches;
        }
      }

      // 回退：根据 scope 扫描文件
      const files = scope === 'current' && currentDocument
        ? [currentDocument.uri]
        : await vscode.workspace.findFiles('**/*.ini');

      for (const uri of files) {
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          scanDocument(doc);
        } catch { /* ignore */ }
      }

      return matches;
    }

    /**
     * 获取某一行所属的完整节配置
     */
    private async getSectionContent(uri: vscode.Uri, lineNumber: number): Promise<{
        sectionName: string;
        startLine: number;
        endLine: number;
        lines: string[];
    } | null> {
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            let sectionStart = -1;
            let sectionName = '';

            // 向上查找节头
            for (let i = lineNumber; i >= 0; i--) {
                const line = doc.lineAt(i).text.trim();
                const match = line.match(/^\[([^\]]+)\]/);
                if (match) {
                    sectionStart = i;
                    sectionName = match[1];
                    break;
                }
            }

            if (sectionStart === -1) {
                return null; // 没有找到节头
            }

            // 向下查找节的结束位置
            let sectionEnd = doc.lineCount - 1;
            for (let i = sectionStart + 1; i < doc.lineCount; i++) {
                const line = doc.lineAt(i).text.trim();
                if (line.match(/^\[([^\]]+)\]/)) {
                    sectionEnd = i - 1;
                    break;
                }
            }

            // 提取节内容
            const lines: string[] = [];
            for (let i = sectionStart; i <= sectionEnd; i++) {
                lines.push(doc.lineAt(i).text);
            }

            return {
                sectionName,
                startLine: sectionStart,
                endLine: sectionEnd,
                lines
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * 显示重命名预览（使用 Webview Diff 面板）
     */
    private async showRenamePreview(candidate: RenameCandidate, references: ReferenceMatch[]): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'renamePreview',
            `重命名预览: ${candidate.originalName} → ${candidate.newName}`,
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );

        const fileGroups = new Map<string, ReferenceMatch[]>();
        for (const ref of references) {
            const key = ref.uri.fsPath;
            if (!fileGroups.has(key)) { fileGroups.set(key, []); }
            fileGroups.get(key)!.push(ref);
        }

        panel.webview.html = await this.getWebviewContent(candidate, fileGroups, references);

        // 处理来自 Webview 的消息
        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'apply') {
                const selectedIndices = new Set<number>(message.indices || []);
                await this.applyRename(candidate, references, selectedIndices);
                panel.dispose();
            } else if (message.command === 'cancel') {
                vscode.window.showInformationMessage('已取消重命名');
                panel.dispose();
            }
        });
    }

    /**
     * 应用重命名
     */
    private async applyRename(
        candidate: RenameCandidate,
        references: ReferenceMatch[],
        selectedIndices: Set<number>
    ): Promise<void> {
      const edit = await this.buildWorkspaceEdit(candidate, references, selectedIndices);
      const applied = await vscode.workspace.applyEdit(edit);
        if (applied) {
            vscode.window.showInformationMessage(`已更新 ${selectedIndices.size} 个引用`);
        } else {
            vscode.window.showErrorMessage('应用更新时出错');
        }
    }

    private async buildWorkspaceEdit(
      candidate: RenameCandidate,
      references: ReferenceMatch[],
      selectedIndices?: Set<number>
    ): Promise<vscode.WorkspaceEdit> {
      const edit = new vscode.WorkspaceEdit();
      const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const indices = selectedIndices ?? new Set<number>(references.map((_, idx) => idx));

      for (let i = 0; i < references.length; i++) {
        if (!indices.has(i)) { continue; }
        const ref = references[i];
        const doc = await vscode.workspace.openTextDocument(ref.uri);
        const line = doc.lineAt(ref.line);
        const text = line.text;

        if (ref.kind === 'section') {
          const startIdx = text.indexOf('[');
          const endIdx = text.indexOf(']');
          if (startIdx >= 0 && endIdx > startIdx) {
            const s = new vscode.Position(ref.line, startIdx + 1);
            const e = new vscode.Position(ref.line, endIdx);
            edit.replace(ref.uri, new vscode.Range(s, e), candidate.newName);
          }
        } else {
          const regex = new RegExp(`\\b${escapeRegex(candidate.originalName)}\\b`, 'g');
          let match: RegExpExecArray | null;
          while ((match = regex.exec(text)) !== null) {
            const s = new vscode.Position(ref.line, match.index);
            const e = new vscode.Position(ref.line, match.index + match[0].length);
            edit.replace(ref.uri, new vscode.Range(s, e), candidate.newName);
          }
        }
      }

      return edit;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * 高亮显示文本中的变化部分
     */
    private highlightChanges(text: string, targetWord: string, type: 'original' | 'new'): string {
        const escaped = this.escapeHtml(text);
        const highlightClass = type === 'original' ? 'highlight-remove' : 'highlight-add';
        const regex = new RegExp(`\\b(${this.escapeRegex(targetWord)})\\b`, 'gi');
        return escaped.replace(regex, `<span class="${highlightClass}">$1</span>`);
    }

    /**
     * 生成 Webview HTML 内容
     */
    private async getWebviewContent(
        candidate: RenameCandidate,
        fileGroups: Map<string, ReferenceMatch[]>,
        allReferences: ReferenceMatch[]
    ): Promise<string> {
        const rows: string[] = [];
        let index = 0;

        for (const [filePath, refs] of fileGroups.entries()) {
            const relativePath = vscode.workspace.asRelativePath(filePath);
            rows.push(`<div class="file-header">${this.escapeHtml(relativePath)} (${refs.length} 处)</div>`);

            for (const ref of refs) {
                // 获取完整的节配置
                const sectionContent = await this.getSectionContent(ref.uri, ref.line);

                if (sectionContent) {
                    // 显示完整节配置，并高亮变化的行
                    const originalLines = sectionContent.lines.map((line, idx) => {
                        const actualLine = sectionContent.startLine + idx;
                        const isChangedLine = actualLine === ref.line;
                        const displayLine = isChangedLine
                            ? this.highlightChanges(line, candidate.originalName, 'original')
                            : this.escapeHtml(line);
                        const lineClass = isChangedLine ? 'line-changed' : '';
                        return `<div class="code-line ${lineClass}">${displayLine}</div>`;
                    }).join('');

                    const newLines = sectionContent.lines.map((line, idx) => {
                        const actualLine = sectionContent.startLine + idx;
                        const isChangedLine = actualLine === ref.line;
                        const newLine = isChangedLine
                            ? line.replace(new RegExp(`\\b${this.escapeRegex(candidate.originalName)}\\b`, 'gi'), candidate.newName)
                            : line;
                        const displayLine = isChangedLine
                            ? this.highlightChanges(newLine, candidate.newName, 'new')
                            : this.escapeHtml(newLine);
                        const lineClass = isChangedLine ? 'line-changed' : '';
                        return `<div class="code-line ${lineClass}">${displayLine}</div>`;
                    }).join('');

                    rows.push(`
            <div class="diff-item">
              <input type="checkbox" id="check-${index}" checked data-index="${index}">
              <label for="check-${index}">
                <span class="section-name">[${this.escapeHtml(sectionContent.sectionName)}]</span>
                <span class="line-number">Line ${ref.line + 1}</span>
                <span class="kind-badge ${ref.kind}">${ref.kind === 'section' ? '节' : '值'}</span>
              </label>
              <div class="diff-container">
                <div class="diff-side">
                  <div class="diff-title">原始</div>
                  <div class="code-block">${originalLines}</div>
                </div>
                <div class="diff-side">
                  <div class="diff-title">修改后</div>
                  <div class="code-block">${newLines}</div>
                </div>
              </div>
            </div>
          `);
                } else {
                    // 降级方案：只显示单行
                    const originalLine = ref.lineText;
                    const newLine = originalLine.replace(
                        new RegExp(`\\b${this.escapeRegex(candidate.originalName)}\\b`, 'gi'),
                        candidate.newName
                    );

                    const originalHighlighted = this.highlightChanges(originalLine, candidate.originalName, 'original');
                    const newHighlighted = this.highlightChanges(newLine, candidate.newName, 'new');

                    rows.push(`
            <div class="diff-item">
              <input type="checkbox" id="check-${index}" checked data-index="${index}">
              <label for="check-${index}">
                <span class="line-number">Line ${ref.line + 1}</span>
                <span class="kind-badge ${ref.kind}">${ref.kind === 'section' ? '节' : '值'}</span>
              </label>
              <div class="diff-lines">
                <div class="line line-remove">${originalHighlighted}</div>
                <div class="line line-add">${newHighlighted}</div>
              </div>
            </div>
          `);
                }
                index++;
            }
        }

        return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      padding: 20px;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    .header {
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 2px solid var(--vscode-panel-border);
    }
    .header h2 {
      font-size: 18px;
      margin-bottom: 10px;
      color: var(--vscode-textLink-foreground);
    }
    .header p {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }
    .toolbar {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }
    .toolbar button {
      padding: 8px 16px;
      border: 1px solid var(--vscode-button-border);
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.2s;
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .file-header {
      background: var(--vscode-editorGroupHeader-tabsBackground);
      padding: 8px 12px;
      margin-top: 15px;
      font-weight: 600;
      border-left: 3px solid var(--vscode-textLink-foreground);
    }
    .diff-item {
      margin: 10px 0;
      padding: 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: var(--vscode-editor-background);
    }
    .diff-item input[type="checkbox"] {
      margin-right: 8px;
      cursor: pointer;
    }
    .diff-item label {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    .section-name {
      color: var(--vscode-textLink-foreground);
      font-weight: 600;
      font-size: 13px;
    }
    .line-number {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .kind-badge {
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
    }
    .kind-badge.section {
      background: rgba(100, 150, 255, 0.2);
      color: rgb(100, 150, 255);
    }
    .kind-badge.value {
      background: rgba(100, 200, 100, 0.2);
      color: rgb(100, 200, 100);
    }
    .diff-container {
      display: flex;
      gap: 10px;
      margin-top: 8px;
    }
    .diff-side {
      flex: 1;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      overflow: hidden;
    }
    .diff-title {
      background: var(--vscode-editorGroupHeader-tabsBackground);
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
    }
    .code-block {
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 13px;
      background: var(--vscode-editor-background);
      overflow-x: auto;
    }
    .code-line {
      padding: 2px 8px;
      white-space: pre;
      line-height: 1.5;
      min-width: fit-content;
      display: inline-block;
      width: 100%;
    }
    .code-line.line-changed {
      background: rgba(255, 165, 0, 0.15);
    }
    .diff-lines {
      margin-top: 8px;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 13px;
      overflow-x: auto;
    }
    .line {
      padding: 4px 8px;
      margin: 2px 0;
      white-space: pre;
      min-width: fit-content;
      display: inline-block;
      width: 100%;
    }
    .line-remove {
      background: rgba(255, 0, 0, 0.15);
      color: var(--vscode-editor-foreground);
    }
    .line-add {
      background: rgba(0, 255, 0, 0.15);
      color: var(--vscode-editor-foreground);
    }
    .highlight-remove {
      background: rgba(255, 0, 0, 0.4);
      font-weight: bold;
      padding: 2px 4px;
      border-radius: 2px;
    }
    .highlight-add {
      background: rgba(0, 255, 0, 0.4);
      font-weight: bold;
      padding: 2px 4px;
      border-radius: 2px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>重命名预览: ${this.escapeHtml(candidate.originalName)} → ${this.escapeHtml(candidate.newName)}</h2>
    <p>检测到 ${allReferences.length} 个相关引用，请选择要更新的项目</p>
  </div>
  
  <div class="toolbar">
    <button class="btn-primary" onclick="applySelected()">应用所选</button>
    <button class="btn-primary" onclick="applyAll()">全部应用</button>
    <button class="btn-secondary" onclick="cancel()">取消</button>
    <button class="btn-secondary" onclick="toggleAll()">全选/取消全选</button>
  </div>

  <div class="content">
    ${rows.join('\n')}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    
    function applySelected() {
      const indices = [];
      document.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        indices.push(parseInt(cb.dataset.index));
      });
      if (indices.length === 0) {
        alert('请至少选择一项');
        return;
      }
      vscode.postMessage({ command: 'apply', indices });
    }
    
    function applyAll() {
      const indices = [];
      document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        indices.push(parseInt(cb.dataset.index));
      });
      vscode.postMessage({ command: 'apply', indices });
    }
    
    function cancel() {
      vscode.postMessage({ command: 'cancel' });
    }
    
    function toggleAll() {
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      checkboxes.forEach(cb => cb.checked = !allChecked);
    }
  </script>
</body>
</html>`;
    }
}
