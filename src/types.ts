/**
 * 共享类型定义
 */

import * as vscode from "vscode";

// 类型映射配置
export interface TypeMappingConfig {
  registers: string[]; // 注册列表名称（如 ["InfantryTypes"]）
  keys: string[]; // 引用此类型的键名（如 ["Primary", "Secondary"]）
  referToKeys?: { [key: string]: string }; // 某个键指向的类型（如 {"Projectile": "projectile"}）
}

// 词典数据类型
export interface Translations {
  typeMapping: { [type: string]: TypeMappingConfig };
  common: { [key: string]: string };
  typeTranslations: {
    [typeName: string]: { [key: string]: string };
  };
  sections: { [key: string]: string };
  values: { [key: string]: string };
}

// 节信息
export interface SectionInfo {
  name: string;
  line: number;
  file: string;
}

// 文件索引
export interface FileIndex {
  sections: Map<string, SectionInfo[]>; // 节名 -> 定义位置列表
  references: Map<
    string,
    Array<{ line: number; key: string; value: string; section: string }>
  >; // 节名 -> 引用列表
  registers: Map<string, string[]>; // 注册列表名 -> 注册的节名列表（如 "WeaponTypes" -> ["120mmx2", "Missile", ...]）
  lastModified: number;
  size: number;
}

// 扩展上下文（共享资源）
export interface ExtensionContext {
  diagnosticCollection: vscode.DiagnosticCollection;
  outputChannel: vscode.OutputChannel;
  translations: Translations;
}
