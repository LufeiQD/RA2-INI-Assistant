import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface IniReferenceItem {
  key: string;
  section: string;
  sectionLabel: string;
  typeLabel: string;
  platform: string;
  platformLabel: string;
  chapter?: string;
  description: string;
  originalDescription?: string;
  insertOptions?: Array<{
    label: string;
    value: string;
    description: string;
  }>;
  searchKeywords: string;
}

interface IniReference {
  version: string;
  source: string;
  sourceFiles: string[];
  metadata: {
    totalItems: number;
    aresItems?: number;
    phobosItems?: number;
    totalCategories: number;
    categories: string[];
  };
  index: Array<Omit<IniReferenceItem, 'insertOptions' | 'originalDescription'>>;
  categories: Record<string, {
    label: string;
    description: string;
    platform?: string;
    items: IniReferenceItem[];
  }>;
}

let referenceData: IniReference | null = null;
let referenceDataPromise: Promise<IniReference> | null = null;
let previewPanel: vscode.WebviewPanel | undefined;
let originalDictItems: IniReferenceItem[] | null = null;

/**
 * 加载 INI 参考数据
 */
async function loadIniReference(): Promise<IniReference> {
  if (referenceData) {
    return referenceData;
  }

  if (referenceDataPromise) {
    return referenceDataPromise;
  }

  referenceDataPromise = (async () => {
    try {
      const extensionPath = vscode.extensions.getExtension('LuFeiCmm.ra2-ini-assistant')?.extensionPath
        || path.dirname(path.dirname(__dirname));
      const refPath = path.join(extensionPath, 'dist', 'assets', 'unified-ini-reference.json');

      if (!fs.existsSync(refPath)) {
        throw new Error(`参考文件不存在: ${refPath}`);
      }

      const content = fs.readFileSync(refPath, 'utf8');
      referenceData = JSON.parse(content);
      console.log(`[ARES] 成功加载 ${referenceData!.metadata.totalItems} 个配置项`);
      return referenceData!;
    } catch (error) {
      console.error('[ARES] 加载参考数据失败:', error);
      throw error;
    }
  })();

  return referenceDataPromise;
}

/**
 * 加载原版词典（来自 translations.json 的 common/values）
 */
async function loadOriginalDictionary(): Promise<IniReferenceItem[]> {
  if (originalDictItems) {
    return originalDictItems;
  }

  try {
    const extensionPath = vscode.extensions.getExtension('LuFeiCmm.ra2-ini-assistant')?.extensionPath
      || path.dirname(path.dirname(__dirname));

    const possiblePaths = [
      path.join(extensionPath, 'dist', 'assets', 'translations.json'),
      path.join(extensionPath, 'assets', 'translations.json'),
      path.join(extensionPath, 'out', 'assets', 'translations.json'),
    ];

    let translationsPath = '';
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        translationsPath = p;
        break;
      }
    }

    if (!translationsPath) {
      console.warn('[ARES] 未找到 translations.json，原版词典将不可用');
      originalDictItems = [];
      return originalDictItems;
    }

    const data = JSON.parse(fs.readFileSync(translationsPath, 'utf8'));
    const common = data?.common || {};
    const values = data?.values || {};

    const items: IniReferenceItem[] = [];

    const genInsertOptions = (key: string, desc: string) => ([
      { label: '插入键名', value: key, description: `插入: ${key}` },
      { label: '键名 =', value: `${key}=`, description: `插入: ${key}=` },
      { label: '插入注释', value: `; ${desc.substring(0, 100).replace(/\n/g, ' ')}${desc.length > 100 ? '...' : ''}`, description: '作为注释插入说明' }
    ]);

    // 将 common 中的键转为参考项（排除明显的中文键名）
    for (const [key, desc] of Object.entries(common)) {
      if (typeof desc !== 'string') { continue; }
      // 跳过中文键名或过短的键名
      if (/^[\u4e00-\u9fa5]/.test(key) || key.length < 2) { continue; }

      const item: IniReferenceItem = {
        key,
        section: 'Original',
        sectionLabel: '原版词典',
        typeLabel: '通用',
        platform: 'Original',
        platformLabel: '原版',
        description: desc,
        originalDescription: desc,
        insertOptions: genInsertOptions(key, desc),
        searchKeywords: `${key} 原版 ${desc}`
      };
      items.push(item);
    }

    // 将 values 预设值也纳入（如 yes/no/true/false）
    for (const [key, desc] of Object.entries(values)) {
      if (typeof desc !== 'string') { continue; }
      const item: IniReferenceItem = {
        key,
        section: 'Original',
        sectionLabel: '原版词典',
        typeLabel: '预设值',
        platform: 'Original',
        platformLabel: '原版',
        description: desc,
        originalDescription: desc,
        insertOptions: [
          { label: '插入值', value: key, description: `插入: ${key}` },
          { label: '插入注释', value: `; ${desc}`, description: '作为注释插入说明' }
        ],
        searchKeywords: `${key} 原版 ${desc}`
      };
      items.push(item);
    }

    // 去重与排序（按键名）
    const seen = new Set<string>();
    originalDictItems = items.filter(i => {
      if (seen.has(i.key)) { return false; }
      seen.add(i.key);
      return true;
    }).sort((a, b) => a.key.localeCompare(b.key));

    console.log(`[ARES] 原版词典加载完成: ${originalDictItems.length} 项`);
    return originalDictItems;
  } catch (err) {
    console.warn('[ARES] 加载原版词典失败:', err);
    originalDictItems = [];
    return originalDictItems;
  }
}

