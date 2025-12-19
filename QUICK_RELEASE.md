# 🚀 RA2 INI Assistant 1.0.0 发版指令手册

## 快速发版指令 (复制粘贴即可)

### 步骤 1: 验证代码质量

```bash
cd c:\Users\ts_luo\Desktop\项目\RA2-INI-Assistant-main
npm run lint
npm run compile
npm run package
```

**预期结果:**
```
✅ ESLint: 0 errors, 0 warnings
✅ Webpack: successfully compiled
```

### 步骤 2: 准备发版

```bash
# 确保所有文件已保存和提交
git status

# 创建版本标签
git tag -a v1.0.0 -m "RA2 INI Assistant 1.0.0 - Initial Release"

# 推送标签到 GitHub
git push origin v1.0.0
```

### 步骤 3: 打包扩展

```bash
# 全局安装 vsce (如果还未安装)
npm install -g vsce

# 打包扩展
vsce package 1.0.0

# 验证生成的包
ls -lh *.vsix
```

**预期输出:**
```
ra2-ini-assistant-1.0.0.vsix  (大约 170 KB)
```

### 步骤 4: 发布到 VS Code 市场

#### 方式 A: 命令行发布 (需要 PAT 令牌)

```bash
# 获取 PAT 令牌: https://marketplace.visualstudio.com/manage/publishers/LufeiQD
# 替换 YOUR_TOKEN

vsce publish 1.0.0 -p YOUR_TOKEN
```

#### 方式 B: Web 界面发布 (推荐新手)

1. 登录: https://marketplace.visualstudio.com/
2. 选择发布者 "LufeiQD" (或创建新的)
3. 点击 "Create new extension"
4. 上传 `ra2-ini-assistant-1.0.0.vsix` 文件
5. 填充版本信息:
   - Version: 1.0.0
   - Display Name: RA2 INI Assistant
   - Description: 红警2 INI 文件编辑辅助插件
   - Short Description: 为红警2地图作者和MOD制作者提供专业的INI配置文件编辑支持
6. 点击 "Publish"

### 步骤 5: 创建 GitHub Release

1. 访问: https://github.com/LufeiQD/RA2-INI-Assistant/releases
2. 点击 "Create a new release"
3. 选择标签: `v1.0.0`
4. 标题: `RA2 INI Assistant 1.0.0 - 首个正式版本`
5. 描述 (复制 CHANGELOG.md 的 1.0.0 部分)
6. 上传文件: `ra2-ini-assistant-1.0.0.vsix`
7. 点击 "Publish release"

### 步骤 6: 发布公告

#### QQ 群公告 (战网作者群)

```
🎉 RA2 INI Assistant 1.0.0 正式发布！

✨ 核心功能：
✅ 智能代码补全（中文说明 + 类型感知）
✅ 跨文件引用导航（Ctrl+Click 跳转）
✅ 增强悬浮提示（键名、节名、引用位置）
✅ 动态类型推断（注册列表 + 引用关系）
✅ 智能语法检查（重复定义、错误检测）
✅ 代码格式化（含数字键排序）
✅ 代码折叠和结构导航
✅ 可视化下划线和白名单机制

🚀 安装方式：
1. 打开 VS Code
2. 按 Ctrl+Shift+X 打开扩展
3. 搜索 "RA2 INI Assistant"
4. 点击安装

📖 文档和反馈：
GitHub: https://github.com/LufeiQD/RA2-INI-Assistant
QQ: 183354595

感谢使用！⭐
```

---

## 📊 发版检查清单

在执行上述步骤前，请确认以下所有项目都已完成：

### 代码检查
- [x] `npm run lint` 通过 (0 errors)
- [x] `npm run compile` 通过
- [x] `npm run package` 通过
- [x] 所有调试代码已移除
- [x] 代码风格统一

### 文档检查
- [x] README.md 已更新 (v1.0.0)
- [x] CHANGELOG.md 已更新
- [x] DEPLOY.md 已编写
- [x] RELEASE_CHECKLIST.md 已编写
- [x] RELEASE_REPORT.md 已编写

