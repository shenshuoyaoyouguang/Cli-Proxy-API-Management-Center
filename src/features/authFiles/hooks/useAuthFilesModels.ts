import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import type { AuthFileModelItem } from '@/features/authFiles/constants';

type ModelsError = 'unsupported' | null;

const MAX_MODELS_CACHE_SIZE = 50;

// Module-level LRU cache for models (survives component remounts, cleared on logout)
const modelsCache = new Map<string, AuthFileModelItem[]>();
const modelsCacheOrder: string[] = [];

/**
 * Clears the models cache. Called on logout to prevent cross-account data leakage.
 */
export function clearModelsCache(): void {
  modelsCache.clear();
  modelsCacheOrder.length = 0;
}

/**
 * Invalidates a specific file's models cache (e.g., after upload/delete/replace).
 */
export function invalidateModelsCacheForFile(fileName: string): void {
  modelsCache.delete(fileName);
  const idx = modelsCacheOrder.indexOf(fileName);
  if (idx !== -1) {
    modelsCacheOrder.splice(idx, 1);
  }
}

export type UseAuthFilesModelsResult = {
  modelsModalOpen: boolean;
  modelsLoading: boolean;
  modelsList: AuthFileModelItem[];
  modelsFileName: string;
  modelsFileType: string;
  modelsError: ModelsError;
  showModels: (item: AuthFileItem) => Promise<void>;
  closeModelsModal: () => void;
};

export function useAuthFilesModels(): UseAuthFilesModelsResult {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [modelsModalOpen, setModelsModalOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsList, setModelsList] = useState<AuthFileModelItem[]>([]);
  const [modelsFileName, setModelsFileName] = useState('');
  const [modelsFileType, setModelsFileType] = useState('');
  const [modelsError, setModelsError] = useState<ModelsError>(null);

  const closeModelsModal = useCallback(() => {
    setModelsModalOpen(false);
  }, []);

  const showModels = useCallback(
    async (item: AuthFileItem) => {
      setModelsFileName(item.name);
      setModelsFileType(item.type || '');
      setModelsList([]);
      setModelsError(null);
      setModelsModalOpen(true);

      const cached = modelsCache.get(item.name);
      if (cached) {
        // Move to end of order array (most recently used)
        const idx = modelsCacheOrder.indexOf(item.name);
        if (idx !== -1) {
          modelsCacheOrder.splice(idx, 1);
        }
        modelsCacheOrder.push(item.name);
        setModelsList(cached);
        setModelsLoading(false);
        return;
      }

      setModelsLoading(true);
      try {
        const models = await authFilesApi.getModelsForAuthFile(item.name);

        // LRU eviction: remove oldest if at capacity
        if (modelsCache.size >= MAX_MODELS_CACHE_SIZE && !modelsCache.has(item.name)) {
          const oldest = modelsCacheOrder.shift();
          if (oldest) {
            modelsCache.delete(oldest);
          }
        }

        modelsCache.set(item.name, models);
        const idx = modelsCacheOrder.indexOf(item.name);
        if (idx !== -1) {
          modelsCacheOrder.splice(idx, 1);
        }
        modelsCacheOrder.push(item.name);
        setModelsList(models);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '';
        if (
          errorMessage.includes('404') ||
          errorMessage.includes('not found') ||
          errorMessage.includes('Not Found')
        ) {
          setModelsError('unsupported');
        } else {
          showNotification(`${t('notification.load_failed')}: ${errorMessage}`, 'error');
        }
      } finally {
        setModelsLoading(false);
      }
    },
    [showNotification, t]
  );

  return {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsError,
    showModels,
    closeModelsModal,
  };
}
