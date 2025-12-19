#!/usr/bin/env bash
# RA2 INI Assistant 发版检查和部署脚本

echo "======================================"
echo "  RA2 INI Assistant 发版检查脚本"
echo "======================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 计数器
PASS=0
FAIL=0

# 检查函数
check() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ 通过${NC}: $1"
        ((PASS++))
    else
        echo -e "${RED}❌ 失败${NC}: $1"
        ((FAIL++))
    fi
}

echo "📋 第一步: 基础检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 检查 Node.js
node --version > /dev/null 2>&1
check "Node.js 已安装"

# 检查 npm
npm --version > /dev/null 2>&1
check "npm 已安装"

# 检查 package.json
[ -f "package.json" ]
check "package.json 文件存在"

echo ""
echo "📋 第二步: 代码质量检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 运行 ESLint
npm run lint > /dev/null 2>&1
check "ESLint 检查通过"

# 运行 TypeScript 编译
npm run compile > /dev/null 2>&1
check "TypeScript 编译通过"

echo ""
echo "📋 第三步: 生产版本检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 编译生产版本
npm run package > /dev/null 2>&1
check "生产版本编译通过"

# 检查 dist/extension.js 存在
[ -f "dist/extension.js" ]
check "extension.js 已生成"

echo ""
echo "📋 第四步: 文档检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 检查文档文件
[ -f "README.md" ]
check "README.md 存在"

[ -f "CHANGELOG.md" ]
check "CHANGELOG.md 存在"

[ -f "LICENSE" ]
check "LICENSE 文件存在"

[ -f "DEPLOY.md" ]
check "DEPLOY.md 存在"

[ -f "RELEASE_CHECKLIST.md" ]
check "RELEASE_CHECKLIST.md 存在"

[ -f "RELEASE_REPORT.md" ]
check "RELEASE_REPORT.md 存在"

# 确认代码片段文件会被打包
[ -f "snippets/ini.json" ]
check "snippets/ini.json 片段文件存在"

echo ""
echo "📋 第五步: 元数据检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 检查版本号
grep -q '"version": "1.0.0"' package.json
check "版本号正确 (1.0.0)"

# 检查发布者
grep -q '"publisher": "LufeiQD"' package.json
check "发布者信息完整"

# 检查许可证
grep -q '"license": "MIT"' package.json
check "许可证正确 (MIT)"

echo ""
echo "════════════════════════════════════════════"
echo "  检查结果总结"
echo "════════════════════════════════════════════"
echo -e "✅ 通过: ${GREEN}${PASS}${NC} 项"
echo -e "❌ 失败: ${RED}${FAIL}${NC} 项"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}🎉 所有检查通过！可以发版了！${NC}"
    echo ""
    echo "📝 下一步操作:"
    echo "1. 打包扩展: vsce package 1.0.0"
    echo "2. 发布到市场: vsce publish 1.0.0"
    echo "3. 创建 GitHub Release"
    echo ""
    exit 0
else
    echo -e "${RED}⚠️  有 ${FAIL} 项检查失败，请修复后重试${NC}"
    echo ""
    exit 1
fi
