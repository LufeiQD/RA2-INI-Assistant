/**
 * 类型推断工具
 * 根据节名和键名推断节的类型（infantry, weapon, projectile等）
 */

import { Translations } from "../types";
import { IniIndexManager } from "../indexManager";

export class TypeInference {
  private translations: Translations;
  private indexManager: IniIndexManager;

  constructor(translations: Translations, indexManager: IniIndexManager) {
    this.translations = translations;
    this.indexManager = indexManager;
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
    const typeMapping = this.translations.typeMapping;

    // 遍历所有类型映射
    for (const [typeName, config] of Object.entries(typeMapping)) {
      // 1. 检查是否在注册列表中
      if (this.isInRegisterList(sectionName, config.registers)) {
        return typeName;
      }

      // 2. 检查是否被相关键引用（如 ElitePrimary=wuqi，wuqi被weapon类型的键引用）
      const references = this.indexManager.findSectionReferences(sectionName);
      for (const ref of references) {
        // 检查引用的键名是否在该类型的keys列表中
        if (config.keys.includes(ref.key)) {
          return typeName;
        }
      }
    }

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
   * 获取指定键的翻译（带类型推断）
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
    // 1. 推断当前节的类型
    const sectionType = this.inferSectionType(sectionName);

    // 2. 如果有键值，检查是否是引用类型的键
    let targetType = sectionType;
    if (keyValue && sectionType) {
      const config = this.translations.typeMapping[sectionType];
      if (config?.referToKeys && config.referToKeys[key]) {
        // 这个键指向另一个类型（如weapon的Projectile指向projectile类型）
        targetType = config.referToKeys[key];
      }
    }

    // 3. 从对应类型的翻译中查找
    if (targetType && this.translations.typeTranslations[targetType]) {
      const translation = this.translations.typeTranslations[targetType][key];
      if (translation) {
        return translation;
      }
    }

    // 4. fallback到common
    return this.translations.common[key];
  }

  /**
   * 检查节名是否在指定的注册列表中
   */
  private isInRegisterList(
    sectionName: string,
    registerLists: string[]
  ): boolean {
    // 从indexManager中读取实际的注册列表内容
    for (const registerName of registerLists) {
      const registerSection = this.indexManager.findSectionDefinitions(registerName);
      if (registerSection.length > 0) {
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
