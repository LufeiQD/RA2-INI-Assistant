/**
 * INI 文件索引管理器
 * 负责索引工作区中的 INI 文件，收集节名和引用关系
 */

import * as vscode from "vscode";
import * as path from "path";
import { SectionInfo, FileIndex } from "./types";

export class IniIndexManager {
  private index: Map<string, FileIndex> = new Map();
  private indexing: boolean = false;
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  // 检查文件是否在白名单中
  private isFileInWhitelist(fileName: string): boolean {
    const relatedFiles = vscode.workspace
      .getConfiguration("ini-ra2")
      .get<string[]>("relatedFiles", []);

    if (relatedFiles.length === 0) {
      return true; // 如果没有配置，默认允许所有文件
    }

    const lowerFileName = fileName.toLowerCase();
    return relatedFiles.some((pattern) => {
      const lowerPattern = pattern.toLowerCase();
      // 支持通配符 *
      if (lowerPattern.includes("*")) {
        const regex = new RegExp("^" + lowerPattern.replace(/\*/g, ".*") + "$");
        return regex.test(lowerFileName);
      }
      return lowerFileName === lowerPattern;
    });
  }

  async indexFile(uri: vscode.Uri): Promise<void> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const maxSize =
        vscode.workspace.getConfiguration("ini-ra2").get<number>("maxFileSize", 5) *
        1024 *
        1024;

      // 检查文件大小
      if (stat.size > maxSize) {
        this.outputChannel.appendLine(
          `跳过大文件: ${uri.fsPath} (${(stat.size / 1024 / 1024).toFixed(2)}MB)`
        );
        return;
      }

      const document = await vscode.workspace.openTextDocument(uri);
      const text = document.getText();
      const lines = text.split("\n");

      const sections = new Map<string, SectionInfo[]>();
      const references = new Map<
        string,
        Array<{ line: number; key: string; value: string; section: string }>
      >();
      const registers = new Map<string, string[]>(); // 存储注册列表
      let currentSection = "";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // 跳过注释和空行
        if (line === "" || line.startsWith(";") || line.startsWith("#")) {
          continue;
        }

