# 发版步骤和部署指南

## 🚀 快速发版指南

### 前置条件
- Node.js >= 14
- npm >= 6
- git
- vsce (VS Code Extension CLI)

### 安装 vsce
```bash
npm install -g vsce
```

### 本地测试

```bash
# 1. 检查代码质量
npm run lint

# 2. 编译代码
npm run compile

# 3. 生成生产包
npm run package

# 4. 打包扩展
vsce package
```

### 发版步骤

#### 步骤 1: 版本控制
```bash
# 确保所有文件已提交
git status

# 创建版本标签
git tag -a v1.0.0 -m "RA2 INI Assistant 1.0.0 - Initial Release"

# 推送标签
git push origin v1.0.0
```

#### 步骤 2: 打包扩展
```bash
# 清理旧包
rm -f *.vsix

# 打包新版本
vsce package 1.0.0

# 验证包
ls -lh *.vsix
```

#### 步骤 3: 发布到 VS Code 市场

**方式 A: 命令行发布（需要 PAT 令牌）**
```bash
vsce publish 1.0.0
```

**方式 B: Web 界面手动上传**
1. 登录 https://marketplace.visualstudio.com/
2. 点击 "Create Publisher" 或使用现有发布者
3. 上传 .vsix 文件
4. 填充发布信息

#### 步骤 4: 创建 GitHub Release
```bash
# 如果使用 GitHub CLI
gh release create v1.0.0 \
  --title "RA2 INI Assistant 1.0.0" \
  --notes-file CHANGELOG.md \
  *.vsix
```

或在 GitHub Web 界面：
1. 点击 "Releases" → "Create a new release"
2. 选择标签 `v1.0.0`
3. 标题：`RA2 INI Assistant 1.0.0`
4. 描述：粘贴 CHANGELOG.md 内容
5. 上传 .vsix 文件
6. 发布

### 发布后检查

```bash
# 1. 验证发布成功（需要等待 5-10 分钟）
vsce show LufeiQD.ra2-ini-assistant

# 2. 在 VS Code 中搜索更新
# 打开扩展面板，搜索 "RA2 INI Assistant"
# 应该能看到 1.0.0 版本可用

# 3. 验证 GitHub Release
# https://github.com/LufeiQD/RA2-INI-Assistant/releases/tag/v1.0.0
```

## 📋 发版前检查清单

### 代码质量
- [ ] `npm run lint` 通过（0 errors）
- [ ] `npm run compile` 无警告
- [ ] `npm run package` 生产编译成功
- [ ] 所有调试代码已移除（无 console.log）
- [ ] 没有未提交的更改

### 文档
- [ ] README.md 已更新为最新版本
- [ ] CHANGELOG.md 已更新
- [ ] package.json 版本号正确（1.0.0）
- [ ] 所有文档格式正确

### 功能
- [ ] 所有 8 个功能都能正常工作
- [ ] 命令列表完整
- [ ] 配置选项都有说明
- [ ] 已知问题都有注明

### 元数据
- [ ] publisher 字段已设置
- [ ] repository 信息完整
- [ ] license 字段为 MIT
- [ ] keywords 有至少 5 个关键词
- [ ] categories 包含 "Programming Languages"

## 🔄 版本更新流程

### 小版本更新（如 1.0.1）
1. 修复 bug 和提交
2. 更新 CHANGELOG.md（添加 [1.0.1] 部分）
3. 更新 package.json 版本号
4. 按照发版步骤 1-4 操作

### 功能版本更新（如 1.1.0）
1. 开发新功能
2. 更新 README.md（描述新功能）
3. 更新 CHANGELOG.md
4. 按照发版步骤 1-4 操作

### 主版本更新（如 2.0.0）
1. 大量功能重构或 API 破坏性更改
2. 更新 CHANGELOG.md（说明重大变化）
3. 更新所有文档
4. 考虑向现有用户提供迁移指南

## 📢 发版公告模板

### QQ 群公告
```
🎉 RA2 INI Assistant 1.0.0 正式发布！

✨ 功能包括：
✅ 智能代码补全（中文说明）
✅ 跨文件引用导航
✅ 增强悬浮提示
✅ 动态类型推断
✅ 智能语法检查
✅ 代码格式化
✅ 代码折叠

🚀 安装方式：
1. 打开 VS Code
2. 按 Ctrl+Shift+X 打开扩展
3. 搜索 "RA2 INI Assistant"
4. 点击安装

📖 详见：https://github.com/LufeiQD/RA2-INI-Assistant

作者：橙猫猫三天睡不着
联系：QQ 183354595
```

### GitHub 发布描述
```markdown
# RA2 INI Assistant 1.0.0

这是首个正式版本，包含所有核心功能：

## ✨ 新增功能

[从 CHANGELOG.md 复制]

## 📥 安装

https://marketplace.visualstudio.com/items?itemName=LufeiQD.ra2-ini-assistant

## 📖 文档

https://github.com/LufeiQD/RA2-INI-Assistant#readme

## 🐛 反馈

欢迎提交 Issue 或 Pull Request！

---

感谢使用 RA2 INI Assistant！
```

## ⚠️ 常见问题

### Q: 发布后多久能在市场上看到？
A: 通常需要 5-10 分钟，有时可能需要 24 小时进行审核。

### Q: 发布失败怎么办？
A: 
1. 检查 package.json 版本号是否与标签一致
2. 确保发布者信息正确
3. 查看错误信息，通常是格式或配置问题
4. 参考 vsce 官方文档：https://github.com/microsoft/vscode-vsce

### Q: 如何撤回发布？
A: 
```bash
vsce unpublish LufeiQD.ra2-ini-assistant@1.0.0
```
或在市场网站上操作。

### Q: 如何更新已发布版本？
A: 不能覆盖现有版本，必须发布新版本号。可以：
1. 立即发布 1.0.1 补丁版
2. 撤回 1.0.0 然后发布新版本

## 📊 发布后监控

### 监控指标
- 下载数量
- 用户评分
- 用户反馈/Issue
- 错误报告

### 反馈收集
- [ ] 设置 GitHub Issues 模板
- [ ] 建立反馈渠道（QQ、GitHub、邮件）
- [ ] 定期检查用户报告的 bug
- [ ] 收集功能请求

### 后续维护计划
- 周期性检查和回复 Issue
- 定期发布补丁版本
- 每月评估功能请求
- 季度更新计划

---

**祝发版顺利！🎉**
