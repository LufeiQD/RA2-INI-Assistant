# RA2 INI Assistant

> 红警2 INI 文件编辑辅助插件 - 为红警2地图作者和MOD制作者提供专业的INI配置文件编辑支持

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![VSCode](https://img.shields.io/badge/VSCode-1.106.0+-green)
![License](https://img.shields.io/badge/license-MIT-orange)

## 📖 简介

RA2 INI Assistant 是一款专为《命令与征服：红色警戒2》及其资料片《尤里的复仇》设计的 VSCode 扩展插件。本插件旨在帮助地图作者和MOD制作者更高效、更准确地编辑 INI 配置文件，提供智能提示、语法检查、跨文件导航、动态类型推断等功能。

**作者**: 橙猫猫三天睡不着 (QQ: 183354595)

**GitHub**: [RA2-INI-Assistant](https://github.com/LufeiQD/RA2-INI-Assistant)

## ✨ 主要功能

### 1. 🎯 智能代码补全
- 输入键名时自动提供中文说明和补全建议
- **类型感知**: 根据当前节的类型自动推荐相关键名
- 优先显示特定类型的键，其次显示通用键
- 支持常用的红警2配置键（如 `Image`、`Damage`、`ROF` 等）
- 显示详细的配置说明文档
- 快速触发：按 `=` 或 `Ctrl+Space` 即可显示

### 2. 🔍 跨文件引用查找与导航
- **跳转到定义**: `Ctrl+Click` 节名快速跳转到其定义位置
- **查找所有引用**: `Shift+F12` 查看某个节名在哪些地方被引用
- **跨文件支持**: 支持在多个INI文件间查找引用关系（如 rulesmd.ini、artmd.ini 等）
- **智能白名单**: 可配置相关文件列表，避免索引无关文件
- **可视化下划线**: 可跳转的节名引用自动显示下划线提示

### 3. 💡 增强悬浮提示 (Hover)
悬浮在代码上即可查看详细信息：

**悬浮在键名上**:
- 键的中文名称和说明
- 当前所在节的类型和名称
- 键的当前值
- 布尔值的含义说明

**悬浮在节名上**:
- 节的详细描述
- 在其他文件中的定义位置和行号
- 在当前文件中被引用的位置（最多显示10个）
- 在其他文件中被引用的位置（最多显示5个）
- 智能定位节在哪些键值中被引用

### 4. 🔗 动态类型推断
- **自动推断**: 根据节名在注册列表中的位置自动推断节的类型
- **引用关系推断**: 通过其他文件中的引用关系反向推断节的类型
- **链式查询**: 支持多层级的类型引用查询
- **优先级机制**: 注册列表优先于引用关系推断
- **翻译智能匹配**: 在补全和悬浮提示中显示对应类型的翻译

### 5. 🔧 智能语法检查与诊断
- **重复定义检测**: 自动检测同一节内的重复键名（不区分大小写）
  - 检测到重复时显示警告（黄色波浪线）
  - 显示所有重复位置的行号
  
- **语法错误检测**: 
  - 检测缺失等号的配置项
  - 检测 `+=` 操作符使用错误
  - 检测空值问题
  - 检测类型不匹配的警告
  
- **实时诊断**: 
  - 文档变化时自动检测（500ms防抖）
  - 保存文件时立即检测
  - 打开文件时自动扫描

### 6. 📝 智能代码格式化
- **自动格式化**: `Shift+Alt+F` 一键格式化INI文件
- **数字键排序**: 对数字键（如 `1=`、`2=`、`123=`）按升序排列
- **非数字键保留**: 其他键（如 `Name=`、`Primary=`）保持原有顺序
- **+=操作符支持**: 正确识别和排序 `+=` 追加操作符
- **节间距控制**: 可配置节之间的空行数量（0-50行）
- **注释保留**: 自动对齐注释，保留用户的注释结构
- **跨行节名处理**: 正确处理跨多行的节名定义

### 7. 📂 代码折叠与快速定位
- **节级折叠**: 支持按节名折叠整个代码块
- **快速定位**: 在大型配置文件中快速导航到目标节
- **结构视图**: 在VS Code大纲中显示所有节名

### 8. 🔤 中文代码片段 (Snippets)
- **完整的红警2单位/建筑配置模板**: 内置272+个代码片段，涵盖所有原版单位、建筑、武器等
- **多语言触发支持**: 支持英文代码、中文名称、拼音全称和拼音首字母缩写
  - 英文代码: `e1` → 自动提示 E1 美国大兵完整配置
  - 拼音全称: `meiguo` 或 `meiguodabing` → 自动提示 E1 美国大兵配置
  - 拼音缩写: `mg` 或 `mgdb` → 自动提示 E1 美国大兵配置
  - 中文名称: `美国` 或 `大兵` → 自动提示 E1（功能做了但是vscode本身目前似乎不支持）
- **完整配置模板**: 包含所有原版 INI 配置项，无需手动查阅文档
- **一键插入**: 选择代码片段后自动插入完整的节配置，快速创建新单位
- **自动扩展**: 在任何 INI 文件中输入触发词后按 `Tab` 或 `Enter` 即可插入

### 9. 🎨 彩色作用域装饰
- **彩虹色背景**: 每个 INI 节用不同颜色的淡色背景高亮显示
- **视觉分层**: 15 种彩虹色循环使用，清晰区分不同的代码块
- **概览标尺**: 右侧滚动条显示色块，快速定位和导航到不同节
- **用户可控**: 通过配置项 `ini-ra2.enableScopeDecorations` 启用/禁用
- **淡色设计**: 采用低不透明度背景，不影响代码可读性

**使用示例**:
```ini
; 输入"美国"然后按Tab，自动展开为：
[E1]
UIName=Name:E1 ; 游戏中显示的名称
Name=E1 ; 内部使用的名称
Image=E1 ; 使用的图像
Category=Soldier ; 单位类别
Primary=M60 ; 主武器
... (完整配置)
```

## 🚀 快速开始

### 安装

1. 打开 VSCode
2. 按 `Ctrl+Shift+X` 打开扩展面板
3. 搜索 "RA2 INI Assistant"
4. 点击安装

### 基本使用

1. **打开INI文件**: 打开任何 `.ini` 文件即可自动激活插件
2. **代码补全**: 
   - 输入键名时按 `=` 自动触发
   - 或按 `Ctrl+Space/Enter` 手动触发
3. **代码片段**: 
   - 输入英文代码（如 `e1`）或中文关键词（如 `美国`、`大兵`）
   - 按 `Tab` 或 `Enter` 插入完整配置模板
4. **跳转定义**: 按住 `Ctrl` 并点击节名引用，或按 `Ctrl+点击`
5. **查找引用**: 
   - 右键节名 → 选择"查找所有引用"
   - 或按 `Shift+F12`
6. **查看提示**: 将鼠标悬停在键名或节名上即可显示详细信息
7. **格式化文档**: 按 `Shift+Alt+F` 格式化当前文件

## 🚀 快速开始

### 安装

1. 打开 VSCode
2. 按 `Ctrl+Shift+X` 打开扩展面板
3. 搜索 "RA2-INI-Assistant"
4. 点击安装

### 基本使用

1. **打开INI文件**: 打开任何 `.ini` 文件即可自动激活插件
2. **代码补全**: 输入键名时按 `Ctrl+Space/Enter` 或直接输入触发补全
3. **跳转定义**: 按住 `Ctrl` 并点击节名引用
4. **查找引用**: 右键节名 → 选择"查找所有引用"或按 `Shift+F12`
5. **查看提示**: 将鼠标悬停在键名或节名上

## ⚙️ 配置选项

在 VSCode 设置中搜索 `ini-ra2` 可找到以下配置：

```json
{
  // 是否显示可跳转值的下划线
  "ini-ra2.enableLinkUnderline": true,
  
  // 节之间的最大空行数（格式化时使用）
  "ini-ra2.maxEmptyLinesBetweenSections": 2,
  
  // 是否启用跨文件搜索和类型推断
  "ini-ra2.enableMultiFileSearch": true,
  
  // 相关文件白名单（支持通配符 *）
  "ini-ra2.relatedFiles": [
    "rulesmd.ini",
    "artmd.ini",
    "soundmd.ini",
    "aimd.ini",
    "rules.ini",
    "art.ini",
    "sound.ini",
    "ai.ini"
  ],
  
  // 索引文件的最大大小限制（MB）
  "ini-ra2.maxFileSize": 5,
  
  // 是否启用彩色作用域装饰（为每个节块显示淡色背景）
  "ini-ra2.enableScopeDecorations": true
}
```

### 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enableLinkUnderline` | boolean | `true` | 控制是否为可跳转的节名引用显示下划线 |
| `maxEmptyLinesBetweenSections` | number | `2` | 格式化文档时，节与节之间保留的空行数（0-50） |
| `enableMultiFileSearch` | boolean | `true` | 是否启用跨文件引用查找和类型推断 |
| `relatedFiles` | array | 见上 | 白名单文件列表，只有这些文件会被索引用于跨文件查找。当前打开的文件总是会被索引，不受白名单限制。支持通配符，如 `"*md.ini"` 匹配所有以md.ini结尾的文件 |
| `maxFileSize` | number | `5` | 超过此大小的文件将被跳过索引，避免性能问题（MB） |
| `enableScopeDecorations` | boolean | `true` | 启用彩色作用域装饰，为每个节块显示淡色背景，按彩虹色区分不同节，帮助识别代码结构 |

## 📋 可用命令

按 `Ctrl+Shift+P` 打开命令面板，可使用以下命令：

| 命令 | 说明 | 快捷键 |
|------|------|--------|
| `INI: 检查重复配置` | 手动触发重复定义检查 | - |
| `INI: 重新加载词典` | 重新加载翻译词典文件 | - |
| `INI: 格式化文档` | 格式化当前INI文件 | `Shift+Alt+F` |
| `INI: 重建文件索引` | 重新索引工作区的INI文件 | - |

## 💡 使用技巧

### 代码片段
- **快速创建单位**: 输入关键词触发代码片段
- **多种触发方式**: 
  - 英文代码: `e1` → E1 美国大兵配置
  - 拼音全称: `meiguo` 或 `meiguodabing` → E1
  - 拼音缩写: `mg` 或 `mgdb` → E1
  - 中文分词: `美国` 或 `大兵` 或 `美国大兵` → E1（可能需要设置 VSCode 拼音搜索扩展）
- **自动提示**: 输入时会自动显示匹配的代码片段，无需记忆具体代码
- **Tab键快速插入**: 选中代码片段后按 `Tab` 键立即插入完整配置
- **272+ 内置模板**: 包含所有原版RA2单位、建筑、武器的完整配置节点

### 代码补全
- 输入键名时自动显示补全（触发符：`=`）
- 按 `Ctrl+Space` 手动打开补全列表
- 类型感知：会优先显示当前节类型相关的键

### 类型推断
当你添加了一个新节时，插件会自动推断其类型：

```ini
; 直接引用 - 自动推断为 weapon 类型
[wuqi]
Image=WUQI

; 在注册列表中 - 自动推断为 infantry 类型
[InfantryTypes]
SHK=1
DEF=2
```

### 跨文件导航
- 在 rulesmd.ini 中：`Primary=wuqi` 
- 按 `Ctrl+Click` 跳转到 artmd.ini 中的 `[wuqi]` 节
- 自动处理文件切换和位置导航

## ⚠️ 注意事项

### 性能优化
1. **大文件处理**: 默认跳过超过5MB的文件，可通过 `maxFileSize` 配置调整
2. **批量索引**: 初次打开工作区时会批量索引文件（每批10个），可能需要几秒钟
3. **防抖机制**: 文档变化检测使用500ms防抖，避免频繁触发

### 白名单配置
- 如果你的项目有特殊命名的INI文件，请将其添加到 `relatedFiles` 白名单
- 当前打开的文件始终会被索引，即使不在白名单中
- 合理配置白名单可以避免索引无关文件，提升性能

### 词典限制
- 内置词典基于红警2原版和尤里的复仇
- 部分MOD专用键可能没有收录
- 如发现词典遗漏或错误，欢迎反馈

### 语法检测限制
- 重复定义检测会跳过某些常用键（如 `UIName`、`Name` 等）
- `+=` 追加操作符的检测可能不适用于某些特殊MOD语法

## 🐛 已知问题及限制

1. **跨行节名**: 跨行的节名定义在某些情况下识别可能不完整
2. **特殊字符**: 包含特殊字符的节名可能导致跳转异常
3. **超大文件**: 超过10MB的文件可能导致性能下降（默认跳过5MB以上文件）
4. **词典完整性**: 部分MOD专用键可能没有收录（欢迎提交补充）

## 📦 版本历史

### 1.0.0 (2025-12-20) - 首个正式版本

**✨ 核心功能**:
- ✅ 智能代码补全（中文说明和类型感知）
- ✅ 中文代码片段支持（272+个单位/建筑模板，支持中文关键词触发）
- ✅ 跨文件引用查找和导航
- ✅ 增强悬浮提示（键名、节名、引用位置）
- ✅ 动态类型推断（通过注册列表和引用关系）
- ✅ 智能语法检查和诊断
- ✅ 代码格式化（含数字键排序）
- ✅ 代码折叠和结构导航
- ✅ 白名单过滤机制
- ✅ 代码模块化架构

**🔧 改进**:
- 优化了类型推断引擎
- 改进了数字键排序逻辑
- 增强了跨文件索引性能
- 完善了错误处理和日志输出

**📚 文档**:
- 完整的README使用指南
- 详细的配置选项说明
- 技巧和最佳实践指南

## 🤝 贡献指南

欢迎提交问题、建议和代码贡献！

### 反馈渠道
- **GitHub Issues**: [RA2-INI-Assistant/issues](https://github.com/LufeiQD/RA2-INI-Assistant/issues)
- **QQ**: 183354595（橙猫猫三天睡不着）
- **战网作者群**: 374576960

### 词典贡献
如果你发现词典有遗漏或错误：
1. 准备好键名、说明文档和所属类型
2. 联系作者或提交 PR 修改 `src/assets/translations.json`
3. 在 issue 中反馈需要添加的词条

### 开发贡献
1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 📄 开源声明

### 许可证

本项目采用 **MIT License** 开源协议。详见 [LICENSE](./LICENSE) 文件。

```
MIT License

Copyright (c) 2025 橙猫猫三天睡不着

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 免责声明

1. **非官方工具**: 本插件为第三方开发的辅助工具，与游戏官方无关
2. **使用风险**: 使用本插件产生的任何问题由用户自行承担
3. **功能限制**: 本插件为编辑辅助工具，不能替代游戏的实际验证
4. **词典准确性**: 内置词典仅供参考，具体词典请以(https://modenc.renegadeprojects.com/)为准
5. **更新维护**: 作者将尽力维护更新，但不保证持续性支持
6. **内容声明**: 
   - 本项目文档由人工编写和 AI 辅助修改生成
   - 可能存在错漏，欢迎提出改进建议
   - 代码扫描和规范优化由 AI 进行处理

### 致谢

感谢以下项目和个人的支持：

- **红警2社区**: 感谢所有大佬提供的词典支持 （词典引用：20190201 by紫色放逐）
- **VSCode 团队**: 感谢提供优秀的扩展开发平台
- **TypeScript 社区**: 感谢提供强大的类型系统支持
- **所有贡献者**: 感谢所有提供反馈和改进建议的用户

## 📞 联系方式

- **作者**: 橙猫猫三天睡不着
- **QQ**: 183354595
- **GitHub**: [@LufeiQD](https://github.com/LufeiQD)
- **GitHub Issue**: [提交问题](https://github.com/LufeiQD/RA2-INI-Assistant/issues)

## 🎮 相关资源

- [ModEnc - 红警2 MOD 百科](http://modenc.renegadeprojects.com/)
- [ra2diy - 红警2Diy社区](https://bbs.ra2diy.com/)

---

**如果这个插件对你有帮助，欢迎：**
- ⭐ Star 本项目
- 📝 在其他平台推荐
- 🔗 分享给其他红警2爱好者
- 💬 提供反馈和建议

*本插件为简易辅助工具，仅作配置文件编辑使用。如有问题请联系作者反馈。*
