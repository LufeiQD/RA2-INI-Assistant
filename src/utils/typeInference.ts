/**
 * 类型推断工具 - 带智能缓存和变更追踪
 * 根据节名和键名推断节的类型（infantry, weapon, projectile等）
 */

import {
  Translations,
  IndexChangeEvent,
  TypeInferenceResult,
  TypeInferenceReason,
  TypeInferenceConfidence,
} from "../types";
import { IniIndexManager } from "../indexManager";
import * as vscode from "vscode";

/**
 * 缓存条目 - 记录推断结果及其依赖
 */
interface CacheEntry<T> {
  value: T;
  globalVersion: number; // 计算时的全局版本号
  affectedSections: Set<string>; // 推断依赖的节名集合
  affectedFiles: Set<string>; // 推断涉及的文件
  timestamp: number; // 缓存时间戳，用于可选的 TTL 策略
}

type IniFileScope = "rules" | "art" | "sound" | "ai" | "other";

type FileScopePatternConfig = {
  rules?: string[];
  art?: string[];
  sound?: string[];
  ai?: string[];
};

type FileScopeWeightConfig = {
  otherBase?: number;
  rulesBase?: number;
  artBase?: number;
  soundBase?: number;
  aiBase?: number;
  sameScopeBonus?: number;
  rulesToSpecialBonus?: number;
};

type PlatformConfig = {
  enabledPlatforms?: string[];
  strictFiltering?: boolean;
};

const DEFAULT_PLATFORM_CONFIG: Required<PlatformConfig> = {
  enabledPlatforms: ["vanilla", "ares", "phobos"],
  strictFiltering: false,
};

const DEFAULT_FILE_SCOPE_PATTERNS: Required<FileScopePatternConfig> = {
  rules: ["rules*.ini", "rulesmd*.ini"],
  art: ["art*.ini", "artmd*.ini"],
  sound: ["sound*.ini", "soundmd*.ini"],
  ai: ["ai*.ini", "aimd*.ini"],
};

const DEFAULT_FILE_SCOPE_WEIGHTS: Required<FileScopeWeightConfig> = {
  otherBase: 8,
  rulesBase: 16,
  artBase: 12,
  soundBase: 9,
  aiBase: 9,
  sameScopeBonus: 4,
  rulesToSpecialBonus: 8,
};

export class TypeInference {
  private translations: Translations;
  private indexManager: IniIndexManager;

  // 缓存系统
  private sectionTypeCache = new Map<string, CacheEntry<string | undefined>>();
  private sectionTypeDetailCache = new Map<string, CacheEntry<TypeInferenceResult>>();
  private keyTypeCache = new Map<string, CacheEntry<string | undefined>>();
  private translationCache = new Map<string, CacheEntry<string | undefined>>();

  // 仅用于调试和诊断
  private lastCacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(translations: Translations, indexManager: IniIndexManager) {
    this.translations = translations;
    this.indexManager = indexManager;

    // 订阅索引变更事件
    this.indexManager.onIndexChange((event) => {
      this.handleIndexChange(event);
    });
  }

  /**
   * 处理索引变更事件，进行精细化缓存失效
   */
  private handleIndexChange(event: IndexChangeEvent): void {
    const changedSectionsSet = new Set(event.changedSections);

    // 1. 清除与变更节相关的缓存
    for (const [key, entry] of this.sectionTypeCache.entries()) {
      // 如果缓存依赖的任何节发生了变化，失效
      if (Array.from(entry.affectedSections).some(s => changedSectionsSet.has(s))) {
        this.sectionTypeCache.delete(key);
        this.lastCacheStats.evictions++;
      }
    }

    for (const [key, entry] of this.sectionTypeDetailCache.entries()) {
      if (Array.from(entry.affectedSections).some(s => changedSectionsSet.has(s))) {
        this.sectionTypeDetailCache.delete(key);
        this.lastCacheStats.evictions++;
      }
    }

    for (const [key, entry] of this.keyTypeCache.entries()) {
      if (Array.from(entry.affectedSections).some(s => changedSectionsSet.has(s))) {
        this.keyTypeCache.delete(key);
        this.lastCacheStats.evictions++;
      }
    }

    for (const [key, entry] of this.translationCache.entries()) {
      if (Array.from(entry.affectedSections).some(s => changedSectionsSet.has(s))) {
        this.translationCache.delete(key);
        this.lastCacheStats.evictions++;
      }
    }
  }

