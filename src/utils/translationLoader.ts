/**
 * 翻译文件加载器
 * 负责加载和管理 translations.json 词典数据
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Translations } from "../types";

export class TranslationLoader {
  private translations: Translations;
  private outputChannel: vscode.OutputChannel;
  private extensionPath: string;

  constructor(extensionPath: string, outputChannel: vscode.OutputChannel) {
    this.extensionPath = extensionPath;
    this.outputChannel = outputChannel;
    this.translations = {
      typeMapping: {},
      common: {},
      typeTranslations: {},
      sections: {},
      values: {},
    };
  }

  /**
   * 加载翻译文件
   */
  load(): void {
    let translationFile = "";

    // 尝试多个可能的路径
    const possiblePaths = [
      path.join(this.extensionPath, "dist", "assets", "translations.json"),
      path.join(this.extensionPath, "assets", "translations.json"),
      path.join(this.extensionPath, "out", "assets", "translations.json"),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        translationFile = p;
        break;
      }
    }

    if (translationFile) {
      try {
        const data = fs.readFileSync(translationFile, "utf8");
        const loaded = JSON.parse(data);

        // 加载类型映射配置
        if (loaded.typeMapping) {
          this.translations.typeMapping = loaded.typeMapping;
        }

        // 加载common
        if (loaded.common) {
          this.translations.common = { ...this.translations.common, ...loaded.common };
        }

        // 动态加载所有类型翻译
        if (loaded.typeTranslations) {
          this.translations.typeTranslations = loaded.typeTranslations;
        }

        // 加载sections和values
        if (loaded.sections) {
          this.translations.sections = { ...this.translations.sections, ...loaded.sections };
        }
        if (loaded.values) {
          this.translations.values = { ...this.translations.values, ...loaded.values };
        }

        const typeCount = Object.keys(this.translations.typeTranslations).length;
        let totalKeys = Object.keys(this.translations.common).length;
        for (const type in this.translations.typeTranslations) {
          totalKeys += Object.keys(this.translations.typeTranslations[type]).length;
        }

        this.outputChannel.appendLine(`词典加载成功: ${translationFile}`);
        this.outputChannel.appendLine(
          `可用的词典: ${Object.keys(this.translations.common).length} common, ` +
          `${typeCount} types, 共 ${totalKeys} 个键`
        );
      } catch (error) {
        const errorMsg = "加载词典失败，未找到对应词典文件，请联系作者排查！";
        vscode.window.showErrorMessage(errorMsg);
        this.outputChannel.appendLine(`${errorMsg} - ${error}`);
      }
    } else {
      this.outputChannel.appendLine("未找到词典文件，将使用空数据");
    }
  }

  /**
   * 重新加载翻译文件
   */
  reload(): void {
    // 清空现有数据
    this.translations = {
      typeMapping: {},
      common: {},
      typeTranslations: {},
      sections: {},
      values: {},
    };
    this.load();
  }

  /**
   * 获取翻译数据
   */
  getTranslations(): Translations {
    return this.translations;
  }

  /**
   * 获取指定键的翻译（带类型推断）
   * @param key 键名
   * @param sectionType 节类型（可选，如 "weapon", "projectile"）
   * @returns 翻译文本或undefined
   */
  getTranslation(key: string, sectionType?: string): string | undefined {
    // 1. 如果指定了类型，先从该类型中查找
    if (sectionType && this.translations.typeTranslations[sectionType]) {
      const translation = this.translations.typeTranslations[sectionType][key];
      if (translation) {
        return translation;
      }
    }

    // 2. fallback到common
    return this.translations.common[key];
  }
}
