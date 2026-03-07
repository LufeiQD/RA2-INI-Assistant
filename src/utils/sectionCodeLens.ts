import * as vscode from "vscode";
import { IniIndexManager } from "../indexManager";
import { RegisterHelper } from "./registerHelper";
import { collectSectionHeaders, buildInheritanceChain } from "./sectionUtils";

export class IniSectionCodeLensProvider implements vscode.CodeLensProvider {
  constructor(
    private indexManager: IniIndexManager,
    private registerHelper: RegisterHelper
  ) { }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.languageId !== "ini") {
      return [];
    }

    const sections = collectSectionHeaders(document);
    const lenses: vscode.CodeLens[] = [];
    const parentMap = new Map<string, string>();

    for (const section of sections) {
      if (section.parent) {
        parentMap.set(section.name, section.parent);
      }
    }

    const localRegistered = this.registerHelper.getRegisteredSections(document);
    const globalRegistered = this.registerHelper.getRegisteredSectionsGlobal();
    const registerSections = new Set(this.registerHelper.getRegisterSections());

    for (const section of sections) {
      const line = new vscode.Range(section.line, 0, section.line, 0);

      if (registerSections.has(section.name)) {
        continue;
      }

      const refs = this.indexManager.findSectionReferences(section.name);
      const refCount = refs.length;

      const isRegistered =
        localRegistered.has(section.name) || globalRegistered.has(section.name);
      const statusText = isRegistered ? "已注册" : "未注册";

      lenses.push(
        new vscode.CodeLens(line, {
          title: `已引用: ${refCount} | ${statusText}`,
          command: "ini-ra2.noop",
        })
      );

      if (!isRegistered) {
        const registerCandidates = this.registerHelper.inferRegisterNamesForSection(section.name);
        const inferredTargets = this.registerHelper.inferRegisterNamesForSectionStrict(section.name);

        if (inferredTargets.length > 0) {
          const previewTarget = inferredTargets[0];
          lenses.push(
            new vscode.CodeLens(line, {
              title: `注册此节名到[${previewTarget}]下`,
              command: "ini-ra2.quickRegisterSection",
              arguments: [document.uri, section.name, registerCandidates, previewTarget],
            })
          );
        }

        lenses.push(
          new vscode.CodeLens(line, {
            title: "选择注册列表注册此节名",
            command: "ini-ra2.quickRegisterSectionChoose",
            arguments: [document.uri, section.name, registerCandidates],
          })
        );
      }

      if (section.parent) {
        const chain = buildInheritanceChain(section.name, parentMap);
        const arrow = chain.chain.join(" <- ");
        const title = chain.cycle ? `Inheritance cycle: ${arrow}` : `Inherits: ${arrow}`;
        lenses.push(
          new vscode.CodeLens(line, {
            title,
            command: "ini-ra2.noop",
          })
        );
      }
    }

    return lenses;
  }
}