  /**
   * 获取缓存统计（用于诊断）
   */
  getCacheStats() {
    return {
      ...this.lastCacheStats,
      sectionTypeCacheSize: this.sectionTypeCache.size,
      sectionTypeDetailCacheSize: this.sectionTypeDetailCache.size,
      keyTypeCacheSize: this.keyTypeCache.size,
      translationCacheSize: this.translationCache.size,
    };
  }

  /**
   * 清空所有缓存（仅在用户手动触发时）
   */
  clearAllCaches(): void {
    this.sectionTypeCache.clear();
    this.sectionTypeDetailCache.clear();
    this.keyTypeCache.clear();
    this.translationCache.clear();
    this.lastCacheStats = { hits: 0, misses: 0, evictions: 0 };
  }

  getTypeSourcePlatforms(typeName: string | undefined): string[] {
    if (!typeName) {
      return [];
    }
    const config = this.translations.typeMapping[typeName];
    if (!config?.sourcePlatforms || config.sourcePlatforms.length === 0) {
      return [];
    }
    return Array.from(new Set(config.sourcePlatforms.map((tag) => this.normalize(tag))));
  }

  isTypePlatformCompatible(typeName: string | undefined): boolean {
    const sourcePlatforms = this.getTypeSourcePlatforms(typeName);
    const platformCompatibility = this.getPlatformCompatibility(
      sourcePlatforms,
      this.getPlatformConfig()
    );
    return platformCompatibility.compatible;
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  private confidenceByScore(score: number): TypeInferenceConfidence {
    if (score >= 90) {
      return "high";
    }
    if (score >= 50) {
      return "medium";
    }
    if (score > 0) {
      return "low";
    }
    return "unknown";
  }

  private findCaseInsensitiveValue(map: { [key: string]: string } | undefined, key: string): string | undefined {
    if (!map) {
      return undefined;
    }
    if (map[key] !== undefined) {
      return map[key];
    }
    const keyLower = this.normalize(key);
    for (const [k, v] of Object.entries(map)) {
      if (this.normalize(k) === keyLower) {
        return v;
      }
    }
    return undefined;
  }

  private hasCaseInsensitiveKey(map: { [key: string]: string } | undefined, key: string): boolean {
    return this.findCaseInsensitiveValue(map, key) !== undefined;
  }

  private getFileScopePatterns(): Required<FileScopePatternConfig> {
    const configured = vscode.workspace
      .getConfiguration("ini-ra2")
      .get<FileScopePatternConfig>("inferenceFileScopePatterns", DEFAULT_FILE_SCOPE_PATTERNS);

    return {
      rules: configured?.rules?.length ? configured.rules : DEFAULT_FILE_SCOPE_PATTERNS.rules,
      art: configured?.art?.length ? configured.art : DEFAULT_FILE_SCOPE_PATTERNS.art,
      sound: configured?.sound?.length ? configured.sound : DEFAULT_FILE_SCOPE_PATTERNS.sound,
      ai: configured?.ai?.length ? configured.ai : DEFAULT_FILE_SCOPE_PATTERNS.ai,
    };
  }

  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");

    return new RegExp(`^${escaped}$`, "i");
  }

  private getFileScopeWeights(): Required<FileScopeWeightConfig> {
    const configured = vscode.workspace
      .getConfiguration("ini-ra2")
      .get<FileScopeWeightConfig>("inferenceScopeWeights", DEFAULT_FILE_SCOPE_WEIGHTS);

    return {
      otherBase: configured?.otherBase ?? DEFAULT_FILE_SCOPE_WEIGHTS.otherBase,
      rulesBase: configured?.rulesBase ?? DEFAULT_FILE_SCOPE_WEIGHTS.rulesBase,
      artBase: configured?.artBase ?? DEFAULT_FILE_SCOPE_WEIGHTS.artBase,
      soundBase: configured?.soundBase ?? DEFAULT_FILE_SCOPE_WEIGHTS.soundBase,
      aiBase: configured?.aiBase ?? DEFAULT_FILE_SCOPE_WEIGHTS.aiBase,
      sameScopeBonus: configured?.sameScopeBonus ?? DEFAULT_FILE_SCOPE_WEIGHTS.sameScopeBonus,
      rulesToSpecialBonus:
        configured?.rulesToSpecialBonus ?? DEFAULT_FILE_SCOPE_WEIGHTS.rulesToSpecialBonus,
    };
  }