        // 检测节名
        const sectionMatch = line.match(/^\[\s*([^\]]+)\s*\]/);
        if (sectionMatch) {
          const sectionName = sectionMatch[1].trim();
          currentSection = sectionName;

          if (!sections.has(sectionName)) {
            sections.set(sectionName, []);
          }
          sections.get(sectionName)!.push({
            name: sectionName,
            line: i,
            file: uri.fsPath,
          });
          continue;
        }

        // 检测键值对
        const equalsIndex = line.indexOf("=");
        const isRegisterSection =
          currentSection.endsWith("Types") ||
          currentSection === "Warheads" ||
          currentSection === "Projectiles" ||
          currentSection === "Animations" ||
          currentSection === "Particles" ||
          currentSection === "ParticleSystems" ||
          currentSection === "SuperWeaponTypes" ||
          currentSection === "VoxelAnims" ||
          currentSection === "TerrainTypes" ||
          currentSection === "SmudgeTypes" ||
          currentSection === "OverlayTypes" ||
          currentSection === "Tiberiums" ||
          currentSection === "Countries" ||
          currentSection === "Sides" ||
          currentSection === "Colors";

        // 注册列表支持无等号行（如 [WeaponTypes] 中的裸值）
        if (isRegisterSection && equalsIndex === -1 && currentSection) {
          let registerValue = line;
          const commentCut = Math.min(
            line.indexOf(";") >= 0 ? line.indexOf(";") : Infinity,
            line.indexOf("#") >= 0 ? line.indexOf("#") : Infinity
          );
          if (commentCut < Infinity) {
            registerValue = line.substring(0, commentCut).trim();
          }
          if (!registerValue) {
            continue;
          }
          if (!registers.has(currentSection)) {
            registers.set(currentSection, []);
          }
          registers.get(currentSection)!.push(registerValue);
          continue;
        }

        if (equalsIndex > 0 && currentSection) {
          const key = line.substring(0, equalsIndex).trim();
          const valuePart = line.substring(equalsIndex + 1);

          // 移除注释
          let value = valuePart;
          const commentIdx = Math.min(
            valuePart.indexOf(";") >= 0 ? valuePart.indexOf(";") : Infinity,
            valuePart.indexOf("#") >= 0 ? valuePart.indexOf("#") : Infinity
          );
          if (commentIdx < Infinity) {
            value = valuePart.substring(0, commentIdx);
          }
          value = value.trim();

          // 处理可能的节名引用
          if (value && value.length > 0) {
            if (isRegisterSection) {
              // 记录注册列表中的值
              if (!registers.has(currentSection)) {
                registers.set(currentSection, []);
              }
              registers.get(currentSection)!.push(value);
            }

            // 分割逗号分隔的值（如 DestroyAnim=UNIT1,UNIT2,UNIT3）
            const values = value
              .split(",")
              .map((v) => v.trim())
              .filter((v) => v.length > 0);

            for (const singleValue of values) {
              // 跳过明显不是节名的值（包含空格、纯数字等）
              if (singleValue.includes(" ") || /^\d+$/.test(singleValue)) {
                continue;
              }

              if (!references.has(singleValue)) {
                references.set(singleValue, []);
              }
              references.get(singleValue)!.push({
                line: i,
                key: key,
                value: value, // 保存完整的值
                section: currentSection,
              });
            }
          }
        }
      }

      this.index.set(uri.fsPath, {
        sections,
        references,
        registers,
        lastModified: stat.mtime,
        size: stat.size,
      });
    } catch (error) {
      this.outputChannel.appendLine(`索引文件失败: ${uri.fsPath} - ${error}`);
    }
  }

  async indexWorkspace(): Promise<void> {
    if (this.indexing) {
      return;
    }

    this.indexing = true;

    try {
      this.outputChannel.appendLine("开始索引工作区 INI 文件...");

      const files = await vscode.workspace.findFiles(
        "**/*.ini",
        "**/node_modules/**"
      );

      // 获取白名单配置
      const relatedFiles = vscode.workspace
        .getConfiguration("ini-ra2")
        .get<string[]>("relatedFiles", [
          "rulesmd.ini",
          "artmd.ini",
          "soundmd.ini",
          "aimd.ini",
          "rules.ini",
          "art.ini",
          "sound.ini",
          "ai.ini",
        ]);

      // 过滤白名单文件
      const whitelistFiles = files.filter((file) => {
        const fileName = path.basename(file.fsPath);
        return this.isFileInWhitelist(fileName);
      });

      // 获取当前所有打开的 INI 文档
      const openDocs = vscode.workspace.textDocuments
        .filter((doc) => doc.languageId === "ini")
        .map((doc) => doc.uri);

      // 合并：白名单文件 + 当前打开的文件（去重）
      const allFilesToIndex = new Set<string>();
      whitelistFiles.forEach((file) => allFilesToIndex.add(file.fsPath));
      openDocs.forEach((uri) => allFilesToIndex.add(uri.fsPath));

      const filesToIndex = Array.from(allFilesToIndex).map((p) =>
        vscode.Uri.file(p)
      );

      this.outputChannel.appendLine(
        `找到 ${files.length} 个 INI 文件，白名单: ${whitelistFiles.length} 个，当前打开: ${openDocs.length} 个，合并后索引: ${filesToIndex.length} 个`
      );
      this.outputChannel.appendLine(`白名单配置: ${JSON.stringify(relatedFiles)}`);

      // 批量索引（限制并发）
      const batchSize = 10;
      for (let i = 0; i < filesToIndex.length; i += batchSize) {
        const batch = filesToIndex.slice(i, i + batchSize);
        await Promise.all(batch.map((file) => this.indexFile(file)));
      }

      this.outputChannel.appendLine("工作区索引完成");
    } catch (error) {
      this.outputChannel.appendLine(`索引工作区失败: ${error}`);
    } finally {
      this.indexing = false;
    }
  }

  async updateFile(uri: vscode.Uri): Promise<void> {
    await this.indexFile(uri);
  }

  removeFile(uri: vscode.Uri): void {
    this.index.delete(uri.fsPath);
  }

  findSectionDefinitions(sectionName: string): SectionInfo[] {
    const results: SectionInfo[] = [];
    for (const [_, fileIndex] of this.index) {
      const defs = fileIndex.sections.get(sectionName);
      if (defs) {
        results.push(...defs);
      }
    }
    return results;
  }

  findSectionReferences(
    sectionName: string
  ): Array<{
    line: number;
    key: string;
    value: string;
    section: string;
    file: string;
  }> {
    const results: Array<any> = [];
    for (const [filePath, fileIndex] of this.index) {
      const refs = fileIndex.references.get(sectionName);
      if (refs) {
        results.push(...refs.map((ref) => ({ ...ref, file: filePath })));
      }
    }
    return results;
  }

  getAllSections(): Set<string> {
    const allSections = new Set<string>();
    for (const [_, fileIndex] of this.index) {
      for (const sectionName of fileIndex.sections.keys()) {
        allSections.add(sectionName);
      }
    }
    return allSections;
  }

  /**
   * 获取注册列表中的所有值
   * @param registerName 注册列表节名（如 "WeaponTypes", "InfantryTypes"）
   * @returns 注册列表中的所有值数组
   */
  getRegisteredValues(registerName: string): string[] {
    const values: string[] = [];
    
    // 从所有文件的注册列表缓存中收集值
    for (const [_, fileIndex] of this.index) {
      const registerValues = fileIndex.registers.get(registerName);
      if (registerValues) {
        for (const value of registerValues) {
          if (!values.includes(value)) {
            values.push(value);
          }
        }
      }
    }
    
    return values;
  }

  clear(): void {
    this.index.clear();
  }
}
