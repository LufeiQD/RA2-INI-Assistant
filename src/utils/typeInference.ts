/**
 * 类型推断工具 - 带智能缓存和变更追踪
 * 根据节名和键名推断节的类型（infantry, weapon, projectile等）
 */

import { Translations, IndexChangeEvent } from "../types";
import { IniIndexManager } from "../indexManager";

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

export class TypeInference {
  private translations: Translations;
  private indexManager: IniIndexManager;

  // 缓存系统
  private sectionTypeCache = new Map<string, CacheEntry<string | undefined>>();
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
      keyTypeCacheSize: this.keyTypeCache.size,
      translationCacheSize: this.translationCache.size,
    };
  }

  /**
   * 清空所有缓存（仅在用户手动触发时）
   */
  clearAllCaches(): void {
    this.sectionTypeCache.clear();
    this.keyTypeCache.clear();
    this.translationCache.clear();
    this.lastCacheStats = { hits: 0, misses: 0, evictions: 0 };
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
    // 构造缓存键
    const cacheKey = `${sectionName}|${filePath ?? ''}`;

    // 检查缓存
    const cached = this.sectionTypeCache.get(cacheKey);
    if (cached) {
      this.lastCacheStats.hits++;
      return cached.value;
    }

    this.lastCacheStats.misses++;

    // 计算推断，并记录依赖信息
    const affectedSections = new Set<string>();
    const affectedFiles = new Set<string>();

    const typeMapping = this.translations.typeMapping;

    // 遍历所有类型映射
    for (const [typeName, config] of Object.entries(typeMapping)) {
      // 1. 检查是否在注册列表中
      if (this.isInRegisterList(sectionName, config.registers, affectedSections, affectedFiles)) {
        // 缓存结果
        this.sectionTypeCache.set(cacheKey, {
          value: typeName,
          globalVersion: this.indexManager.getGlobalVersion(),
          affectedSections,
          affectedFiles,
          timestamp: Date.now(),
        });
        return typeName;
      }

      // 2. 检查是否被相关键引用（如 ElitePrimary=wuqi，wuqi被weapon类型的键引用）
      const references = this.indexManager.findSectionReferences(sectionName);
      for (const ref of references) {
        affectedSections.add(ref.section);
        affectedFiles.add(ref.file);

        // 检查引用的键名是否在该类型的keys列表中
        if (config.keys.includes(ref.key)) {
          // 缓存结果
          this.sectionTypeCache.set(cacheKey, {
            value: typeName,
            globalVersion: this.indexManager.getGlobalVersion(),
            affectedSections,
            affectedFiles,
            timestamp: Date.now(),
          });
          return typeName;
        }
      }
    }

    // 缓存 undefined 结果
    this.sectionTypeCache.set(cacheKey, {
      value: undefined,
      globalVersion: this.indexManager.getGlobalVersion(),
      affectedSections,
      affectedFiles,
      timestamp: Date.now(),
    });
    return undefined;
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
        if (config?.referToKeys && config.referToKeys[keyName]) {
          return config.referToKeys[keyName];
        }
      }
    }

    // 2. 遍历所有类型，检查keys列表
    for (const [typeName, config] of Object.entries(typeMapping)) {
      if (config.keys.includes(keyName)) {
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
    if (typeTranslations && typeTranslations[key]) {
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
        if (refTypeTranslations && refTypeTranslations[key]) {
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
    if (typeTranslations && typeTranslations[key]) {
      const result = typeTranslations[key];
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
    if (keyValue && config?.referToKeys && config.referToKeys[key]) {
      const targetType = config.referToKeys[key];
      const targetTypeConfig = this.translations.typeMapping[targetType];

      if (targetTypeConfig) {
        // 根据 keyValue（节名）推断目标类型
        const inferredTargetType = this.inferSectionType(keyValue);
        if (inferredTargetType === targetType || inferredTargetType === 'common') {
          affectedSections.add(keyValue);

          // 在目标类型中查找翻译
          const targetTranslations = this.translations.typeTranslations[inferredTargetType || targetType];
          if (targetTranslations && targetTranslations[key]) {
            const result = targetTranslations[key];
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
        if (refTypeTranslations && refTypeTranslations[key]) {
          const result = refTypeTranslations[key];
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
        if (registerValues.includes(sectionName)) {
          return true;
        }
      }
    }

    return false;
  }
}
