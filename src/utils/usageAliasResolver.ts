/**
 * Usage 别名解析工具
 * 将 OAuth 别名映射和 Provider Config 别名映射反向转换为 alias -> originalName 的查找表
 */

import type { ModelAlias } from '@/types/provider';
import type { OAuthModelAliasEntry } from '@/types/oauth';
import type { UsageDetail } from './usage';

export interface NormalizationDiagnostics {
  totalAliases: number;
  conflicts: string[];
  unmappedModels: Set<string>;
  hitCount: number;
  missCount: number;
}

/**
 * 从 OAuthModelAlias 构建反向映射表
 * 将 alias 映射回 original model name
 *
 * @param modelAlias - provider -> OAuthModelAliasEntry[] 的映射
 * @returns alias -> originalName 的映射表
 */
export function buildModelAliasReverseMap(
  modelAlias: Record<string, OAuthModelAliasEntry[]>
): Map<string, string> {
  const reverseMap = new Map<string, string>();
  const conflicts: string[] = [];

  Object.values(modelAlias).forEach((entries) => {
    if (!Array.isArray(entries)) return;

    entries.forEach((entry) => {
      const name = entry.name?.trim();
      const alias = entry.alias?.trim();

      // 只有当 name 和 alias 都存在且不同时，才建立映射
      if (name && alias && name !== alias) {
        if (reverseMap.has(alias) && reverseMap.get(alias) !== name) {
          conflicts.push(`Alias conflict: ${alias} maps to both ${reverseMap.get(alias)} and ${name}`);
        }
        reverseMap.set(alias, name);
      }
    });
  });

  if (conflicts.length > 0 && import.meta.env.DEV) {
    console.warn('[ModelAlias] Found alias conflicts:', conflicts);
  }

  return reverseMap;
}

/**
 * 解析 usage detail 中的 modelName，应用别名反向映射
 *
 * @param modelName - usage detail 中的 modelName
 * @param aliasReverseMap - 别名反向映射表
 * @returns 原始模型名（如果存在映射）或原始 modelName
 */
export function resolveOriginalModelName(
  modelName: string,
  aliasReverseMap: Map<string, string>
): string {
  if (!modelName) return modelName;
  return aliasReverseMap.get(modelName) ?? modelName;
}

/**
 * 对 UsageDetail 数组应用模型名标准化
 *
 * @param details - usage details 数组
 * @param aliasReverseMap - 别名到原始模型名的反向映射表
 * @param diagnostics - 可选的诊断统计对象
 * @returns 新的 details 数组，其中 __modelName 已被解析
 */
export function normalizeDetailsModelNames(
  details: UsageDetail[],
  aliasReverseMap: Map<string, string>,
  diagnostics?: NormalizationDiagnostics
): UsageDetail[] {
  if (!aliasReverseMap.size) {
    return details;
  }

  return details.map((detail) => {
    const originalModelName = detail.__modelName ?? '';
    const resolvedModelName = aliasReverseMap.get(originalModelName);

    if (diagnostics) {
      if (resolvedModelName) {
        diagnostics.hitCount++;
      } else {
        diagnostics.missCount++;
        diagnostics.unmappedModels.add(originalModelName);
      }
    }

    if (resolvedModelName && resolvedModelName !== originalModelName) {
      return { ...detail, __modelName: resolvedModelName };
    }
    return detail;
  });
}

/**
 * 创建标准化诊断对象
 */
export function createNormalizationDiagnostics(): NormalizationDiagnostics {
  return {
    totalAliases: 0,
    conflicts: [],
    unmappedModels: new Set(),
    hitCount: 0,
    missCount: 0,
  };
}

export interface ProviderAliasSource {
  models?: ModelAlias[];
}

/**
 * 从 Provider Config 中的 models[].alias 构建反向映射表
 * 将 alias 映射回 name（原始模型名）
 *
 * @param providers - 包含 models 字段的 Provider 配置数组
 * @returns alias -> originalName 的映射表
 */
export function buildProviderAliasReverseMap(providers: ProviderAliasSource[]): Map<string, string> {
  const reverseMap = new Map<string, string>();
  const conflicts: string[] = [];

  providers.forEach((provider) => {
    const models = provider.models;
    if (!Array.isArray(models)) return;

    models.forEach((model) => {
      const name = model.name?.trim();
      const alias = model.alias?.trim();

      if (name && alias && alias !== name) {
        if (reverseMap.has(alias) && reverseMap.get(alias) !== name) {
          conflicts.push(`Provider alias conflict: ${alias} maps to both ${reverseMap.get(alias)} and ${name}`);
        }
        reverseMap.set(alias, name);
      }
    });
  });

  if (conflicts.length > 0 && import.meta.env.DEV) {
    console.warn('[ModelAlias] Found provider alias conflicts:', conflicts);
  }

  return reverseMap;
}

/**
 * 合并多个反向映射表，后面的映射优先级更高（覆盖前面的）
 *
 * @param maps - 要合并的反向映射表数组
 * @returns 合并后的反向映射表
 */
export function mergeAliasReverseMaps(...maps: Map<string, string>[]): Map<string, string> {
  const merged = new Map<string, string>();
  maps.forEach((map) => {
    map.forEach((value, key) => {
      merged.set(key, value);
    });
  });
  return merged;
}