/**
 * 获取 Quick Pick 项列表
 */
async function getQuickPickItems(): Promise<Array<vscode.QuickPickItem & { data: IniReferenceItem }>> {
  const reference = await loadIniReference();
  const originals = await loadOriginalDictionary();

  const aresPhobosItems = reference.index.map((item: any) => ({
    label: item.key,
    description: item.description.substring(0, 150) + (item.description.length > 150 ? '...' : ''),
    detail: `[${item.sectionLabel}] ${item.typeLabel}${item.chapter && item.chapter !== '未分类' ? ' | 📖 ' + item.chapter : ''} | 📦 ${item.platformLabel}`,
    data: item as IniReferenceItem
  }));

  const originalItems = originals.map((item) => ({
    label: item.key,
    description: item.description.substring(0, 150) + (item.description.length > 150 ? '...' : ''),
    detail: `[${item.sectionLabel}] ${item.typeLabel} | 📦 ${item.platformLabel}`,
    data: item
  }));

  return [...aresPhobosItems, ...originalItems];
}

/**
 * 获取完整的项数据（包括插入选项）
 */
async function getFullItemData(key: string): Promise<IniReferenceItem | null> {
  const reference = await loadIniReference();

  // 从分类中查找完整数据
  for (const category of Object.values(reference.categories)) {
    const item = category.items.find(i => i.key === key);
    if (item) {
      return item;
    }
  }
  // 尝试在原版词典中查找
  const originals = await loadOriginalDictionary();
  const found = originals.find(i => i.key === key);
  if (found) { return found; }

  return null;
}

/**
 * 显示 INI 参考搜索窗口
 */
