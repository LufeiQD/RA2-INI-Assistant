/**
 * INI 文件索引管理器
 * 负责索引工作区中的 INI 文件，收集节名和引用关系
 */

import * as vscode from "vscode";
import * as path from "path";
import { SectionInfo, FileIndex, IndexChangeEvent } from "./types";

export class IniIndexManager {
  private index: Map<string, FileIndex> = new Map();
  private indexing: boolean = false;
  private outputChannel: vscode.OutputChannel;

  // 版本号系统：用于缓存失效策略
  private globalVersion: number = 0; // 全局版本号
  private fileVersions: Map<string, number> = new Map(); // 文件级版本号
  private sectionVersions: Map<string, number> = new Map(); // 节名级版本号
  private changeListeners: ((changes: IndexChangeEvent) => void)[] = []; // 变更通知监听器

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  /**
   * 订阅索引变更事件
   */
  onIndexChange(listener: (changes: IndexChangeEvent) => void): void {
    this.changeListeners.push(listener);
  }

  /**
   * 获取全局版本号（每次索引变化自增）
   */
  getGlobalVersion(): number {
    return this.globalVersion;
  }

  /**
   * 获取文件的版本号
   */
  getFileVersion(filePath: string): number {
    return this.fileVersions.get(filePath) ?? 0;
  }

  /**
   * 获取节的版本号（当节的定义或引用变化时自增）
   */
  getSectionVersion(sectionName: string): number {
    return this.sectionVersions.get(sectionName) ?? 0;
  }

  /**
   * 获取影响某个节的所有文件版本
   * 返回格式：{filePath: version, ...}
   */
  getAffectedFileVersions(sectionName: string): Map<string, number> {
    const versions = new Map<string, number>();

    // 找节的定义文件
    for (const [filePath, fileIndex] of this.index) {
      if (fileIndex.sections.has(sectionName)) {
        versions.set(filePath, this.getFileVersion(filePath));
      }

      // 找引用该节的文件
      if (fileIndex.references.has(sectionName)) {
        versions.set(filePath, this.getFileVersion(filePath));
      }
    }

    return versions;
  }

  /**
   * 发送索引变更通知
   */
  private notifyChanges(event: IndexChangeEvent): void {
    for (const listener of this.changeListeners) {
      listener(event);
    }
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

      // 记录旧索引（用于计算变更）
      const oldFileIndex = this.index.get(uri.fsPath);
      const oldSections = new Set(oldFileIndex?.sections.keys() ?? []);
      const oldReferences = new Map(oldFileIndex?.references ?? new Map());
      const oldRegisters = new Map(oldFileIndex?.registers ?? new Map());

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

      // 计算变更并更新版本号
      this.recordFileChanges(uri.fsPath, {
        oldSections,
        newSections: new Set(sections.keys()),
        oldReferences,
        newReferences: references,
        oldRegisters,
        newRegisters: registers,
      });

    } catch (error) {
      this.outputChannel.appendLine(`索引文件失败: ${uri.fsPath} - ${error}`);
    }
  }

  /**
   * 计算并记录文件变更，更新版本号
   */
  private recordFileChanges(
    filePath: string,
    changes: {
      oldSections: Set<string>;
      newSections: Set<string>;
      oldReferences: Map<string, any[]>;
      newReferences: Map<string, any[]>;
      oldRegisters: Map<string, string[]>;
      newRegisters: Map<string, string[]>;
    }
  ): void {
    const changedSections = new Set<string>();

    // 检测节级变化
    const { oldSections, newSections, oldReferences, newReferences, oldRegisters, newRegisters } = changes;

    // 1. 删除的节
    for (const sectionName of oldSections) {
      if (!newSections.has(sectionName)) {
        changedSections.add(sectionName);
      }
    }

    // 2. 新增的节
    for (const sectionName of newSections) {
      if (!oldSections.has(sectionName)) {
        changedSections.add(sectionName);
      }
    }

    // 3. 引用关系变化的节
    for (const sectionName of newReferences.keys()) {
      const oldRefs = oldReferences.get(sectionName) ?? [];
      const newRefs = newReferences.get(sectionName) ?? [];
      if (oldRefs.length !== newRefs.length ||
        JSON.stringify(oldRefs) !== JSON.stringify(newRefs)) {
        changedSections.add(sectionName);
      }
    }
    for (const sectionName of oldReferences.keys()) {
      if (!newReferences.has(sectionName)) {
        changedSections.add(sectionName);
      }
    }

    // 4. 注册列表变化
    const allRegisterNames = new Set([
      ...oldRegisters.keys(),
      ...newRegisters.keys(),
    ]);
    for (const registerName of allRegisterNames) {
      const oldReg = oldRegisters.get(registerName) ?? [];
      const newReg = newRegisters.get(registerName) ?? [];
      if (JSON.stringify(oldReg) !== JSON.stringify(newReg)) {
        // 注册列表变化可能影响该列表中的所有节
        for (const registeredSection of new Set([...oldReg, ...newReg])) {
          changedSections.add(registeredSection);
        }
      }
    }

    // 更新版本号
    if (changedSections.size > 0 || !this.fileVersions.has(filePath)) {
      this.globalVersion++;
      this.fileVersions.set(filePath, this.globalVersion);

      // 更新受影响节的版本号
      for (const sectionName of changedSections) {
        this.sectionVersions.set(sectionName, this.globalVersion);
      }

      // 通知监听器
      this.notifyChanges({
        type: 'file-updated',
        filePath,
        changedSections: Array.from(changedSections),
        globalVersion: this.globalVersion,
      });
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
    // 记录被删除的节
    const fileIndex = this.index.get(uri.fsPath);
    if (fileIndex) {
      const deletedSections = Array.from(fileIndex.sections.keys());

      this.index.delete(uri.fsPath);
      this.fileVersions.delete(uri.fsPath);

      // 删除节的版本号，并通知
      this.globalVersion++;
      for (const sectionName of deletedSections) {
        this.sectionVersions.set(sectionName, this.globalVersion);
      }

      this.notifyChanges({
        type: 'file-deleted',
        filePath: uri.fsPath,
        changedSections: deletedSections,
        globalVersion: this.globalVersion,
      });
    }
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
    const targetLower = sectionName.toLowerCase();
    for (const [filePath, fileIndex] of this.index) {
      // 先尝试精确匹配
      let refs = fileIndex.references.get(sectionName);

      // 如未命中，进行不区分大小写的匹配
      if (!refs) {
        for (const key of fileIndex.references.keys()) {
          if (key.toLowerCase() === targetLower) {
            refs = fileIndex.references.get(key);
            break;
          }
        }
      }

      if (refs && refs.length) {
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
    const deletedCount = this.index.size;
    this.index.clear();
    this.fileVersions.clear();
    this.sectionVersions.clear();
    this.globalVersion++;

    if (deletedCount > 0) {
      this.notifyChanges({
        type: 'index-cleared',
        filePath: '',
        changedSections: [],
        globalVersion: this.globalVersion,
      });
    }
  }

  getStats(): {
    files: number;
    sections: number;
    references: number;
    registers: number;
    globalVersion: number;
  } {
    let sections = 0;
    let references = 0;
    let registers = 0;

    for (const [, fileIndex] of this.index) {
      sections += fileIndex.sections.size;
      registers += fileIndex.registers.size;
      for (const [, refs] of fileIndex.references) {
        references += refs.length;
      }
    }

    return {
      files: this.index.size,
      sections,
      references,
      registers,
      globalVersion: this.globalVersion,
    };
  }
}
