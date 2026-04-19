/**
 * Model Management Hooks
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  modelsManagementApi,
  type ModelConfig,
  type ModelProvider,
} from '@/services/api/modelsManagement';
import { useNotificationStore } from '@/stores';

export type UseModelsResult = {
  models: ModelConfig[];
  loading: boolean;
  error: string;
  refetch: () => Promise<void>;
};

export type UseCreateModelResult = {
  creating: boolean;
  create: (config: Omit<ModelConfig, 'id'>) => Promise<boolean>;
};

export type UseUpdateModelResult = {
  updating: boolean;
  update: (id: string, config: Partial<ModelConfig>) => Promise<boolean>;
};

export type UseDeleteModelResult = {
  deleting: boolean;
  remove: (id: string) => Promise<boolean>;
};

export type UseModelProvidersResult = {
  providers: ModelProvider[];
  loading: boolean;
  error: string;
  refetch: () => Promise<void>;
};

/**
 * Hook to fetch all models
 */
export function useModels(): UseModelsResult {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refetch = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await modelsManagementApi.list();
      setModels(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('notification.load_failed');
      setError(message);
      showNotification(`${t('notification.load_failed')}: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification, t]);

  // Initial load
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      refetch();
    }
  }, [initialized, refetch]);

  return { models, loading, error, refetch };
}

/**
 * Hook to create a new model
 */
export function useCreateModel(): UseCreateModelResult {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [creating, setCreating] = useState(false);

  const create = useCallback(
    async (config: Omit<ModelConfig, 'id'>): Promise<boolean> => {
      setCreating(true);
      try {
        await modelsManagementApi.create(config);
        showNotification(t('notification.create_success'), 'success');
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        showNotification(`${t('notification.create_failed')}: ${message}`, 'error');
        return false;
      } finally {
        setCreating(false);
      }
    },
    [showNotification, t]
  );

  return { creating, create };
}

/**
 * Hook to update an existing model
 */
export function useUpdateModel(): UseUpdateModelResult {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [updating, setUpdating] = useState(false);

  const update = useCallback(
    async (id: string, config: Partial<ModelConfig>): Promise<boolean> => {
      setUpdating(true);
      try {
        await modelsManagementApi.update(id, config);
        showNotification(t('notification.update_success'), 'success');
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
        return false;
      } finally {
        setUpdating(false);
      }
    },
    [showNotification, t]
  );

  return { updating, update };
}

/**
 * Hook to delete a model
 */
export function useDeleteModel(): UseDeleteModelResult {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [deleting, setDeleting] = useState(false);

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      setDeleting(true);
      try {
        await modelsManagementApi.delete(id);
        showNotification(t('notification.delete_success'), 'success');
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        return false;
      } finally {
        setDeleting(false);
      }
    },
    [showNotification, t]
  );

  return { deleting, remove };
}

/**
 * Hook to fetch model providers
 */
export function useModelProviders(): UseModelProvidersResult {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refetch = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await modelsManagementApi.getProviders();
      setProviders(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('notification.load_failed');
      setError(message);
      showNotification(`${t('notification.load_failed')}: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification, t]);

  // Initial load
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      refetch();
    }
  }, [initialized, refetch]);

  return { providers, loading, error, refetch };
}
