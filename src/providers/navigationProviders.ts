import * as path from "path";
import * as vscode from "vscode";
import { IniIndexManager } from "../indexManager";
import { Translations } from "../types";
import { TypeInference } from "../utils/typeInference";
import { parseSectionHeader } from "../utils/sectionUtils";

interface NavigationProviderDeps {
    indexManager: IniIndexManager;
    translations: Translations;
    typeInference: TypeInference;
}

function getCurrentSection(
    document: vscode.TextDocument,
    currentLine: number
): string | undefined {
    for (let i = currentLine; i >= 0; i--) {
        const line = document.lineAt(i).text.trim();
        if (line.startsWith("[") && line.includes("]")) {
            const match = line.match(/^\[\s*([^:\]]+)\s*(\s*:\s*[^\]]+)?\s*\]/);
            if (match) {
                return match[1].trim();
            }
        }
    }
    return undefined;
}

export function registerNavigationProviders(
    deps: NavigationProviderDeps
): {
    definitionProvider: vscode.Disposable;
    referenceProvider: vscode.Disposable;
    hoverProvider: vscode.Disposable;
} {
    const { indexManager, translations, typeInference } = deps;

    const definitionProvider = vscode.languages.registerDefinitionProvider("ini", {
        async provideDefinition(
            document: vscode.TextDocument,
            position: vscode.Position
        ): Promise<vscode.Definition | null> {
            const line = document.lineAt(position.line);
            const lineText = line.text;

            const wordRange = document.getWordRangeAtPosition(position);
            if (!wordRange) {
                return null;
            }

            const word = document.getText(wordRange);

            const config = vscode.workspace.getConfiguration("ini-ra2");
            const enableJump = config.get<boolean>("enableJumpToDefinition", true);

            const trimmedLine = lineText.trim();
            if (trimmedLine.startsWith("[") && trimmedLine.includes("]")) {
                return null;
            }

            const equalsIndex = lineText.indexOf("=");
            if (equalsIndex > 0) {
                const keyStart = lineText.indexOf(lineText.trim());
                const keyEnd = keyStart + lineText.substring(keyStart, equalsIndex).trim().length;

                if (position.character >= keyStart && position.character <= keyEnd) {
                    return null;
                }

                const value = lineText.substring(equalsIndex + 1).trim();

                let cleanValue = value;
                const commentIndex = Math.min(
                    value.indexOf(";") >= 0 ? value.indexOf(";") : Infinity,
                    value.indexOf("#") >= 0 ? value.indexOf("#") : Infinity
                );
                if (commentIndex < Infinity) {
                    cleanValue = value.substring(0, commentIndex).trim();
                }

                if (!cleanValue.includes(word)) {
                    return null;
                }

                const definitions: vscode.Location[] = [];
                const enableMultiFile = vscode.workspace
                    .getConfiguration("ini-ra2")
                    .get<boolean>("enableMultiFileSearch", false);

                if (enableMultiFile) {
                    const sectionDefs = indexManager.findSectionDefinitions(word);
                    for (const def of sectionDefs) {
                        const uri = vscode.Uri.file(def.file);
                        const range = new vscode.Range(
                            new vscode.Position(def.line, 0),
                            new vscode.Position(def.line, 100)
                        );
                        definitions.push(new vscode.Location(uri, range));
                    }
                } else {
                    const text = document.getText();
                    const lines = text.split("\n");

                    for (let i = 0; i < lines.length; i++) {
                        const currentLine = lines[i].trim();
                        const sectionRegex = new RegExp(`^\\[\\s*${word}\\s*\\]`);
                        if (sectionRegex.test(currentLine)) {
                            const range = new vscode.Range(
                                new vscode.Position(i, 0),
                                new vscode.Position(i, currentLine.length)
                            );
                            definitions.push(new vscode.Location(document.uri, range));
                        }
                    }
                }

                if (definitions.length === 0) {
                    return null;
                }

                if (!enableJump) {
                    return null;
                }

                return definitions;
            }

            return null;
        },
    });

    const referenceProvider = vscode.languages.registerReferenceProvider("ini", {
        async provideReferences(
            document: vscode.TextDocument,
            position: vscode.Position
        ): Promise<vscode.Location[] | null> {
            const line = document.lineAt(position.line);
            const lineText = line.text;

            const wordRange = document.getWordRangeAtPosition(position);
            if (!wordRange) {
                return null;
            }

            const word = document.getText(wordRange);

            const trimmedLine = lineText.trim();
            const currentHeader = parseSectionHeader(trimmedLine);
            const isHeaderWord =
                !!currentHeader &&
                (currentHeader.name.toLowerCase() === word.toLowerCase() ||
                    currentHeader.parent?.toLowerCase() === word.toLowerCase());
            if (!isHeaderWord) {
                return null;
            }

            const references: vscode.Location[] = [];
            const enableMultiFile = vscode.workspace
                .getConfiguration("ini-ra2")
                .get<boolean>("enableMultiFileSearch", false);

            if (enableMultiFile) {
                const defs = indexManager.findSectionDefinitions(word);
                for (const def of defs) {
                    const uri = vscode.Uri.file(def.file);
                    const range = new vscode.Range(
                        new vscode.Position(def.line, 0),
                        new vscode.Position(def.line, 100)
                    );
                    references.push(new vscode.Location(uri, range));
                }

                const refs = indexManager.findSectionReferences(word);
                for (const ref of refs) {
                    const uri = vscode.Uri.file(ref.file);
                    const range = new vscode.Range(
                        new vscode.Position(ref.line, 0),
                        new vscode.Position(ref.line, 100)
                    );
                    references.push(new vscode.Location(uri, range));
                }
            } else {
                const text = document.getText();
                const lines = text.split("\n");

                for (let i = 0; i < lines.length; i++) {
                    const currentLine = lines[i];
                    const trimmed = currentLine.trim();

                    if (trimmed.startsWith(";") || trimmed.startsWith("#")) {
                        continue;
                    }

                    const section = parseSectionHeader(trimmed);
                    if (section) {
                        if (section.name.toLowerCase() === word.toLowerCase()) {
                            const range = new vscode.Range(
                                new vscode.Position(i, 0),
                                new vscode.Position(i, currentLine.length)
                            );
                            references.push(new vscode.Location(document.uri, range));
                        }

                        if (section.parent && section.parent.toLowerCase() === word.toLowerCase()) {
                            const parentPos = currentLine.toLowerCase().indexOf(section.parent.toLowerCase());
                            const start = parentPos >= 0 ? parentPos : 0;
                            const range = new vscode.Range(
                                new vscode.Position(i, start),
                                new vscode.Position(i, start + section.parent.length)
                            );
                            references.push(new vscode.Location(document.uri, range));
                        }
                        continue;
                    }

                    const equalsIndex = currentLine.indexOf("=");
                    if (equalsIndex > 0) {
                        const value = currentLine.substring(equalsIndex + 1);

                        let cleanValue = value;
                        const commentIndex = Math.min(
                            value.indexOf(";") >= 0 ? value.indexOf(";") : Infinity,
                            value.indexOf("#") >= 0 ? value.indexOf("#") : Infinity
                        );
                        if (commentIndex < Infinity) {
                            cleanValue = value.substring(0, commentIndex);
                        }

                        const valueRegex = new RegExp(`\\b${word}\\b`);
                        if (valueRegex.test(cleanValue)) {
                            const startPos = currentLine.indexOf(word, equalsIndex);
                            if (startPos !== -1) {
                                const range = new vscode.Range(
                                    new vscode.Position(i, startPos),
                                    new vscode.Position(i, startPos + word.length)
                                );
                                references.push(new vscode.Location(document.uri, range));
                            }
                        }
                    }
                }
            }

            return references.length > 0 ? references : null;
        },
    });

    const hoverProvider = vscode.languages.registerHoverProvider("ini", {
        provideHover(
            document: vscode.TextDocument,
            position: vscode.Position
        ): vscode.ProviderResult<vscode.Hover> {
            const line = document.lineAt(position.line);
            const lineText = line.text;

            const wordRange = document.getWordRangeAtPosition(position);
            if (!wordRange) {
                return null;
            }

            const hoveredWord = document.getText(wordRange);

            const trimmedLine = lineText.trim();
            if (trimmedLine.startsWith("[") && trimmedLine.includes("]")) {
                const sectionName = hoveredWord;

                const bracketStart = lineText.indexOf("[");
                const bracketEnd = lineText.indexOf("]");

                if (
                    position.character >= bracketStart + 1 &&
                    position.character <= bracketEnd - 1
                ) {
                    const content = new vscode.MarkdownString();
                    content.appendMarkdown(`### [${sectionName}]\n\n`);

                    const sectionType = typeInference.inferSectionType(sectionName);
                    if (sectionType) {
                        content.appendMarkdown(`**类型:** \`${sectionType}\`\n\n`);
                    }

                    const sectionDescription =
                        translations.sections[sectionName] || translations.common[sectionName];

                    if (sectionDescription) {
                        content.appendMarkdown(sectionDescription);
                        content.appendMarkdown("\n\n---\n\n");
                    } else {
                        content.appendMarkdown("*该节名暂无详细说明*\n\n---\n\n");
                    }

                    const text = document.getText();
                    const lines = text.split("\n");
                    const references: Array<{ line: number; section: string; key: string; value: string }> = [];

                    const sectionRegex = new RegExp(`\\b${sectionName}\\b`);
                    let currentSection = "文件头部";

                    for (let i = 0; i < lines.length; i++) {
                        const currentLine = lines[i];
                        const trimmed = currentLine.trim();

                        if (trimmed.startsWith("[") && trimmed.includes("]")) {
                            const match = trimmed.match(/^\[\s*([^\]]+)\s*\]/);
                            if (match) {
                                currentSection = match[1].trim();
                            }
                            continue;
                        }

                        if (trimmed.startsWith(";") || trimmed.startsWith("#")) {
                            continue;
                        }

                        const eqIndex = currentLine.indexOf("=");
                        if (eqIndex > 0) {
                            const keyPart = currentLine.substring(0, eqIndex).trim();
                            const valuePart = currentLine.substring(eqIndex + 1);

                            let cleanValue = valuePart;
                            const commentIdx = Math.min(
                                valuePart.indexOf(";") >= 0 ? valuePart.indexOf(";") : Infinity,
                                valuePart.indexOf("#") >= 0 ? valuePart.indexOf("#") : Infinity
                            );
                            if (commentIdx < Infinity) {
                                cleanValue = valuePart.substring(0, commentIdx);
                            }

                            if (sectionRegex.test(cleanValue.trim())) {
                                references.push({
                                    line: i + 1,
                                    section: currentSection,
                                    key: keyPart,
                                    value: cleanValue.trim(),
                                });
                            }
                        }
                    }

                    const enableMultiFile = vscode.workspace
                        .getConfiguration("ini-ra2")
                        .get<boolean>("enableMultiFileSearch", true);

                    if (enableMultiFile) {
                        const otherDefs = indexManager
                            .findSectionDefinitions(sectionName)
                            .filter((def) => def.file !== document.uri.fsPath);

                        if (otherDefs.length > 0) {
                            content.appendMarkdown("**其他文件中的定义**：\n\n");
                            for (const def of otherDefs) {
                                const fileName = path.basename(def.file);
                                content.appendMarkdown(`- 文件: **${fileName}** (行 ${def.line + 1})\n`);
                            }
                            content.appendMarkdown("\n");
                        }
                    }

                    if (references.length > 0) {
                        content.appendMarkdown(`**当前文件引用** (${references.length}处)：\n\n`);

                        const maxShow = 10;
                        const showReferences = references.slice(0, maxShow);

                        for (const ref of showReferences) {
                            content.appendMarkdown(`- 行 ${ref.line} **[${ref.section}]**: \`${ref.key}=${ref.value}\`\n`);
                        }

                        if (references.length > maxShow) {
                            content.appendMarkdown(`\n*...还有 ${references.length - maxShow} 处引用*\n`);
                        }
                    } else {
                        const showEmptyHint = vscode.workspace
                            .getConfiguration("ini-ra2")
                            .get<boolean>("showEmptyReferenceHint", true);

                        if (showEmptyHint) {
                            content.appendMarkdown("**当前文件引用**：未找到引用此节名的键值对\n");
                        }
                    }

                    if (enableMultiFile) {
                        const otherRefs = indexManager
                            .findSectionReferences(sectionName)
                            .filter((ref) => ref.file !== document.uri.fsPath);

                        if (otherRefs.length > 0) {
                            content.appendMarkdown(`\n**其他文件引用** (${otherRefs.length}处)：\n\n`);

                            const maxShow = 5;
                            const showRefs = otherRefs.slice(0, maxShow);

                            for (const ref of showRefs) {
                                const fileName = path.basename(ref.file);
                                content.appendMarkdown(
                                    `- **${fileName}** 行 ${ref.line + 1} [${ref.section}]: \`${ref.key}=${ref.value}\`\n`
                                );
                            }

                            if (otherRefs.length > maxShow) {
                                content.appendMarkdown(`\n*...还有 ${otherRefs.length - maxShow} 处引用*\n`);
                            }
                        }
                    }

                    content.isTrusted = true;
                    content.supportHtml = false;

                    return new vscode.Hover(content);
                }
            }

            const equalsIndex = lineText.indexOf("=");
            if (equalsIndex > 0) {
                const key = lineText.substring(0, equalsIndex).trim();

                const keyStart = lineText.indexOf(key);
                if (
                    position.character >= keyStart &&
                    position.character <= keyStart + key.length
                ) {
                    const currentSection = getCurrentSection(document, position.line);

                    const value = lineText.substring(equalsIndex + 1).trim();
                    const commentIndex = Math.min(
                        value.indexOf(";") >= 0 ? value.indexOf(";") : Infinity,
                        value.indexOf("#") >= 0 ? value.indexOf("#") : Infinity
                    );
                    const actualValue =
                        commentIndex < Infinity ? value.substring(0, commentIndex).trim() : value;

                    let description: string | undefined;
                    if (currentSection) {
                        description = typeInference.getTranslationWithType(key, currentSection, actualValue);
                    }

                    if (!description) {
                        description = translations.common[key];
                    }

                    if (description) {
                        const content = new vscode.MarkdownString();

                        content.appendMarkdown(`### ${key}\n\n`);
                        if (currentSection) {
                            content.appendMarkdown(`*所在节: [${currentSection}]*\n\n`);
                        }

                        content.appendMarkdown(description);
                        content.isTrusted = true;
                        content.supportHtml = false;

                        if (actualValue) {
                            content.appendMarkdown(`\n\n**当前值:** \`${actualValue}\``);

                            const lowerValue = actualValue.toLowerCase();
                            if (
                                lowerValue === "yes" ||
                                lowerValue === "no" ||
                                lowerValue === "true" ||
                                lowerValue === "false"
                            ) {
                                content.appendMarkdown(
                                    `\n**含义:** ${lowerValue === "yes" || lowerValue === "true" ? "是/启用" : "否/禁用"
                                    }`
                                );
                            }
                        }

                        return new vscode.Hover(content);
                    }
                    return null;
                }

                const valuePart = lineText.substring(equalsIndex + 1);
                const commentIndex = Math.min(
                    valuePart.indexOf(";") >= 0 ? valuePart.indexOf(";") : Infinity,
                    valuePart.indexOf("#") >= 0 ? valuePart.indexOf("#") : Infinity
                );
                let cleanValue = valuePart;
                if (commentIndex < Infinity) {
                    cleanValue = valuePart.substring(0, commentIndex);
                }

                if (hoveredWord && cleanValue.includes(hoveredWord)) {
                    const config = vscode.workspace.getConfiguration("ini-ra2");
                    const enableJump = config.get<boolean>("enableJumpToDefinition", true);

                    const enableMultiFile = vscode.workspace
                        .getConfiguration("ini-ra2")
                        .get<boolean>("enableMultiFileSearch", true);

                    const sectionNames = enableMultiFile ? indexManager.getAllSections() : new Set<string>();

                    if (sectionNames.size === 0) {
                        const text = document.getText();
                        const lines = text.split("\n");
                        for (const l of lines) {
                            const trimmed = l.trim();
                            const match = trimmed.match(/^\[\s*([^:\]]+)\s*(\s*:\s*[^\]]+)?\s*\]/);
                            if (match) {
                                sectionNames.add(match[1].trim());
                            }
                        }
                    }

                    if (sectionNames.has(hoveredWord)) {
                        const content = new vscode.MarkdownString();

                        if (enableJump) {
                            content.appendMarkdown(`**跳转到 [\`${hoveredWord}\`] 定义**\n\nCtrl+单击 快速跳转`);
                        } else {
                            content.appendMarkdown(`**预览 [\`${hoveredWord}\`] 定义**\n\n`);
                            const commandParam = JSON.stringify({
                                uri: document.uri.toString(),
                                section: hoveredWord,
                            });
                            content.appendMarkdown(
                                `[点击预览](command:ini-ra2.peekDefinition?${encodeURIComponent(commandParam)})`
                            );
                        }

                        content.isTrusted = true;
                        content.supportHtml = false;

                        return new vscode.Hover(content);
                    }
                }
            }

            return null;
        },
    });

    return { definitionProvider, referenceProvider, hoverProvider };
}
