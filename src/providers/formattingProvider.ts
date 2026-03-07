import * as vscode from "vscode";
import { Translations } from "../types";

interface FormattingProviderDeps {
    translations: Translations;
    outputChannel: vscode.OutputChannel;
}

export function registerFormattingProvider(
    deps: FormattingProviderDeps
): vscode.Disposable {
    const { translations, outputChannel } = deps;

    const sectionsToSort: string[] = [];
    for (const config of Object.values(translations.typeMapping)) {
        sectionsToSort.push(...config.registers);
    }

    outputChannel.appendLine(`[Format] 需要排序的节: ${sectionsToSort.join(", ")}`);

    const getMaxEmptyLines = () => {
        return vscode.workspace
            .getConfiguration("ini-ra2")
            .get<number>("maxEmptyLinesBetweenSections", 2);
    };

    const COMMENT_ALIGN_INDENT = 0;

    return vscode.languages.registerDocumentFormattingEditProvider("ini", {
        provideDocumentFormattingEdits(document: vscode.TextDocument) {
            try {
                const maxEmptyLinesBetweenSections = getMaxEmptyLines();

                const text = document.getText();
                const lines = text.split("\n");
                const formattedLines: string[] = [];

                let currentSection = "";
                let currentSectionLines: string[] = [];
                let inSection = false;
                let consecutiveEmptyLines = 0;

                const alignComment = (comment: string): string => {
                    const trimmedComment = comment.trim();
                    const spaces = " ".repeat(COMMENT_ALIGN_INDENT);

                    let commentChar = "";
                    let commentText = "";

                    if (trimmedComment.startsWith(";")) {
                        commentChar = ";";
                        commentText = trimmedComment.substring(1).trim();
                    } else if (trimmedComment.startsWith("#")) {
                        commentChar = "#";
                        commentText = trimmedComment.substring(1).trim();
                    } else {
                        return comment;
                    }

                    if (commentText && !commentText.startsWith(" ")) {
                        commentText = " " + commentText;
                    }

                    return spaces + commentChar + commentText;
                };

                const processSectionLines = () => {
                    if (currentSectionLines.length === 0) {
                        return;
                    }

                    let regularLines: string[] = [];
                    const appendLines: string[] = [];
                    const otherLines: string[] = [];

                    for (const line of currentSectionLines) {
                        const trimmedLine = line.trim();

                        if (trimmedLine === "") {
                            otherLines.push("");
                            continue;
                        }

                        if (trimmedLine.startsWith(";") || trimmedLine.startsWith("#")) {
                            otherLines.push(alignComment(line));
                            continue;
                        }

                        const equalsIndex = trimmedLine.indexOf("=");
                        if (equalsIndex > 0) {
                            const beforeEquals = trimmedLine.substring(0, equalsIndex).trim();
                            const afterEquals = trimmedLine.substring(equalsIndex + 1);

                            const isAppendOperator = beforeEquals.endsWith("+");

                            let value = afterEquals;
                            let comment = "";

                            const commentIndex = Math.min(
                                afterEquals.indexOf(";") >= 0 ? afterEquals.indexOf(";") : Infinity,
                                afterEquals.indexOf("#") >= 0 ? afterEquals.indexOf("#") : Infinity
                            );

                            if (commentIndex < Infinity && commentIndex >= 0) {
                                value = afterEquals.substring(0, commentIndex);
                                comment = afterEquals.substring(commentIndex);
                            }

                            let cleanKey = beforeEquals.replace(/\s+/g, "");
                            if (isAppendOperator) {
                                cleanKey = cleanKey.endsWith("+") ? "+=" : cleanKey + "=";
                            } else {
                                cleanKey += "=";
                            }

                            const cleanValue = value.trim();

                            let formattedLine = `${cleanKey}${cleanValue}`;
                            if (comment) {
                                if (!cleanValue.endsWith(" ") && !comment.startsWith(" ")) {
                                    formattedLine += " ";
                                }
                                formattedLine += comment;
                            }

                            if (isAppendOperator) {
                                appendLines.push(formattedLine);
                            } else {
                                regularLines.push(formattedLine);
                            }
                        } else {
                            otherLines.push(line);
                        }
                    }

                    if (sectionsToSort.includes(currentSection)) {
                        outputChannel.appendLine(`[Format] 正在排序节: ${currentSection}`);

                        const numericLines: string[] = [];
                        const nonNumericLines: string[] = [];

                        for (const line of regularLines) {
                            const key = line.split("=")[0].trim();
                            const num = parseInt(key, 10);
                            if (!isNaN(num) && key === num.toString()) {
                                numericLines.push(line);
                            } else {
                                nonNumericLines.push(line);
                            }
                        }

                        numericLines.sort((a, b) => {
                            const numA = parseInt(a.split("=")[0].trim(), 10);
                            const numB = parseInt(b.split("=")[0].trim(), 10);
                            return numA - numB;
                        });

                        regularLines = [...numericLines, ...nonNumericLines];

                        if (appendLines.length > 0) {
                            appendLines.sort((a, b) => {
                                const keyMatchA = a.match(/^\+=(\S+)/);
                                const keyMatchB = b.match(/^\+=(\S+)/);

                                if (keyMatchA && keyMatchB) {
                                    const numA = parseInt(keyMatchA[1], 10);
                                    const numB = parseInt(keyMatchB[1], 10);
                                    if (!isNaN(numA) && !isNaN(numB)) {
                                        return numA - numB;
                                    }
                                }
                                return 0;
                            });
                        }

                        currentSectionLines = [...regularLines, ...appendLines, ...otherLines];
                    }

                    for (const line of currentSectionLines) {
                        formattedLines.push(line);
                    }

                    currentSectionLines = [];
                };

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const trimmedLine = line.trim();

                    if (trimmedLine.startsWith("[")) {
                        if (inSection) {
                            processSectionLines();
                        }

                        let fullSectionText = trimmedLine;
                        let j = i;
                        while (!fullSectionText.includes("]") && j < lines.length - 1) {
                            j++;
                            fullSectionText += lines[j].trim();
                        }
                        i = j;

                        const bracketEndIndex = fullSectionText.indexOf("]");
                        if (bracketEndIndex > 0) {
                            const sectionContent = fullSectionText.substring(1, bracketEndIndex);
                            const afterSection = fullSectionText.substring(bracketEndIndex + 1);

                            const cleanSectionName = sectionContent.replace(/\s+/g, "");
                            let cleanSection = `[${cleanSectionName}]`;

                            if (afterSection.trim()) {
                                const afterContent = afterSection.trim();
                                if (!afterContent.startsWith(" ") && !cleanSection.endsWith(" ")) {
                                    cleanSection += " ";
                                }
                                cleanSection += afterContent;
                            }

                            if (formattedLines.length > 0) {
                                let lastNonEmptyLine = "";
                                for (let k = formattedLines.length - 1; k >= 0; k--) {
                                    if (formattedLines[k].trim() !== "") {
                                        lastNonEmptyLine = formattedLines[k].trim();
                                        break;
                                    }
                                }

                                const isLastLineComment =
                                    lastNonEmptyLine.startsWith(";") ||
                                    lastNonEmptyLine.startsWith("#");

                                while (
                                    formattedLines.length > 0 &&
                                    formattedLines[formattedLines.length - 1] === ""
                                ) {
                                    formattedLines.pop();
                                }

                                if (!isLastLineComment) {
                                    for (
                                        let blank = 0;
                                        blank < Math.min(maxEmptyLinesBetweenSections, 2);
                                        blank++
                                    ) {
                                        formattedLines.push("");
                                    }
                                }
                            }

                            formattedLines.push(cleanSection);

                            currentSection = cleanSectionName;
                            inSection = true;
                            consecutiveEmptyLines = 0;

                            let nextLine = i + 1;
                            while (nextLine < lines.length && lines[nextLine].trim() === "") {
                                nextLine++;
                            }
                            i = nextLine - 1;
                            continue;
                        }
                    }

                    if (!inSection) {
                        if (trimmedLine === "") {
                            consecutiveEmptyLines++;
                            if (consecutiveEmptyLines <= maxEmptyLinesBetweenSections) {
                                formattedLines.push("");
                            }
                            continue;
                        }
                        consecutiveEmptyLines = 0;
                    }

                    if (trimmedLine.startsWith(";") || trimmedLine.startsWith("#")) {
                        if (inSection) {
                            currentSectionLines.push(line);
                        } else {
                            formattedLines.push(alignComment(line));
                        }
                        continue;
                    }

                    const equalsIndex = trimmedLine.indexOf("=");
                    if (equalsIndex > 0) {
                        if (inSection) {
                            currentSectionLines.push(line);
                        } else {
                            const beforeEquals = trimmedLine.substring(0, equalsIndex).trim();
                            const afterEquals = trimmedLine.substring(equalsIndex + 1);

                            let cleanKey = beforeEquals.replace(/\s+/g, "");
                            if (cleanKey.endsWith("+")) {
                                cleanKey = "+=";
                            } else {
                                cleanKey += "=";
                            }

                            let value = afterEquals;
                            let comment = "";
                            const commentIndex = Math.min(
                                afterEquals.indexOf(";") >= 0 ? afterEquals.indexOf(";") : Infinity,
                                afterEquals.indexOf("#") >= 0 ? afterEquals.indexOf("#") : Infinity
                            );
                            if (commentIndex < Infinity && commentIndex >= 0) {
                                value = afterEquals.substring(0, commentIndex);
                                comment = afterEquals.substring(commentIndex);
                            }

                            const cleanValue = value.trim();
                            let formattedLine = `${cleanKey}${cleanValue}`;
                            if (comment) {
                                if (!cleanValue.endsWith(" ") && !comment.startsWith(" ")) {
                                    formattedLine += " ";
                                }
                                formattedLine += comment;
                            }

                            formattedLines.push(formattedLine);
                        }
                        continue;
                    }

                    if (trimmedLine === "") {
                        if (inSection) {
                            currentSectionLines.push("");
                        }
                        continue;
                    }

                    if (inSection) {
                        currentSectionLines.push(line);
                    } else {
                        formattedLines.push(line);
                    }
                }

                if (inSection) {
                    processSectionLines();
                }

                while (
                    formattedLines.length > 0 &&
                    formattedLines[formattedLines.length - 1] === ""
                ) {
                    formattedLines.pop();
                }

                const formattedText = formattedLines.join("\n");

                const fullRange = new vscode.Range(
                    document.positionAt(0),
                    document.positionAt(text.length)
                );

                return [vscode.TextEdit.replace(fullRange, formattedText)];
            } catch (error) {
                outputChannel.appendLine(`格式化错误: ${error}`);
                vscode.window.showErrorMessage(`INI 格式化失败: ${error}`);
                return [];
            }
        },
    });
}