  private matchesAnyPattern(filePath: string, patterns: string[]): boolean {
    const normalized = filePath.replace(/\\/g, "/");
    const fileName = normalized.split("/").pop() || "";
    return patterns.some((pattern) => {
      const regex = this.globToRegex(pattern);
      return regex.test(fileName) || regex.test(normalized);
    });
  }

  private getPlatformConfig(): Required<PlatformConfig> {
    const enabledPlatforms = vscode.workspace
      .getConfiguration("ini-ra2")
      .get<string[]>("enabledPlatforms", DEFAULT_PLATFORM_CONFIG.enabledPlatforms);
    const strictFiltering = vscode.workspace
      .getConfiguration("ini-ra2")
      .get<boolean>("platformStrictFiltering", DEFAULT_PLATFORM_CONFIG.strictFiltering);

    return {
      enabledPlatforms:
        enabledPlatforms && enabledPlatforms.length > 0
          ? enabledPlatforms
          : DEFAULT_PLATFORM_CONFIG.enabledPlatforms,
      strictFiltering,
    };
  }

  private getPlatformCompatibility(
    sourcePlatforms: string[] | undefined,
    platformConfig: Required<PlatformConfig>
  ): { score: number; detail: string; compatible: boolean } {
    if (!sourcePlatforms || sourcePlatforms.length === 0) {
      return {
        score: 0,
        detail: "未标注平台（保留兼容）",
        compatible: true,
      };
    }

    const enabledSet = new Set(platformConfig.enabledPlatforms.map((p) => this.normalize(p)));
    const normalizedSource = sourcePlatforms.map((p) => this.normalize(p));
    const overlaps = normalizedSource.filter((p) => enabledSet.has(p));

    if (overlaps.length > 0) {
      return {
        score: 8,
        detail: `平台匹配: ${overlaps.join(", ")}`,
        compatible: true,
      };
    }

    return {
      score: -24,
      detail: `平台不匹配: source=${sourcePlatforms.join("/")}, enabled=${platformConfig.enabledPlatforms.join("/")}`,
      compatible: false,
    };
  }

  private detectFileScope(filePath?: string): IniFileScope {
    if (!filePath) {
      return "other";
    }

    const patterns = this.getFileScopePatterns();
    if (this.matchesAnyPattern(filePath, patterns.rules)) {
      return "rules";
    }
    if (this.matchesAnyPattern(filePath, patterns.art)) {
      return "art";
    }
    if (this.matchesAnyPattern(filePath, patterns.sound)) {
      return "sound";
    }
    if (this.matchesAnyPattern(filePath, patterns.ai)) {
      return "ai";
    }
    return "other";
  }

  private getReferenceScopeScore(sectionScope: IniFileScope, refFilePath: string): { score: number; detail: string } {
    const refScope = this.detectFileScope(refFilePath);
    const weights = this.getFileScopeWeights();
    let score = weights.otherBase;

    if (refScope === "rules") {
      score = weights.rulesBase;
    } else if (refScope === "art") {
      score = weights.artBase;
    } else if (refScope === "sound" || refScope === "ai") {
      score = refScope === "sound" ? weights.soundBase : weights.aiBase;
    }

    if (sectionScope !== "other" && refScope === sectionScope) {
      score += weights.sameScopeBonus;
    }

    // art/sound/ai 中的节通常由 rules 系键进行引用定义。
    if ((sectionScope === "art" || sectionScope === "sound" || sectionScope === "ai") && refScope === "rules") {
      score += weights.rulesToSpecialBonus;
    }

    return { score, detail: `${refScope} -> ${sectionScope}` };
  }

