# RA2-INI-Assistant 代码审查与改进建议

## ✅ 已修复的问题

### 1. **命令未实现（严重）**
**问题：** package.json 中定义了 3 个命令，但代码中没有注册实现
**修复：** 已添加所有命令的实现
- `ini-ra2.checkDuplicates` - 手动检查重复配置
- `ini.reloadTranslations` - 重新加载词典
- `ini.formatDocument` - 格式化文档

### 2. **节名折叠检测问题**
**问题：** `line.endsWith("]")` 无法处理节名后有注释的情况，如 `[Section] ;注释`
**修复：** 改为 `line.includes("]")` 支持节名后的注释

### 3. **性能问题**
**问题：** 每次文档变化都全量扫描，大文件会卡顿
**修复：** 添加 500ms 防抖机制，减少不必要的检测

### 4. **格式化错误处理**
**问题：** 格式化异常会导致文档内容丢失
**修复：** 添加 try-catch 保护，失败时返回空数组保持原内容

---

## ⚠️ 仍存在的问题

### 5. **键值对中的引号未处理**
**问题：** 如 `Name="Long Name"` 格式化会去除空格变成 `Name="LongName"`
**建议：** 检测引号包裹的值，保留其中的空格
```typescript
// 改进值清理逻辑
if (value.trim().startsWith('"') && value.trim().endsWith('"')) {
  cleanValue = value.trim(); // 保留引号内的空格
} else {
  cleanValue = value.trim();
}
```

### 6. **注释中的等号误判**
**问题：** 整行注释 `;key=value` 会被当作键值对处理
**状态：** 当前已正确处理，但建议添加更多测试

### 7. **注释检测不完整**
**问题：** 只检测行首的注释符，未检测注释中的特殊字符导致的语法问题

---

## 🎯 建议添加的新功能

### 高优先级功能

#### 1. **代码补全（Auto-completion）**
为常用的键提供智能补全建议
```typescript
const completionProvider = vscode.languages.registerCompletionItemProvider('ini', {
  provideCompletionItems(document, position) {
    // 根据当前节名提供相关的键建议
    // 例如在 [Unit] 节中提供 Strength, Cost, Armor 等
  }
}, '=');
```

#### 2. **值验证（Value Validation）**
检查值的类型是否正确
```typescript
// 例如：Strength 应该是数字，布尔值应该是 yes/no
if (key === "Strength" && isNaN(Number(value))) {
  diagnostic: "Strength 的值应该是数字"
}
```

#### 3. **跳转到定义（Go to Definition）**
点击单位/武器/建筑引用时跳转到定义处
```typescript
// 例如：Primary=M60 -> 跳转到 [M60] 节
const definitionProvider = vscode.languages.registerDefinitionProvider('ini', {
  provideDefinition(document, position) {
    // 检测当前值是否是一个节名引用
    // 查找并跳转到该节
  }
});
```

#### 4. **查找所有引用（Find All References）**
查看某个节被哪些地方引用
```typescript
const referenceProvider = vscode.languages.registerReferenceProvider('ini', {
  provideReferences(document, position) {
    // 查找所有引用当前节名的位置
  }
});
```

#### 5. **文档大纲（Document Outline）**
在侧边栏显示所有节的树形结构
```typescript
const symbolProvider = vscode.languages.registerDocumentSymbolProvider('ini', {
  provideDocumentSymbols(document) {
    // 返回所有节名作为 symbols
    return sections.map(section => 
      new vscode.DocumentSymbol(
        section.name,
        section.comment || '',
        vscode.SymbolKind.Namespace,
        section.range,
        section.range
      )
    );
  }
});
```

#### 6. **快速修复（Code Actions）**
为诊断问题提供一键修复
```typescript
const codeActionProvider = vscode.languages.registerCodeActionsProvider('ini', {
  provideCodeActions(document, range, context) {
    // 例如：删除重复的键值对
    // 修正缺少等号的行
  }
});
```

### 中优先级功能

#### 7. **颜色预览（Color Decorator）**
为颜色值显示颜色预览
```typescript
// 例如：Color=255,128,0 显示橙色方块
const colorProvider = vscode.languages.registerColorProvider('ini', {
  provideDocumentColors(document) {
    // 识别 R,G,B 格式的颜色值
  }
});
```

#### 8. **节模板（Snippets Enhancement）**
提供常用节的完整模板
```json
{
  "Unit Template": {
    "prefix": "unit",
    "body": [
      "[${1:UnitID}]",
      "Name=${2:Unit Name}",
      "Strength=${3:1000}",
      "Cost=${4:1000}",
      "Armor=${5:heavy}",
      "$0"
    ]
  }
}
```

#### 9. **实时语法检查增强**
- 检测无效的布尔值（非 yes/no/true/false）
- 检测超出范围的数值
- 检测引用不存在的节名

#### 10. **配置项（Settings）**
让用户自定义格式化行为
```json
{
  "ini-ra2.formatting.maxEmptyLines": 2,
  "ini-ra2.formatting.commentIndent": 0,
  "ini-ra2.formatting.sortKeys": true,
  "ini-ra2.validation.checkReferences": true,
  "ini-ra2.completion.enabled": true
}
```

### 低优先级功能

#### 11. **批量重命名（Rename）**
重命名节名时自动更新所有引用

#### 12. **INI 文件比较工具**
比较两个 INI 文件的差异，高亮不同的配置

#### 13. **导出/导入功能**
将 INI 配置导出为 JSON，或从 JSON 导入

#### 14. **统计信息面板**
显示文件统计：节数量、键值对数量、注释行数等

#### 15. **代码折叠增强**
支持更多折叠类型：
- 折叠注释块
- 折叠特定键类型（如所有 += 行）

---

## 🔧 代码质量改进建议

### 1. **模块化**
将不同功能拆分到独立文件
```
src/
  ├── extension.ts          # 主入口
  ├── providers/
  │   ├── hover.ts         # 悬浮提示
  │   ├── formatting.ts    # 格式化
  │   ├── folding.ts       # 折叠
  │   └── diagnostics.ts   # 诊断
  ├── utils/
  │   ├── parser.ts        # INI 解析器
  │   └── validator.ts     # 验证器
  └── types.ts             # 类型定义
```

### 2. **单元测试**
为关键函数添加测试
```typescript
suite('INI Formatter', () => {
  test('should handle section with comment', () => {
    const input = '[Section] ;comment';
    const output = format(input);
    assert.equal(output, '[Section] ;comment');
  });
});
```

### 3. **性能监控**
添加性能日志，监控慢操作
```typescript
const startTime = Date.now();
checkDuplicateDefinitions(document);
const elapsed = Date.now() - startTime;
if (elapsed > 1000) {
  outputChannel.appendLine(`检测耗时: ${elapsed}ms`);
}
```

### 4. **更好的错误提示**
为用户提供更友好的错误信息和修复建议

### 5. **国际化（i18n）**
支持多语言，至少英文和中文

---

## 📝 建议实现顺序

1. ✅ 修复已知 Bug（已完成）
2. 🔥 添加代码补全功能（最实用）
3. 🔥 添加跳转到定义功能
4. 🔥 添加值验证功能
5. 📋 添加文档大纲功能
6. 🎨 添加快速修复功能
7. 🎨 添加配置项
8. 📊 代码重构和模块化
9. 🧪 添加单元测试
10. 🌐 其他辅助功能

---

## 🚀 快速开始

已修复的问题会在下次编译后生效：

```bash
npm run compile
# 或者
npm run watch  # 自动监听变化
```

按 F5 启动调试查看效果。
