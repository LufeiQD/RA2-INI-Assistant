// ESLint 配置（与 pre-commit 集成）
// 说明：pre-commit 会通过 lint-staged 对暂存的 TypeScript 文件运行 ESLint（自动修复 --fix）。
// 配置入口：package.json 中的 "lint-staged" 字段；如需调整检查规则或文件范围，请同步修改。
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}];