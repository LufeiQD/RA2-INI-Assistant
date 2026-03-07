import * as vscode from "vscode";
import {
  buildInheritanceChain,
  parseSectionHeader,
} from "./sectionParser";

export interface SectionHeaderInfo {
  name: string;
  parent?: string;
  line: number;
  raw: string;
}

export { parseSectionHeader, buildInheritanceChain };

export function collectSectionHeaders(document: vscode.TextDocument): SectionHeaderInfo[] {
  const sections: SectionHeaderInfo[] = [];
  for (let i = 0; i < document.lineCount; i++) {
    const lineText = document.lineAt(i).text;
    const parsed = parseSectionHeader(lineText);
    if (!parsed) {
      continue;
    }

    sections.push({
      name: parsed.name,
      parent: parsed.parent,
      line: i,
      raw: lineText,
    });
  }
  return sections;
}

