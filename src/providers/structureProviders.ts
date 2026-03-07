import * as vscode from "vscode";

export function registerStructureProviders(): {
    symbolProvider: vscode.Disposable;
    foldingProvider: vscode.Disposable;
} {
    const symbolProvider = vscode.languages.registerDocumentSymbolProvider("ini", {
        provideDocumentSymbols(
            document: vscode.TextDocument
        ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
            const symbols: vscode.DocumentSymbol[] = [];
            const text = document.getText();
            const lines = text.split("\n");

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();

                if (trimmed.startsWith("[") && trimmed.includes("]")) {
                    const match = trimmed.match(/^\[\s*([^\]]+)\s*\]/);
                    if (match) {
                        const sectionName = match[1].trim();

                        let detail = "";
                        const commentMatch = trimmed.match(/\]\s*([;#])\s*(.+)$/);
                        if (commentMatch) {
                            detail = commentMatch[2].trim();
                            if (detail.length > 50) {
                                detail = detail.substring(0, 50) + "...";
                            }
                        }

                        let endLine = lines.length - 1;
                        for (let j = i + 1; j < lines.length; j++) {
                            const nextLine = lines[j].trim();
                            if (nextLine.startsWith("[") && nextLine.includes("]")) {
                                endLine = j - 1;
                                break;
                            }
                        }

                        const range = new vscode.Range(
                            new vscode.Position(i, 0),
                            new vscode.Position(endLine, lines[endLine]?.length ?? 0)
                        );

                        const symbol = new vscode.DocumentSymbol(
                            sectionName,
                            detail,
                            vscode.SymbolKind.Array,
                            range,
                            new vscode.Range(
                                new vscode.Position(i, 0),
                                new vscode.Position(i, line.length)
                            )
                        );

                        symbols.push(symbol);
                    }
                }
            }

            return symbols;
        },
    });

    const foldingProvider = vscode.languages.registerFoldingRangeProvider("ini", {
        provideFoldingRanges(
            document: vscode.TextDocument
        ): vscode.ProviderResult<vscode.FoldingRange[]> {
            const foldingRanges: vscode.FoldingRange[] = [];
            const text = document.getText();
            const lines = text.split("\n");

            let sectionStart = -1;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();

                if (line.startsWith("[") && line.includes("]")) {
                    if (sectionStart !== -1 && i > sectionStart) {
                        foldingRanges.push(
                            new vscode.FoldingRange(
                                sectionStart,
                                i - 1,
                                vscode.FoldingRangeKind.Region
                            )
                        );
                    }

                    sectionStart = i;
                }
            }

            if (sectionStart !== -1 && sectionStart < lines.length - 1) {
                foldingRanges.push(
                    new vscode.FoldingRange(
                        sectionStart,
                        lines.length - 1,
                        vscode.FoldingRangeKind.Region
                    )
                );
            }

            return foldingRanges;
        },
    });

    return {
        symbolProvider,
        foldingProvider,
    };
}
