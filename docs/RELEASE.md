# Production Release Flow

## Scope
- Target: VS Code marketplace release for this extension.
- Output: `releases/ra2-ini-assistant-<version>.vsix`.

## Preconditions
- Node.js and npm available.
- `vsce` available via devDependencies (`npm run` will resolve it).
- `package.json` version already updated.
- `CHANGELOG.md` and `CHANGELOG_v<version>.md` already updated.

## One-command Build
```bash
npm run release:prod
```

This runs:
1. `npm run package` (production webpack build)
2. `vsce package -o releases/` (generate `.vsix`)

## Verify Artifact
1. Confirm output exists in `releases/`.
2. Confirm package content:
```bash
npx @vscode/vsce ls --tree
```
3. Confirm unwanted paths are excluded by `.vscodeignore` (for example `.venv/`, `src/`, `node_modules/`).

## Publish to Marketplace
```bash
npm run release:publish -- <version>
```

Example:
```bash
npm run release:publish -- 1.2.3
```

## Post-release
1. Commit release files.
2. Create git tag `v<version>`.
3. Push branch and tag.
4. Create GitHub Release and upload the `.vsix` as artifact backup.

