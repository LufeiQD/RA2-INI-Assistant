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
      registerType: [],
    };
  }

  private normalizePlatformTag(tag: string): string {
    const lower = tag.trim().toLowerCase();
    if (lower === "original" || lower === "vanilla" || lower === "原版") {
      return "vanilla";
    }
    if (lower === "ares") {
      return "ares";
    }
    if (lower === "phobos") {
      return "phobos";
    }
    return lower;
  }

  private getExistingTypePlatforms(typeName: string): Set<string> {
    const config = this.translations.typeMapping[typeName];
    if (!config?.sourcePlatforms) {
      return new Set<string>();
    }
    return new Set(config.sourcePlatforms.map((tag) => this.normalizePlatformTag(tag)));
  }

  private asyncReferencePath(): string {
    const possiblePaths = [
      path.join(this.extensionPath, "dist", "assets", "unified-ini-reference.json"),
      path.join(this.extensionPath, "assets", "unified-ini-reference.json"),
      path.join(this.extensionPath, "out", "assets", "unified-ini-reference.json"),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return "";
  }

  private applyTypePlatformsFromReference(): void {
    const enabled = vscode.workspace
      .getConfiguration("ini-ra2")
      .get<boolean>("autoInferTypePlatformsFromReference", true);
    if (!enabled) {
      return;
    }

    const referencePath = this.asyncReferencePath();
    if (!referencePath) {
      return;
    }

    try {
      const referenceData = JSON.parse(fs.readFileSync(referencePath, "utf8")) as {
        index?: Array<{ key?: string; platform?: string; platformLabel?: string }>;
      };
      const items = referenceData.index || [];
      if (items.length === 0) {
        return;
      }

      const platformByKey = new Map<string, Set<string>>();
      for (const item of items) {
        const key = item.key?.trim();
        if (!key) {
          continue;
        }
        const normalizedKey = key.toLowerCase();
        const rawPlatform = item.platform || item.platformLabel || "";
        const normalizedPlatform = rawPlatform
          ? this.normalizePlatformTag(rawPlatform)
          : "";

        if (!normalizedPlatform) {
          continue;
        }

        if (!platformByKey.has(normalizedKey)) {
          platformByKey.set(normalizedKey, new Set<string>());
        }
        platformByKey.get(normalizedKey)!.add(normalizedPlatform);
      }

      for (const [typeName, config] of Object.entries(this.translations.typeMapping)) {
        const mergedPlatforms = this.getExistingTypePlatforms(typeName);
        const candidateKeys = new Set<string>(
          [
            ...(config.keys || []),
            ...Object.keys(this.translations.typeTranslations[typeName] || {}),
          ].map((k) => k.toLowerCase())
        );

        for (const key of candidateKeys) {
          const pset = platformByKey.get(key);
          if (!pset) {
            continue;
          }
          pset.forEach((p) => mergedPlatforms.add(p));
        }

        if (mergedPlatforms.size > 0) {
          config.sourcePlatforms = Array.from(mergedPlatforms);
        }
      }

      this.outputChannel.appendLine("已根据 unified-ini-reference 自动补全类型平台标签");
    } catch (error) {
      this.outputChannel.appendLine(`自动补全类型平台标签失败: ${error}`);
    }
  }

  private applyTypePlatformOverrides(): void {
    const overrides = vscode.workspace
      .getConfiguration("ini-ra2")
      .get<Record<string, string[]>>("typePlatformOverrides", {});

    if (!overrides || Object.keys(overrides).length === 0) {
      return;
    }

    for (const [typeName, rawTags] of Object.entries(overrides)) {
      const config = this.translations.typeMapping[typeName];
      if (!config || !Array.isArray(rawTags)) {
        continue;
      }

      const merged = new Set<string>(
        (config.sourcePlatforms || []).map((tag) => this.normalizePlatformTag(tag))
      );
      rawTags.forEach((tag) => merged.add(this.normalizePlatformTag(tag)));
      config.sourcePlatforms = Array.from(merged);
    }
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

        // 直接合并所有字段，避免硬编码
        this.translations = {
          ...this.translations,
          ...loaded,
          // 特殊处理需要深度合并而非覆盖的字段
          common: { ...this.translations.common, ...loaded.common },
          sections: { ...this.translations.sections, ...loaded.sections },
          values: { ...this.translations.values, ...loaded.values },
        };

        this.applyTypePlatformsFromReference();
        this.applyTypePlatformOverrides();

        const typeCount = Object.keys(this.translations.typeTranslations || {}).length;
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
      registerType: [],
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
