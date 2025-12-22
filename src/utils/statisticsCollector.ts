/**
 * 配置统计收集器
 * 负责收集当前文件和工作区的统计信息
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { IniIndexManager } from "../indexManager";

export interface FileStatistics {
  totalSections: number;
  totalKeys: number;
  duplicateKeys: number;
  invalidReferences: number;
  duplicateList: Array<{ key: string; lines: number[] }>;
  invalidRefList: Array<{ key: string; value: string; line: number }>;
}

export interface WorkspaceStatistics {
  totalFiles: number;
  totalSections: number;
  sectionsByType: Map<string, number>;
  totalReferences: number;
}

export class StatisticsCollector {
  private indexManager: IniIndexManager;
  private outputChannel: vscode.OutputChannel;

  constructor(indexManager: IniIndexManager, outputChannel: vscode.OutputChannel) {
    this.indexManager = indexManager;
    this.outputChannel = outputChannel;
  }

  /**
   * 收集当前文件的统计信息
   */
  async collectFileStatistics(document: vscode.TextDocument): Promise<FileStatistics> {
    const text = document.getText();
    const lines = text.split("\n");

    let totalSections = 0;
    let currentSection = "";
    const sectionKeyCount = new Map<string, Map<string, number[]>>(); // 节名 -> (键名 -> 行号列表)

    // 扫描文件：收集每个节内的键
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();

      // 跳过空行和整行注释
      if (!line || line.startsWith(";") || line.startsWith("#") || line.startsWith("//")) {
        continue;
      }

      // 检测节名
      const sectionMatch = line.match(/^\[\s*([^\]]+)\s*\]/);
      if (sectionMatch) {
        totalSections++;
        currentSection = sectionMatch[1].trim();
        if (!sectionKeyCount.has(currentSection)) {
          sectionKeyCount.set(currentSection, new Map<string, number[]>());
        }
        continue;
      }

      // 检测键值对
      const equalsIndex = line.indexOf("=");
      if (equalsIndex > 0 && currentSection) {
        // 跳过追加语法 (+=) 的行，不计入重复统计
        if (line.includes("+=")) {
          continue;
        }

        let key = line.substring(0, equalsIndex).trim().toLowerCase();

        const keyMap = sectionKeyCount.get(currentSection)!;
        if (!keyMap.has(key)) {
          keyMap.set(key, []);
        }
        keyMap.get(key)!.push(i + 1); // 1-based line number
      }
    }

    // 统计重复的键（只统计当前文件中同一节内出现多次的键）
    const duplicateList: Array<{ key: string; lines: number[] }> = [];
    let duplicateCount = 0;

    for (const [sectionName, keyMap] of sectionKeyCount.entries()) {
      for (const [key, lineNumbers] of keyMap.entries()) {
        if (lineNumbers.length > 1) {
          duplicateCount++;
          duplicateList.push({ key, lines: lineNumbers });
        }
      }
    }

    // 统计总键数（每个键在每个节中计算一次）
    let totalKeys = 0;
    for (const keyMap of sectionKeyCount.values()) {
      totalKeys += keyMap.size;
    }

    return {
      totalSections,
      totalKeys,
      duplicateKeys: duplicateCount,
      invalidReferences: 0, // 移除无效引用检测
      duplicateList,
      invalidRefList: [],
    };
  }

  /**
   * 收集工作区统计信息
   */
  async collectWorkspaceStatistics(): Promise<WorkspaceStatistics> {
    const allSections = this.indexManager.getAllSections();
    const sectionsByType = new Map<string, number>();

    // 根据节的常见后缀推断类型
    const typePatterns = {
      weapon: /Types$/,
      projectile: /Projectile/i,
      warhead: /Warhead/i,
      infantry: /Infantry/i,
      building: /Building/i,
      aircraft: /Aircraft/i,
      animation: /Anim/i,
      particle: /Particle/i,
      voxelanim: /VoxelAnim/i,
    };

    for (const section of allSections) {
      let classified = false;
      for (const [type, pattern] of Object.entries(typePatterns)) {
        if (pattern.test(section)) {
          sectionsByType.set(type, (sectionsByType.get(type) ?? 0) + 1);
          classified = true;
          break;
        }
      }
      if (!classified) {
        sectionsByType.set("other", (sectionsByType.get("other") ?? 0) + 1);
      }
    }

    // 统计文件数（从索引管理器获取）
    const files = await vscode.workspace.findFiles(
      "**/*.ini",
      "**/node_modules/**"
    );
    const relatedFiles = vscode.workspace
      .getConfiguration("ini-ra2")
      .get<string[]>("relatedFiles", [
        "rulesmd.ini",
        "artmd.ini",
        "soundmd.ini",
        "aimd.ini",
      ]);

    const filteredFiles = files.filter((file) => {
      const fileName = path.basename(file.fsPath).toLowerCase();
      return relatedFiles.some((pattern) => {
        const lowerPattern = pattern.toLowerCase();
        if (lowerPattern.includes("*")) {
          const regex = new RegExp(
            "^" + lowerPattern.replace(/\*/g, ".*") + "$"
          );
          return regex.test(fileName);
        }
        return fileName === lowerPattern;
      });
    });

    return {
      totalFiles: filteredFiles.length,
      totalSections: allSections.size,
      sectionsByType,
      totalReferences: 0, // 可选统计
    };
  }
}
