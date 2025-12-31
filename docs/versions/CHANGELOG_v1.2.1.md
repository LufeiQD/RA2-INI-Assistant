````markdown
# RA2 INI Assistant v1.2.1 更新日志

> 发布日期：2026年1月1日

## ✨ 新增功能

### 1. 🔗 引用跳转与预览开关

为用户提供灵活的引用导航方式选择。

#### 功能说明
- **启用模式**（`enableJumpToDefinition: true`）：`Ctrl+Click` 直接跳转到节的定义位置
- **预览模式**（`enableJumpToDefinition: false`）：`Ctrl+Click` 弹出预览窗口，无需离开当前位置

#### 配置
```json
{
  "ini-ra2.enableJumpToDefinition": true  // 默认启用
}
```

#### 应用场景
- **启用**: 需要快速定位到其他位置编辑的场景
- **禁用**: 只需快速查看引用内容，不需要实际修改的场景

#### 跨文件支持
- 支持在 rulesmd.ini、artmd.ini 等多文件间进行跳转和预览
- 自动遵循 `enableMultiFileSearch` 配置，在白名单文件中查找

---

### 2. 🍞 面包屑导航功能

在 VS Code 面包屑中显示 INI 文件的所有节名，支持同行注释展示。

#### 功能说明
- **节名列表**：在顶部面包屑下拉菜单中显示所有 `[Section]` 名称
- **快速导航**：点击节名可立即跳转到该节的定义位置
- **图标标识**：使用数组（Array）图标标识节结构
- **注释展示**：自动提取节名后的同行注释，在面包屑 detail 字段显示
  - 示例：`[General] ;全局配置` 会在面包屑中显示注释"全局配置"
  - 长注释自动截断：超过 50 字符时显示"...省略号"

#### 示例
```ini
[General] ;全局配置
Image=test

[Infantry] ;步兵配置注释说明信息
Name=步兵
```

面包屑显示：
- General (detail: "全局配置")
- Infantry (detail: "步兵配置注释说明信息...")

---

### 3. 📚 词典补充

补充遗漏的注册表节名和相关配置项。

#### 新增词条
- **国家配置**：British、Germans、French、Alliance、Africans、Yuri、Russians、Confederation、Arabs、Americans
- **特殊配置**：IQ、CrateRules、CombatDamage、General、MultiplayerDialogSettings、AI、ShieldTypes

#### 应用
- 补全系统识别更多节名
- 诊断系统正确排除新增的注册表节
- 类型推断功能识别新节的类型

---

## 🔧 优化

### 1. 统计功能增强
- **重复节检测**：检测 INI 文件中重复定义的节名（区分大小写）
- **重复统计**：显示重复节的名称和出现位置行号
- **统计命令**：`INI: 显示统计信息` 命令输出更详细的重复信息
- **诊断提示**：重复节显示警告诊断，便于快速定位问题

### 2. 诊断精准性改进
- **布尔值与浮点值处理**：不再对布尔值（`yes`、`no`）和浮点值（`0.5`、`1.2`）报警
  - 修复：`ArmorType=yes` 不再显示"未定义的节引用"警告
  - 修复：`Damage=0.5` 不再显示"未定义的节引用"警告
- **注册表键值过滤**：只检查注册表节中的键是否指向有效节名
  - 防止普通配置值被误判为节名引用

### 3. 悬浮提示优化
- **空引用提示开关**：新增 `showEmptyReferenceHint` 配置项
- **功能**：控制是否在悬浮窗口显示"未找到引用"提示文案
- **配置**：
  ```json
  {
    "ini-ra2.showEmptyReferenceHint": true  // 默认启用
  }
  ```
- **应用**：
  - 启用（true）：显示"未找到引用"信息，提示用户该节未被引用
  - 禁用（false）：悬浮窗口仅显示节的描述和其他信息，更加简洁

#### 示例对比
```
启用状态 (showEmptyReferenceHint: true):
━━━━━━━━━━━━━━━━━━
类型：步兵
描述：基础步兵单位
引用情况：未找到引用
━━━━━━━━━━━━━━━━━━

禁用状态 (showEmptyReferenceHint: false):
━━━━━━━━━━━━━━━━━━
类型：步兵
描述：基础步兵单位
━━━━━━━━━━━━━━━━━━
```

---

## 🐛 Bug 修复

| 问题 | 描述 | 状态 |
|------|------|------|
| 布尔值误报 | `ArmorType=yes` 被误判为节名引用 | ✅ 已修复 |
| 浮点值误报 | `Damage=0.5` 被误判为节名引用 | ✅ 已修复 |
| 注册表误报 | 普通值被误判为节名引用 | ✅ 已修复 |
| 面包屑类型标签 | 显示"（数组）"标签不够直观 | ✅ 已优化 |
| 空悬浮提示 | 无引用时显示文案过长 | ✅ 已优化 |

---

## 📝 配置项汇总

本版本涉及的所有配置项：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enableJumpToDefinition` | boolean | true | 启用直接跳转；禁用时使用预览 |
| `enableMultiFileSearch` | boolean | true | 启用跨文件搜索 |
| `showEmptyReferenceHint` | boolean | true | 显示"未找到引用"提示文案 |
| `enableLinkUnderline` | boolean | true | 为可跳转的节名显示下划线 |
| `enableScopeDecorations` | boolean | true | 显示彩色作用域装饰 |
| `maxEmptyLinesBetweenSections` | number | 1 | 节间最多空行数 |
| `maxFileSize` | string | "5MB" | 单文件大小限制 |
| `relatedFiles` | array | 见文档 | 关联文件白名单 |

---

## 🎨 用户体验改进

### 1. 界面优化
- 面包屑导航显示更清晰的节结构
- 注释提示更加简洁可控
- 跳转和预览模式对应的提示文本更明确

### 2. 文档提示改进
- 悬浮提示可通过配置控制详度
- 诊断提示更加准确，减少误报
- 错误信息更容易理解

### 3. 性能稳定性
- 诊断检测更高效，避免不必要的重复计算
- 统计功能性能优化，处理大文件更快速

---

## 🔄 升级建议

**推荐所有 v1.2.0 用户升级** 以获得以下优势：
- ✅ 更准确的错误诊断
- ✅ 更灵活的导航模式选择
- ✅ 更完善的词典数据
- ✅ 更简洁可控的悬浮提示

### 升级检查清单
- [ ] 更新扩展到最新版本
- [ ] 检查新增配置项是否需要调整（特别是 `showEmptyReferenceHint`）
- [ ] 清除缓存：执行命令 "INI: 重建文件索引"
- [ ] 测试面包屑导航和引用跳转功能

---

## 📞 反馈与支持

如在使用中发现任何问题或有改进建议，欢迎通过以下方式联系：
- GitHub Issues: [RA2-INI-Assistant](https://github.com/LufeiQD/RA2-INI-Assistant/issues)
- 作者 QQ：183354595

---

**版本基线**：v1.2.0 → v1.2.1
**发布日期**：2026年1月1日
**推荐升级**：是

````