export async function showIniReferenceQuickPick(editor: vscode.TextEditor): Promise<void> {
  try {
    const allItems = await getQuickPickItems();

    const quickPick = vscode.window.createQuickPick();
    quickPick.items = allItems as any;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.placeholder = '搜索配置项（支持键名、说明、分组、平台、章节）...';
    quickPick.title = 'INI 配置参考 - 原版 & ARES & Phobos (Ctrl+Shift+A)  |  筛选按钮顺序：全部 | 原版 | ARES | Phobos';
    quickPick.canSelectMany = false;

    let selectedItem: (vscode.QuickPickItem & { data: IniReferenceItem }) | undefined;
    let currentFilter: 'All' | 'Original' | 'ARES' | 'Phobos' = 'All';

    //  tooltip，同时在标题中注明按钮顺序，避免被鼠标遮挡时不明其义
    const btnAll: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('list-filter'), tooltip: '显示全部' };
    const btnOriginal: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('book'), tooltip: '仅原版' };
    const btnAres: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('rocket'), tooltip: '仅 ARES' };
    const btnPhobos: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('beaker'), tooltip: '仅 Phobos' };
    const submitForm: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('globe'), tooltip: '共创补充词典' };
    const baseButtons: vscode.QuickInputButton[] = [btnAll, btnOriginal, btnAres, btnPhobos, submitForm];
    const previewBtn: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('eye'), tooltip: '在预览面板查看完整说明' };

    function applyFilter() {
      let filtered = allItems;
      switch (currentFilter) {
        case 'Original':
          filtered = allItems.filter(i => (i as any).data.platform === 'Original');
          break;
        case 'ARES':
          filtered = allItems.filter(i => (i as any).data.platform === 'ARES');
          break;
        case 'Phobos':
          filtered = allItems.filter(i => (i as any).data.platform === 'Phobos');
          break;
        default:
          filtered = allItems;
      }
      quickPick.items = filtered as any;
      const filterLabel = currentFilter === 'All' ? '全部' : currentFilter;
      quickPick.placeholder = `搜索配置项（当前筛选：${filterLabel}；右上角按钮顺序：全部 | 原版 | ARES | Phobos | 共创补充词典）`;
      vscode.window.setStatusBarMessage(`INI 参考：当前筛选 ${filterLabel}`, 2000);
    }

    quickPick.buttons = baseButtons;
    applyFilter();

    quickPick.onDidChangeSelection((selection) => {
      selectedItem = selection[0] as any;
      if (selectedItem) {
        quickPick.buttons = [...baseButtons, previewBtn];
      }
    });

    quickPick.onDidTriggerButton(async (button) => {
      if (button === previewBtn) {
        if (selectedItem && selectedItem.data) {
          const cached = (selectedItem.data as any).insertOptions ? selectedItem.data : await getFullItemData(selectedItem.data.key);
          if (cached) {
            await showPreviewPanel(cached, editor);
            quickPick.hide();
          }
        }
        return;
      }

      if (button === btnAll) { currentFilter = 'All'; }
      else if (button === btnOriginal) { currentFilter = 'Original'; }
      else if (button === btnAres) { currentFilter = 'ARES'; }
      else if (button === btnPhobos) { currentFilter = 'Phobos'; }
      else if (button === submitForm) {
        vscode.env.openExternal(vscode.Uri.parse('https://www.kdocs.cn/l/cb9J4r5kF9uC'));
        return;
      }

      applyFilter();
    });

    quickPick.onDidAccept(async () => {
      if (!selectedItem) {
        quickPick.dispose();
        return;
      }
      const data = selectedItem.data;
      const fullData = (data as any).insertOptions ? data : await getFullItemData(data.key);
      if (!fullData) {
        vscode.window.showErrorMessage(`无法找到 ${data.key} 的完整信息`);
        quickPick.dispose();
        return;
      }
      await showPreviewPanel(fullData as IniReferenceItem, editor);
      quickPick.dispose();
    });

    quickPick.onDidHide(() => {
      quickPick.dispose();
    });

    quickPick.show();
  } catch (error) {
    vscode.window.showErrorMessage(`INI 参考加载失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}


/**
 * 显示 Webview 预览面板
 */
async function showPreviewPanel(item: IniReferenceItem, editor: vscode.TextEditor): Promise<void> {
  const fullDesc = item.originalDescription || item.description;
  // 如果已有面板，则复用
  if (previewPanel) {
    previewPanel.reveal();
  } else {
    previewPanel = vscode.window.createWebviewPanel(
      'iniPreview',
      'INI 配置参考',
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );
    previewPanel.onDidDispose(() => {
      previewPanel = undefined;
    });
  }

  // 构建HTML内容
  const htmlContent = getPreviewHtml(item, fullDesc);
  previewPanel.webview.html = htmlContent;

  // 处理来自Webview的消息
  previewPanel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === 'insert') {
      await insertContent(message.value, editor);
      vscode.window.showInformationMessage(`已插入: ${message.label}`);
    }
  });
}

/**
 * 生成预览面板的HTML内容
 */
function getPreviewHtml(item: IniReferenceItem, fullDesc: string): string {
  const insertButtons = item.insertOptions
    ?.map((opt, idx) => `
      <button class="insert-btn" onclick="insertItem('${opt.value.replace(/'/g, "\\'")}', '${opt.label.replace(/'/g, "\\'")}')">
        <span class="icon">⚡</span>
        <span class="label">${opt.label}</span>
        <span class="desc">${opt.description}</span>
      </button>
    `)
    .join('') || '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          padding: 20px;
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
          line-height: 1.6;
        }

        .container {
          max-width: 100%;
        }

        .header {
          margin-bottom: 20px;
          padding-bottom: 12px;
          border-bottom: 2px solid var(--vscode-textBlockQuote-border);
        }

        .key-name {
          font-size: 24px;
          font-weight: 600;
          color: var(--vscode-symbolIcon-methodForeground);
          margin-bottom: 8px;
          font-family: 'Courier New', monospace;
          word-break: break-all;
        }

        .meta {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }

        .meta-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .meta-label {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .meta-value {
          font-size: 14px;
          font-weight: 500;
          color: var(--vscode-symbolIcon-structForeground);
        }

        .description {
          margin: 20px 0;
          padding: 12px;
          background-color: var(--vscode-textCodeBlock-background);
          border-left: 3px solid var(--vscode-symbolIcon-stringForeground);
          border-radius: 4px;
          white-space: pre-wrap;
          word-wrap: break-word;
          line-height: 1.8;
        }

        .insert-section {
          margin-top: 20px;
        }

        .section-title {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 12px;
          font-weight: 600;
        }

        .insert-buttons {
          display: grid;
          gap: 10px;
        }

        .insert-btn {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          padding: 12px 16px;
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: 1px solid var(--vscode-button-border, transparent);
          border-radius: 4px;
          cursor: pointer;
          transition: background-color 0.2s, transform 0.1s;
          font-family: inherit;
          text-align: left;
        }

        .insert-btn:hover {
          background-color: var(--vscode-button-hoverBackground);
          transform: translateY(-1px);
        }

        .insert-btn:active {
          transform: translateY(0);
        }

        .insert-btn .icon {
          font-size: 16px;
        }

        .insert-btn .label {
          font-size: 13px;
          font-weight: 600;
          width: 100%;
        }

        .insert-btn .desc {
          font-size: 11px;
          color: var(--vscode-button-foreground);
          opacity: 0.8;
          width: 100%;
        }

        .tip {
          margin-top: 16px;
          padding: 10px 12px;
          background-color: var(--vscode-editorInfo-background);
          color: var(--vscode-editorInfo-foreground);
          border-left: 3px solid var(--vscode-editorInfo-border);
          border-radius: 2px;
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="key-name">${item.key}</div>
          <div class="meta">
            <div class="meta-item">
              <div class="meta-label">平台</div>
              <div class="meta-value">${item.platformLabel}</div>
            </div>
            <div class="meta-item">
              <div class="meta-label">分类</div>
              <div class="meta-value">${item.sectionLabel}</div>
            </div>
            <div class="meta-item">
              <div class="meta-label">类型</div>
              <div class="meta-value">${item.typeLabel}</div>
            </div>
            ${item.chapter && item.chapter !== '未分类' ? `
            <div class="meta-item">
              <div class="meta-label">章节</div>
              <div class="meta-value">${item.chapter}</div>
            </div>
            ` : ''}
          </div>
        </div>

        <div class="description">${escapeHtml(fullDesc)}</div>

        <div class="insert-section">
          <div class="section-title">插入方式</div>
          <div class="insert-buttons">
            ${insertButtons}
          </div>
          <div class="tip">💡 点击按钮可直接插入到编辑器中</div>
        </div>
      </div>

      <script>
        function insertItem(value, label) {
          vscode.postMessage({
            command: 'insert',
            value: value,
            label: label
          });
        }

        const vscode = acquireVsCodeApi();
      </script>
    </body>
    </html>
  `;
}

