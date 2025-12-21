/**
 * Commitlint 配置
 * 强制使用 Conventional Commits 规范，常用类型如下：
 * - feat:     新功能
 * - fix:      修复缺陷
 * - docs:     文档变更
 * - style:    代码格式（不影响逻辑）
 * - refactor: 代码重构（非新增功能、非修复缺陷）
 * - perf:     性能优化
 * - test:     增加或修改测试
 * - build:    构建系统或外部依赖变更
 * - ci:       CI 配置变更
 * - chore:    其他不影响代码逻辑的改动
 * - revert:   回滚改动
 * 
 * 提交示例：
 *   feat: 支持章节搜索到 Quick Pick
 *   fix: 修复节名带注释误报问题
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert'
      ]
    ],
    'type-case': [2, 'always', 'lower-case'],
    'subject-case': [0],
  }
};