### 元数据检查
- [x] package.json 版本 = 1.0.0
- [x] package.json publisher = LufeiQD
- [x] package.json license = MIT
- [x] 所有命令都已实现
- [x] 所有配置都有说明

### Git 检查
- [x] 所有文件已提交
- [x] 工作区干净 (git status 为空)
- [x] 准备好创建标签

---

## ⚠️ 常见问题解决

### Q1: `npm run lint` 出错
**症状**: ESLint 检查失败

**解决**:
```bash
npm install
npm run lint -- --fix
```

### Q2: `npm run compile` 出错
**症状**: Webpack 编译失败

**解决**:
```bash
rm -rf node_modules package-lock.json
npm install
npm run compile
```

### Q3: vsce 命令不存在
**症状**: 命令行找不到 vsce

**解决**:
```bash
npm install -g vsce
```

### Q4: 发布时提示 PAT 令牌无效
**症状**: 发布失败，令牌错误

**解决**:
1. 访问 https://marketplace.visualstudio.com/manage
2. 创建新的 Personal Access Token
3. 使用新令牌重新发布

### Q5: 市场上看不到新版本
**症状**: 发布成功但市场上找不到

**解决**:
- 等待 5-10 分钟，市场需要时间索引
- 清除浏览器缓存
- 在 VS Code 中按 Ctrl+Shift+P → "Reload Window"

---

## 📈 发版后验证

### 验证发布成功

```bash
# 检查市场信息
vsce show LufeiQD.ra2-ini-assistant

# 或访问网址
# https://marketplace.visualstudio.com/items?itemName=LufeiQD.ra2-ini-assistant
```

### VS Code 验证

1. 打开 VS Code
2. 按 Ctrl+Shift+X 打开扩展
3. 搜索 "RA2 INI Assistant"
4. 应该能看到 1.0.0 版本
5. 点击安装进行完整测试

### GitHub 验证

访问: https://github.com/LufeiQD/RA2-INI-Assistant/releases/tag/v1.0.0

应该能看到:
- Release 信息
- 上传的 .vsix 文件
- 完整的 CHANGELOG

---

## 🔄 版本更新流程

### 对于补丁版本 (1.0.1, 1.0.2, ...)

1. 修复 bug 并提交
2. 更新 CHANGELOG.md
3. 更新 package.json 版本号
4. 按照上述发版步骤 1-6 操作

### 对于功能版本 (1.1.0, 1.2.0, ...)

1. 开发新功能并测试
2. 更新 README.md (描述新功能)
3. 更新 CHANGELOG.md
4. 更新 package.json 版本号
5. 按照上述发版步骤 1-6 操作

### 对于主版本 (2.0.0, 3.0.0, ...)

1. 大量功能重构或 API 破坏性更改
2. 充分测试，确保无 bug
3. 更新所有文档
4. 准备迁移指南
5. 按照上述发版步骤 1-6 操作

---

## 📞 获取帮助

### vsce 官方文档
https://github.com/microsoft/vscode-vsce

### VS Code 市场发布指南
https://code.visualstudio.com/api/working-with-extensions/publishing-extension

### 遇到问题？
- 检查 DEPLOY.md 的"常见问题解答"
- 查看 GitHub Issues
- 联系: QQ 183354595

---

## 🎉 祝贺！

您已准备好发布 **RA2 INI Assistant 1.0.0**！

这是一个功能完整、质量优秀、文档齐全的 VS Code 扩展。

**让我们一起为红警2社区贡献优秀的工具吧！** 🚀

---

**最后检查清单:**
- [ ] 代码审查通过
- [ ] 文档更新完成
- [ ] 本地测试无误
- [ ] Git 提交完成
- [ ] 版本标签已创建
- [ ] 扩展包已生成
- [ ] 发布到市场
- [ ] GitHub Release 已创建
- [ ] 社区公告已发送

✅ **所有步骤完成？那就发版吧！** 🎊