/**
 * 转义HTML特殊字符
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

// 转义为正则安全字符串
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 插入内容到编辑器
 */
async function insertContent(value: string, editor: vscode.TextEditor): Promise<void> {
  const document = editor.document;
  const position = editor.selection.active;

  // 提取要插入的键名（如果是注释则允许重复插入）
  const isComment = value.trim().startsWith(';') || value.trim().startsWith('#');

  if (!isComment) {
    const keyMatch = value.match(/^([^=\s]+)\s*=/);
    if (keyMatch) {
      const keyToInsert = keyMatch[1].trim();

      // 向上查找当前所在的节
      let currentSection: string | null = null;
      for (let i = position.line; i >= 0; i--) {
        const lineText = document.lineAt(i).text.trim();
        const sectionMatch = lineText.match(/^\[([^\]]+)\]/);
        if (sectionMatch) {
          currentSection = sectionMatch[1];
          break;
        }
      }

      if (currentSection) {
        // 在当前节内查找是否已存在该键
        let sectionStartLine = -1;
        let sectionEndLine = position.line;

        // 找到节开始行
        for (let i = position.line; i >= 0; i--) {
          const lineText = document.lineAt(i).text.trim();
          if (lineText.match(/^\[([^\]]+)\]/)) {
            sectionStartLine = i;
            break;
          }
        }

        // 找到节结束行（下一个节开始或文档末尾）
        for (let i = position.line + 1; i < document.lineCount; i++) {
          const lineText = document.lineAt(i).text.trim();
          if (lineText.match(/^\[([^\]]+)\]/)) {
            sectionEndLine = i - 1;
            break;
          }
          sectionEndLine = i;
        }

        // 检查节内是否已存在该键
        if (sectionStartLine >= 0) {
          for (let i = sectionStartLine + 1; i <= sectionEndLine; i++) {
            const lineText = document.lineAt(i).text.trim();
            // 跳过注释行
            if (lineText.startsWith(';') || lineText.startsWith('#')) {
              continue;
            }

            const existingKeyMatch = lineText.match(/^([^=\s]+)\s*=/);
            if (existingKeyMatch && existingKeyMatch[1].trim() === keyToInsert) {
              vscode.window.showWarningMessage(`配置项 "${keyToInsert}" 在节 [${currentSection}] 中已存在`);
              return;
            }
          }
        }
      }
    }
  }

  // 检查当前行是否有内容
  const currentLine = document.lineAt(position.line);
  const currentLineText = currentLine.text.trim();

  await editor.edit((editBuilder) => {
    if (currentLineText === '') {
      // 当前行为空，直接插入
      editBuilder.insert(position, value);
    } else {
      // 当前行有内容，换行后插入
      const lineEnd = currentLine.range.end;
      editBuilder.insert(lineEnd, '\n' + value);
    }
  });
}

