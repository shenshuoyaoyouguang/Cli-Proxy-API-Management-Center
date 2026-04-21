import { useEffect, useMemo, useState } from 'react';
import { authFilesApi } from '@/services/api/authFiles';
import type { OAuthModelAlias } from '@/types/oauth';
import { buildModelAliasReverseMap, resolveOriginalModelName } from '@/utils/usageAliasResolver';

export interface ModelAliasState {
  modelAlias: OAuthModelAlias;
  aliasReverseMap: Map<string, string>;
  resolveModelName: (modelName: string) => string;
  loading: boolean;
  error: boolean;
  hasAliases: boolean;
}

/**
 * 获取 OAuth 模型别名反向映射
 * 用于将 usage 数据中的别名模型名解析为原始模型名
 */
export function useModelAliasReverseMap(): ModelAliasState {
  const [modelAlias, setModelAlias] = useState<OAuthModelAlias>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(false);
      try {
        const data = await authFilesApi.getOauthModelAlias();
        if (!cancelled) {
          setModelAlias(data || {});
        }
      } catch (e) {
        if (!cancelled) {
          setError(true);
          setModelAlias({});
          console.warn('[ModelAlias] Failed to load model aliases, falling back to no mapping', e);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  // 构建反向映射表
  const aliasReverseMap = useMemo(() => buildModelAliasReverseMap(modelAlias), [modelAlias]);

  // 解析模型名
  const resolveModelName = useMemo(
    () => (modelName: string) => resolveOriginalModelName(modelName, aliasReverseMap),
    [aliasReverseMap]
  );

  const hasAliases = aliasReverseMap.size > 0;

  return {
    modelAlias,
    aliasReverseMap,
    resolveModelName,
    loading,
    error,
    hasAliases,
  };
}