  inferSectionTypeDetailed(sectionName: string, filePath?: string): TypeInferenceResult {
    const cacheKey = `${sectionName}|${filePath ?? ""}`;
    const cached = this.sectionTypeDetailCache.get(cacheKey);
    if (cached) {
      this.lastCacheStats.hits++;
      return cached.value;
    }

    this.lastCacheStats.misses++;

    const affectedSections = new Set<string>();
    const affectedFiles = new Set<string>();
    const sectionScope = this.detectFileScope(filePath);
    const references = this.indexManager.findSectionReferences(sectionName);
    references.forEach((ref) => {
      affectedSections.add(ref.section);
      affectedFiles.add(ref.file);
    });

    let bestType: string | undefined;
    let bestScore = 0;
    let bestReasons: TypeInferenceReason[] = [];
    let bestCandidateRegisters: string[] = [];
    const platformConfig = this.getPlatformConfig();

    for (const [typeName, config] of Object.entries(this.translations.typeMapping)) {
      let score = 0;
      const reasons: TypeInferenceReason[] = [];

      const platformCompatibility = this.getPlatformCompatibility(config.sourcePlatforms, platformConfig);
      if (platformConfig.strictFiltering && !platformCompatibility.compatible) {
        continue;
      }
      if (platformCompatibility.score !== 0 || config.sourcePlatforms?.length) {
        score += platformCompatibility.score;
        reasons.push({
          strategy: "platform-compat",
          detail: platformCompatibility.detail,
          score: platformCompatibility.score,
        });
      }

      if (this.isInRegisterList(sectionName, config.registers, affectedSections, affectedFiles)) {
        score += 100;
        reasons.push({
          strategy: "register-membership",
          detail: `节 [${sectionName}] 存在于该类型注册列表: ${config.registers.join(", ")}`,
          score: 100,
        });
      }

      const keySet = new Set(config.keys.map((k) => this.normalize(k)));
      const matchedReferenceKeys = new Set<string>();
      const matchedScopeTraces = new Set<string>();
      let scopeWeightedScore = 0;

      for (const ref of references) {
        if (keySet.has(this.normalize(ref.key))) {
          matchedReferenceKeys.add(ref.key);
          const scopeScore = this.getReferenceScopeScore(sectionScope, ref.file);
          scopeWeightedScore += scopeScore.score;
          matchedScopeTraces.add(scopeScore.detail);
        }
      }

      if (matchedReferenceKeys.size > 0) {
        const referenceScore = 20 + Math.min(50, scopeWeightedScore);
        score += referenceScore;
        reasons.push({
          strategy: "reference-key",
          detail: `节 [${sectionName}] 被键引用: ${Array.from(matchedReferenceKeys).join(", ")}`,
          score: referenceScore,
        });

        reasons.push({
          strategy: "file-scope",
          detail: `文件范围加权: ${Array.from(matchedScopeTraces).join(" | ") || "none"}`,
          score: Math.min(25, Math.max(0, referenceScore - 20)),
        });
      }

      if (score > bestScore) {
        bestScore = score;
        bestType = typeName;
        bestReasons = reasons;
        bestCandidateRegisters = [...config.registers];
      }
    }

    let result: TypeInferenceResult;
    if (bestType) {
      result = {
        typeName: bestType,
        confidence: this.confidenceByScore(bestScore),
        reasons: bestReasons,
        candidateRegisters: Array.from(new Set(bestCandidateRegisters)),
      };
    } else {
      result = {
        typeName: undefined,
        confidence: "unknown",
        reasons: [
          {
            strategy: "fallback",
            detail: `未找到 [${sectionName}] 的有效类型线索（注册列表/引用键）`,
            score: 0,
          },
        ],
        candidateRegisters: [],
      };
    }

    const cacheEntry = {
      value: result,
      globalVersion: this.indexManager.getGlobalVersion(),
      affectedSections,
      affectedFiles,
      timestamp: Date.now(),
    };

    this.sectionTypeDetailCache.set(cacheKey, cacheEntry);
    this.sectionTypeCache.set(cacheKey, {
      value: result.typeName,
      globalVersion: cacheEntry.globalVersion,
      affectedSections,
      affectedFiles,
      timestamp: cacheEntry.timestamp,
    });

    return result;
  }

  /**
   * 推断节的类型
   * @param sectionName 节名
   * @param filePath 文件路径（可选，用于多文件索引）
   * @returns 类型名称（如 "weapon", "projectile"）或 undefined
   */
  inferSectionType(
    sectionName: string,
    filePath?: string
  ): string | undefined {
    return this.inferSectionTypeDetailed(sectionName, filePath).typeName;
  }