/**
 * 显示完整描述（保持向后兼容）
 */
async function showFullDescription(item: IniReferenceItem): Promise<void> {
  const fullDesc = item.originalDescription || item.description;
  const markdown = `# ${item.key}

**分类**: ${item.sectionLabel}  
**类型**: ${item.typeLabel}

---

${fullDesc}`;

  // 使用输出面板显示详细信息
  const channel = vscode.window.createOutputChannel(`ARES: ${item.key}`);
  channel.appendLine(markdown);
  channel.show(true);
}

/**
 * 显示插入方式选择窗口 - 改进版本
 */

/**
 * 预加载参考数据（在扩展激活时调用）
 */
export async function preloadIniReference(): Promise<void> {
  try {
    await loadIniReference();
  } catch (error) {
    console.warn('[ARES] 预加载参考数据失败，将在首次使用时加载');
  }
}

// 批量重命名命令：只对工作区内非资源/原版文件中的引用进行替换，并允许用户交互选择引用项
export async function batchRenameKeysCommand(editor?: vscode.TextEditor | undefined): Promise<void> {
  try {
    let name = '';
    let isSection = false;

    if (editor) {
      const lineNum = editor.selection.active.line;
      const lineText = editor.document.lineAt(lineNum).text;
      const sectMatch = lineText.match(/^\s*\[([^\]]+)\]/);
      if (sectMatch) {
        isSection = true;
        name = sectMatch[1];
      } else {
        const wr = editor.document.getWordRangeAtPosition(editor.selection.active, /[^\s=;#\[\]]+/);
        if (wr) { name = editor.document.getText(wr).trim(); }
      }
    }

    if (!name) {
      const typePick = await vscode.window.showQuickPick([
        { label: '键 (Key)', kind: 'key' as any },
        { label: '节名 (Section)', kind: 'section' as any }
      ], { placeHolder: '请选择要重命名的类型' });
      if (!typePick) { vscode.window.showInformationMessage('已取消'); return; }
      isSection = (typePick.kind === 'section');

      name = await vscode.window.showInputBox({ prompt: isSection ? '请输入要重命名的节名' : '请输入要重命名的键名', placeHolder: isSection ? '例如: ShieldTypes' : '例如: Speed' }) || '';
    }

    if (!name) { vscode.window.showInformationMessage('已取消：未指定名称'); return; }

    const newName = await vscode.window.showInputBox({
      prompt: `将 ${isSection ? '节名' : '键'} '${name}' 重命名为：`,
      value: name,
      validateInput: v => v.trim().length === 0 ? '名称不能为空' : (v.trim().length > 200 ? '名称过长' : null)
    });
    if (!newName || newName.trim() === name) { vscode.window.showInformationMessage('已取消或未修改名称'); return; }

    const matches: Array<{ uri: vscode.Uri; line: number; lineText: string; kind: 'section' | 'value' }> = [];

    // 如果当前编辑器存在未保存的更改，提示用户先保存或选择继续
    if (editor && editor.document.isDirty) {
      const choice = await vscode.window.showInformationMessage('当前文件未保存，建议先保存后继续。', '保存并继续', '继续不保存', '取消');
      if (choice === '保存并继续') {
        const saved = await editor.document.save();
        if (!saved) { vscode.window.showWarningMessage('保存失败，已取消操作'); return; }
      } else if (choice === '取消' || !choice) {
        vscode.window.showInformationMessage('已取消操作');
        return;
      }
      // 若为 '继续不保存' 则继续执行
    }

    const files = await vscode.workspace.findFiles('**/*.ini');
    const wordRegex = new RegExp(`\\b${escapeRegex(name)}\\b`);
    const sectionHeaderRegex = new RegExp(`^\\s*\\[\\s*${escapeRegex(name)}\\s*\\]`);

    for (const uri of files) {
      try {
        if (uri.scheme !== 'file') { continue; }
        const doc = await vscode.workspace.openTextDocument(uri);
        for (let i = 0; i < doc.lineCount; i++) {
          const text = doc.lineAt(i).text;
          if (sectionHeaderRegex.test(text)) {
            matches.push({ uri, line: i, lineText: text, kind: 'section' });
            continue;
          }
          if (wordRegex.test(text)) {
            matches.push({ uri, line: i, lineText: text, kind: 'value' });
          }
        }
      } catch (e) { }
    }

    if (matches.length === 0) { vscode.window.showInformationMessage(`未找到 '${name}' 的任何引用（已仅搜索 *.ini 文件）`); return; }

    const items = matches.map((m, idx) => ({
      label: `[${m.kind === 'section' ? '节' : '值'}] ${path.basename(m.uri.fsPath)}:${m.line + 1}`,
      description: vscode.workspace.asRelativePath(m.uri.fsPath),
      detail: m.lineText.trim(),
      idx
    }));

    const picks = await vscode.window.showQuickPick(items, { canPickMany: true, placeHolder: `选择要将 ${name} -> ${newName} 的引用（默认全选）` });
    if (!picks || picks.length === 0) { vscode.window.showInformationMessage('已取消替换'); return; }
    const selectedIdx = new Set(picks.map(p => p.idx));

    // 生成拟议变更（按文件分组）
    const fileChanges = new Map<string, Array<{ line: number; original: string; modified: string }>>();
    for (let i = 0; i < matches.length; i++) {
      if (!selectedIdx.has(i)) { continue; }
      const m = matches[i];
      const doc = await vscode.workspace.openTextDocument(m.uri);
      const line = doc.lineAt(m.line);
      const text = line.text;

      if (!fileChanges.has(m.uri.fsPath)) {fileChanges.set(m.uri.fsPath, []);}

      if (m.kind === 'section') {
        const startIdx = text.indexOf('[');
        const endIdx = text.indexOf(']');
        if (startIdx >= 0 && endIdx > startIdx) {
          const before = text.substring(startIdx + 1, endIdx);
          const after = newName;
          fileChanges.get(m.uri.fsPath)!.push({ line: m.line, original: before, modified: after });
        }
      } else {
        const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
        const originalLine = text;
        const modifiedLine = originalLine.replace(regex, newName);
        if (originalLine !== modifiedLine) {
          fileChanges.get(m.uri.fsPath)!.push({ line: m.line, original: originalLine, modified: modifiedLine });
        }
      }
    }

    // 输出预览到输出通道
    const channel = vscode.window.createOutputChannel('RA2 Rename Preview');
    channel.clear();
    channel.appendLine(`批量重命名预览：${name} -> ${newName}`);
    for (const [filePath, changes] of fileChanges.entries()) {
      channel.appendLine(`\nFile: ${vscode.workspace.asRelativePath(filePath)}`);
      for (const ch of changes) {
        channel.appendLine(`  Line ${ch.line + 1}:`);
        channel.appendLine(`    - ${ch.original}`);
        channel.appendLine(`    + ${ch.modified}`);
      }
    }
    channel.show(true);

    // 同时打开一个临时文档以提供更明显的预览弹窗（用户更容易注意到）
    const previewLines: string[] = [];
    previewLines.push(`批量重命名预览：${name} -> ${newName}`);
    for (const [filePath, changes] of fileChanges.entries()) {
      previewLines.push('');
      previewLines.push(`File: ${vscode.workspace.asRelativePath(filePath)}`);
      for (const ch of changes) {
        previewLines.push(`Line ${ch.line + 1}:`);
        previewLines.push(`- ${ch.original}`);
        previewLines.push(`+ ${ch.modified}`);
      }
    }

    try {
      const previewDoc = await vscode.workspace.openTextDocument({ content: previewLines.join('\n'), language: 'text' });
      await vscode.window.showTextDocument(previewDoc, { preview: true, preserveFocus: false });
    } catch (e) {
      // 如果无法打开临时文档则忽略，仅使用输出通道预览
    }

    const confirm = await vscode.window.showInformationMessage('查看预览后是否应用这些更改？(预览已打开)', '应用', '取消');
    if (confirm !== '应用') { vscode.window.showInformationMessage('已取消应用更改'); return; }

    const edit = new vscode.WorkspaceEdit();
    for (const [filePath, changes] of fileChanges.entries()) {
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      for (const ch of changes) {
        const lineText = doc.lineAt(ch.line).text;
        if (lineText.indexOf(ch.original) >= 0) {
          if (lineText.trim().startsWith('[')) {
            // section replace: replace content between [ ]
            const startIdx = lineText.indexOf('[');
            const endIdx = lineText.indexOf(']');
            if (startIdx >= 0 && endIdx > startIdx) {
              const s = new vscode.Position(ch.line, startIdx + 1);
              const e = new vscode.Position(ch.line, endIdx);
              edit.replace(uri, new vscode.Range(s, e), ch.modified);
            }
          } else {
            // value replace: replace exact occurrences
            const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
            let match: RegExpExecArray | null;
            while ((match = regex.exec(lineText)) !== null) {
              const s = new vscode.Position(ch.line, match.index);
              const e = new vscode.Position(ch.line, match.index + match[0].length);
              edit.replace(uri, new vscode.Range(s, e), newName);
            }
          }
        }
      }
    }

    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) { vscode.window.showInformationMessage(`批量重命名完成：${name} -> ${newName}`); }
    else { vscode.window.showErrorMessage('应用重命名时出错'); }
  } catch (err) {
    console.error('batchRenameKeysCommand error', err);
    vscode.window.showErrorMessage(`批量重命名失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

