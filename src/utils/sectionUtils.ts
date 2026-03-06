import * as vscode from "vscode";

export interface SectionHeaderInfo {
  name: string;
  parent?: string;
  line: number;
  raw: string;
}

export function parseSectionHeader(line: string): { name: string; parent?: string } | undefined {
  const trimmed = line.trim();

  // [Child]:[Parent]
  let m = trimmed.match(/^\[\s*([^\]]+?)\s*\]\s*:\s*\[\s*([^\]]+?)\s*\]/);
  if (m) {
    return { name: m[1].trim(), parent: m[2].trim() };
  }

  // [Child:Parent]
  m = trimmed.match(/^\[\s*([^:\]]+?)\s*:\s*([^\]]+?)\s*\]/);
  if (m) {
    return { name: m[1].trim(), parent: m[2].trim() };
  }

  // [Section]
  m = trimmed.match(/^\[\s*([^\]]+?)\s*\]/);
  if (m) {
    return { name: m[1].trim() };
  }

  return undefined;
}

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

export function buildInheritanceChain(
  sectionName: string,
  parentMap: Map<string, string>
): { chain: string[]; cycle: boolean } {
  const chain: string[] = [sectionName];
  const visited = new Set<string>([sectionName]);
  let current = sectionName;

  for (let i = 0; i < 64; i++) {
    const parent = parentMap.get(current);
    if (!parent) {
      return { chain, cycle: false };
    }

    chain.push(parent);
    if (visited.has(parent)) {
      return { chain, cycle: true };
    }

    visited.add(parent);
    current = parent;
  }

  return { chain, cycle: true };
}