  /**
   * 通过引用键推断值的类型
   * @param keyName 键名（如 "Primary", "Projectile"）
   * @param value 值（节名）
   * @param currentSectionName 当前节名（可选）
   * @returns 值指向的类型（如 "weapon", "projectile"）
   */
  inferTypeByReferenceKey(
    keyName: string,
    value: string,
    currentSectionName?: string
  ): string | undefined {
    const typeMapping = this.translations.typeMapping;

    // 1. 检查当前节的类型，看是否有referToKeys定义
    if (currentSectionName) {
      const currentType = this.inferSectionType(currentSectionName);
      if (currentType) {
        const config = typeMapping[currentType];
        const referType = this.findCaseInsensitiveValue(config?.referToKeys, keyName);
        if (referType) {
          return referType;
        }
      }
    }

    // 2. 遍历所有类型，检查keys列表
    for (const [typeName, config] of Object.entries(typeMapping)) {
      if (config.keys.some((k) => this.normalize(k) === this.normalize(keyName))) {
        return typeName;
      }
    }

    return undefined;
  }

  /**
   * 获取键所属的实际类型
   * @param key 键名
   * @param sectionName 节名
   * @returns 键所属的类型名称（如 "weapon", "projectile"）或 undefined
   */
  getKeyActualType(key: string, sectionName: string): string | undefined {
    const cacheKey = `${key}|${sectionName}`;

    // 检查缓存
    const cached = this.keyTypeCache.get(cacheKey);
    if (cached) {
      this.lastCacheStats.hits++;
      return cached.value;
    }

    this.lastCacheStats.misses++;
    const affectedSections = new Set<string>();
    const affectedFiles = new Set<string>();

    // 推断当前节的类型
    const sectionType = this.inferSectionType(sectionName);
    affectedSections.add(sectionName);

    if (!sectionType) {
      // 缓存 undefined 结果
      this.keyTypeCache.set(cacheKey, {
        value: undefined,
        globalVersion: this.indexManager.getGlobalVersion(),
        affectedSections,
        affectedFiles,
        timestamp: Date.now(),
      });
      return undefined;
    }

    const config = this.translations.typeMapping[sectionType];
    const typeTranslations = this.translations.typeTranslations[sectionType];

    // 1. 如果键在当前类型中，返回当前类型
    if (this.hasCaseInsensitiveKey(typeTranslations, key)) {
      this.keyTypeCache.set(cacheKey, {
        value: sectionType,
        globalVersion: this.indexManager.getGlobalVersion(),
        affectedSections,
        affectedFiles,
        timestamp: Date.now(),
      });
      return sectionType;
    }

    // 2. 检查是否有 referToKeys 指向其他类型，且键在那个类型中
    if (config?.referToKeys) {
      for (const [refKey, refType] of Object.entries(config.referToKeys)) {
        const refTypeTranslations = this.translations.typeTranslations[refType];
        if (this.hasCaseInsensitiveKey(refTypeTranslations, key)) {
          this.keyTypeCache.set(cacheKey, {
            value: refType,
            globalVersion: this.indexManager.getGlobalVersion(),
            affectedSections,
            affectedFiles,
            timestamp: Date.now(),
          });
          return refType;
        }
      }
    }

    // 缓存 undefined 结果
    this.keyTypeCache.set(cacheKey, {
      value: undefined,
      globalVersion: this.indexManager.getGlobalVersion(),
      affectedSections,
      affectedFiles,
      timestamp: Date.now(),
    });
    return undefined;
  }

  /**
   * 获取指定键的翻译（带类型推断）
   * 支持链式推断：如果当前类型中没有该键，检查是否该类型的某个键引用了其他类型
   * @param key 键名
   * @param sectionName 节名
   * @param keyValue 键对应的值（用于引用链推断）
   * @returns 翻译文本或undefined
   */
  getTranslationWithType(
    key: string,
    sectionName: string,
    keyValue?: string
  ): string | undefined {
    const cacheKey = `${key}|${sectionName}|${keyValue ?? ''}`;

    // 检查缓存
    const cached = this.translationCache.get(cacheKey);
    if (cached) {
      this.lastCacheStats.hits++;
      return cached.value;
    }

    this.lastCacheStats.misses++;
    const affectedSections = new Set<string>();
    const affectedFiles = new Set<string>();

    // 1. 推断当前节的类型
    const sectionType = this.inferSectionType(sectionName);
    affectedSections.add(sectionName);

    if (!sectionType) {
      const result = this.translations.common[key];
      this.translationCache.set(cacheKey, {
        value: result,
        globalVersion: this.indexManager.getGlobalVersion(),
        affectedSections,
        affectedFiles,
        timestamp: Date.now(),
      });
      return result;
    }

    const config = this.translations.typeMapping[sectionType];
    const typeTranslations = this.translations.typeTranslations[sectionType];

    // 2. 先从当前类型的翻译中查找
    const directTypeTranslation = this.findCaseInsensitiveValue(typeTranslations, key);
    if (directTypeTranslation) {
      const result = directTypeTranslation;
      this.translationCache.set(cacheKey, {
        value: result,
        globalVersion: this.indexManager.getGlobalVersion(),
        affectedSections,
        affectedFiles,
        timestamp: Date.now(),
      });
      return result;
    }

    // 3. 如果有 keyValue，尝试推断指向的类型
    const targetTypeByRef = this.findCaseInsensitiveValue(config?.referToKeys, key);
    if (keyValue && targetTypeByRef) {
      const targetType = targetTypeByRef;
      const targetTypeConfig = this.translations.typeMapping[targetType];

      if (targetTypeConfig) {
        // 根据 keyValue（节名）推断目标类型
        const inferredTargetType = this.inferSectionType(keyValue);
        if (inferredTargetType === targetType || inferredTargetType === 'common') {
          affectedSections.add(keyValue);

          // 在目标类型中查找翻译
          const targetTranslations = this.translations.typeTranslations[inferredTargetType || targetType];
          const targetTranslation = this.findCaseInsensitiveValue(targetTranslations, key);
          if (targetTranslation) {
            const result = targetTranslation;
            this.translationCache.set(cacheKey, {
              value: result,
              globalVersion: this.indexManager.getGlobalVersion(),
              affectedSections,
              affectedFiles,
              timestamp: Date.now(),
            });
            return result;
          }
        }
      }
    }

    // 4. 检查是否有 referToKeys 指向其他类型（不依赖 keyValue）
    if (config?.referToKeys) {
      for (const [refKey, refType] of Object.entries(config.referToKeys)) {
        const refTypeTranslations = this.translations.typeTranslations[refType];
        const refTypeTranslation = this.findCaseInsensitiveValue(refTypeTranslations, key);
        if (refTypeTranslation) {
          const result = refTypeTranslation;
          this.translationCache.set(cacheKey, {
            value: result,
            globalVersion: this.indexManager.getGlobalVersion(),
            affectedSections,
            affectedFiles,
            timestamp: Date.now(),
          });
          return result;
        }
      }
    }

    // 5. fallback到common
    const result = this.translations.common[key];
    this.translationCache.set(cacheKey, {
      value: result,
      globalVersion: this.indexManager.getGlobalVersion(),
      affectedSections,
      affectedFiles,
      timestamp: Date.now(),
    });
    return result;
  }

  /**
   * 检查节名是否在指定的注册列表中
   */
  private isInRegisterList(
    sectionName: string,
    registerLists: string[],
    affectedSections?: Set<string>,
    affectedFiles?: Set<string>
  ): boolean {
    const sectionNameLower = this.normalize(sectionName);

    // 从indexManager中读取实际的注册列表内容
    for (const registerName of registerLists) {
      const registerSection = this.indexManager.findSectionDefinitions(registerName);
      if (registerSection.length > 0) {
        // 记录依赖的注册列表节
        if (affectedSections) {
          affectedSections.add(registerName);
          registerSection.forEach(s => affectedFiles?.add(s.file));
        }

        // 获取注册列表节的所有键值对
        const registerValues = this.indexManager.getRegisteredValues(registerName);
        if (registerValues.some((value) => this.normalize(value) === sectionNameLower)) {
          return true;
        }
      }
    }

    return false;
  }
}
