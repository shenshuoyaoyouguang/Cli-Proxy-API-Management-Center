import { useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { apiClient } from '@/services/api/client';
import { useAccountHealthStore, useNotificationStore } from '@/stores';
import { useAuthStore } from '@/stores/useAuthStore';
import type { AuthFileItem } from '@/types';
import { formatFileSize } from '@/utils/format';
import { MAX_AUTH_FILE_SIZE } from '@/utils/constants';
import { downloadBlob } from '@/utils/download';
import { buildScopeKey } from '@/utils/helpers';
import {
  clearRecoveredAuthFileState,
  getAuthFileErrorStatusLabel,
  getAuthFileHealthStateLabel,
  getTypeLabel,
  hasFailedAccountState,
  isRuntimeOnlyAuthFile,
  matchesErrorStatus,
  matchesHealthState,
  type AuthFileHealthStateValue,
} from '@/features/authFiles/constants';
import { invalidateModelsCacheForFile } from './useAuthFilesModels';
import { invalidateAuthFilesMapCache } from '@/components/usage/hooks/useAuthFilesMap';

type DeleteAllOptions = {
  filter: string;
  problemOnly: boolean;
  errorStatuses: string[];
  healthStates: AuthFileHealthStateValue[];
  onResetFilterToAll: () => void;
  onResetProblemOnly: () => void;
  onResetErrorStatuses: () => void;
  onResetHealthStates: () => void;
};

export type UseAuthFilesDataResult = {
  files: AuthFileItem[];
  selectedFiles: Set<string>;
  selectionCount: number;
  loading: boolean;
  error: string;
  uploading: boolean;
  deleting: string | null;
  deletingAll: boolean;
  statusUpdating: Record<string, boolean>;
  batchStatusUpdating: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  loadFiles: () => Promise<void>;
  handleUploadClick: () => void;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleDelete: (name: string) => void;
  handleDeleteAll: (options: DeleteAllOptions) => void;
  handleDownload: (name: string) => Promise<void>;
  handleStatusToggle: (item: AuthFileItem, enabled: boolean) => Promise<void>;
  toggleSelect: (name: string) => void;
  selectAllVisible: (visibleFiles: AuthFileItem[]) => void;
  invertVisibleSelection: (visibleFiles: AuthFileItem[]) => void;
  deselectAll: () => void;
  batchDownload: (names: string[]) => Promise<void>;
  batchSetStatus: (names: string[], enabled: boolean) => Promise<void>;
  batchDelete: (names: string[]) => void;
  clearRecoveredFiles: (names: string[]) => void;
};

export type UseAuthFilesDataOptions = {
  refreshKeyStats: () => Promise<void>;
};

const describeDeleteTarget = (
  t: ReturnType<typeof useTranslation>['t'],
  options: Pick<DeleteAllOptions, 'filter' | 'problemOnly' | 'errorStatuses' | 'healthStates'>
) => {
  const { filter, problemOnly, errorStatuses, healthStates } = options;
  const hasTypeFilter = filter !== 'all';
  const hasErrorFilter = errorStatuses.length > 0;
  const hasHealthFilter = healthStates.length > 0;

  if (!hasTypeFilter && !problemOnly && !hasErrorFilter && !hasHealthFilter) {
    return t('auth_files.filter_all');
  }

  if (!hasTypeFilter && problemOnly && !hasErrorFilter && !hasHealthFilter) {
    return t('auth_files.filter_failed_accounts');
  }

  if (!hasTypeFilter && !problemOnly && errorStatuses.length === 1 && !hasHealthFilter) {
    return getAuthFileErrorStatusLabel(t, errorStatuses[0]);
  }

  if (!hasTypeFilter && !problemOnly && !hasErrorFilter && healthStates.length === 1) {
    return getAuthFileHealthStateLabel(t, healthStates[0]);
  }

  if (hasTypeFilter && !problemOnly && !hasErrorFilter && !hasHealthFilter) {
    return getTypeLabel(t, filter);
  }

  return t('auth_files.filtered_results');
};

export function useAuthFilesData(options: UseAuthFilesDataOptions): UseAuthFilesDataResult {
  const { refreshKeyStats } = options;
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const healthMap = useAccountHealthStore((state) => state.healthMap);
  const removeHealthAccounts = useAccountHealthStore((state) => state.removeAccounts);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const authFilesScopeKey = apiBase && managementKey ? buildScopeKey(apiBase, managementKey) : '';

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<Record<string, boolean>>({});
  const [batchStatusUpdating, setBatchStatusUpdating] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const batchStatusPendingRef = useRef(false);
  const selectionCount = selectedFiles.size;
  const toggleSelect = useCallback((name: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const selectAllVisible = useCallback((visibleFiles: AuthFileItem[]) => {
    const nextSelected = visibleFiles
      .filter((file) => !isRuntimeOnlyAuthFile(file))
      .map((file) => file.name);
    if (nextSelected.length === 0) return;
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      nextSelected.forEach((name) => next.add(name));
      return next;
    });
  }, []);

  const invertVisibleSelection = useCallback((visibleFiles: AuthFileItem[]) => {
    const visibleNames = visibleFiles
      .filter((file) => !isRuntimeOnlyAuthFile(file))
      .map((file) => file.name);
    if (visibleNames.length === 0) return;

    setSelectedFiles((prev) => {
      const next = new Set(prev);
      visibleNames.forEach((name) => {
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
      });
      return next;
    });
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  useEffect(() => {
    if (selectedFiles.size === 0) return;
    const existingNames = new Set(files.map((file) => file.name));
    setSelectedFiles((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((name) => {
        if (existingNames.has(name)) {
          next.add(name);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [files, selectedFiles.size]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const clearRecoveredFiles = useCallback((names: string[]) => {
    const normalizedNames = new Set(
      names
        .map((name) => String(name ?? '').trim())
        .filter(Boolean)
    );
    if (normalizedNames.size === 0) {
      return;
    }
    setFiles((prev) =>
      prev.map((file) => (normalizedNames.has(file.name) ? clearRecoveredAuthFileState(file) : file))
    );
  }, []);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;
      if (!fileList || fileList.length === 0) return;

      const filesToUpload = Array.from(fileList);
      const validFiles: File[] = [];
      const invalidFiles: string[] = [];
      const oversizedFiles: string[] = [];

      filesToUpload.forEach((file) => {
        if (!file.name.endsWith('.json')) {
          invalidFiles.push(file.name);
          return;
        }
        if (file.size > MAX_AUTH_FILE_SIZE) {
          oversizedFiles.push(file.name);
          return;
        }
        validFiles.push(file);
      });

      if (invalidFiles.length > 0) {
        showNotification(t('auth_files.upload_error_json'), 'error');
      }
      if (oversizedFiles.length > 0) {
        showNotification(
          t('auth_files.upload_error_size', { maxSize: formatFileSize(MAX_AUTH_FILE_SIZE) }),
          'error'
        );
      }

      if (validFiles.length === 0) {
        event.target.value = '';
        return;
      }

      setUploading(true);
      let successCount = 0;
      const uploadedNames: string[] = [];
      const failed: { name: string; message: string }[] = [];

      for (const file of validFiles) {
        try {
          await authFilesApi.upload(file);
          successCount++;
          uploadedNames.push(file.name);
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          failed.push({ name: file.name, message: errorMessage });
        }
      }

      if (successCount > 0) {
        const suffix = validFiles.length > 1 ? ` (${successCount}/${validFiles.length})` : '';
        showNotification(
          `${t('auth_files.upload_success')}${suffix}`,
          failed.length ? 'warning' : 'success'
        );
        invalidateAuthFilesMapCache(authFilesScopeKey);
        removeHealthAccounts(uploadedNames);
        await loadFiles();
        await refreshKeyStats();
        // Invalidate models cache for uploaded files
        uploadedNames.forEach((name) => invalidateModelsCacheForFile(name));
      }

      if (failed.length > 0) {
        const details = failed.map((item) => `${item.name}: ${item.message}`).join('; ');
        showNotification(`${t('notification.upload_failed')}: ${details}`, 'error');
      }

      setUploading(false);
      event.target.value = '';
    },
    [authFilesScopeKey, loadFiles, refreshKeyStats, removeHealthAccounts, showNotification, t]
  );

  const handleDelete = useCallback(
    (name: string) => {
      showConfirmation({
        title: t('auth_files.delete_title', { defaultValue: 'Delete File' }),
        message: `${t('auth_files.delete_confirm')} "${name}" ?`,
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          setDeleting(name);
          try {
            await authFilesApi.deleteFile(name);
            showNotification(t('auth_files.delete_success'), 'success');
            invalidateAuthFilesMapCache(authFilesScopeKey);
            setFiles((prev) => prev.filter((item) => item.name !== name));
            removeHealthAccounts([name]);
            setSelectedFiles((prev) => {
              if (!prev.has(name)) return prev;
              const next = new Set(prev);
              next.delete(name);
              return next;
            });
            // Invalidate models cache for deleted file
            invalidateModelsCacheForFile(name);
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
          } finally {
            setDeleting(null);
          }
        },
      });
    },
    [authFilesScopeKey, removeHealthAccounts, showConfirmation, showNotification, t]
  );

  const handleDeleteAll = useCallback(
    (deleteAllOptions: DeleteAllOptions) => {
      const {
        filter,
        problemOnly,
        errorStatuses,
        healthStates,
        onResetFilterToAll,
        onResetProblemOnly,
        onResetErrorStatuses,
        onResetHealthStates,
      } = deleteAllOptions;
      const hasTypeFilter = filter !== 'all';
      const hasProblemFilter = problemOnly === true;
      const hasErrorFilter = errorStatuses.length > 0;
      const hasHealthFilter = healthStates.length > 0;
      const hasScopedFilter = hasTypeFilter || hasProblemFilter || hasErrorFilter || hasHealthFilter;
      const deleteTarget = describeDeleteTarget(t, {
        filter,
        problemOnly,
        errorStatuses,
        healthStates,
      });
      const confirmMessage = hasScopedFilter
        ? t('auth_files.delete_filtered_confirm_generic', { target: deleteTarget })
        : t('auth_files.delete_all_confirm');

      showConfirmation({
        title: t('auth_files.delete_all_title', { defaultValue: 'Delete All Files' }),
        message: confirmMessage,
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          setDeletingAll(true);
          try {
            if (!hasScopedFilter) {
              const deletedNames = files
                .filter((file) => !isRuntimeOnlyAuthFile(file))
                .map((file) => file.name);
              await authFilesApi.deleteAll();
              showNotification(t('auth_files.delete_all_success'), 'success');
              invalidateAuthFilesMapCache(authFilesScopeKey);
              setFiles((prev) => prev.filter((file) => isRuntimeOnlyAuthFile(file)));
              removeHealthAccounts(deletedNames);
              deselectAll();
            } else {
              const filesToDelete = files.filter((file) => {
                if (isRuntimeOnlyAuthFile(file)) return false;
                if (hasTypeFilter && file.type !== filter) return false;
                if (hasProblemFilter && !hasFailedAccountState(file, healthMap)) return false;
                if (!matchesErrorStatus(file, errorStatuses, healthMap)) return false;
                if (!matchesHealthState(file, healthStates, healthMap)) return false;
                return true;
              });

              if (filesToDelete.length === 0) {
                showNotification(
                  t('auth_files.delete_filtered_none_generic', { target: deleteTarget }),
                  'info'
                );
                setDeletingAll(false);
                return;
              }

              let success = 0;
              let failed = 0;
              const deletedNames: string[] = [];

              for (const file of filesToDelete) {
                try {
                  await authFilesApi.deleteFile(file.name);
                  success++;
                  deletedNames.push(file.name);
                } catch {
                  failed++;
                }
              }

              setFiles((prev) => prev.filter((f) => !deletedNames.includes(f.name)));
              invalidateAuthFilesMapCache(authFilesScopeKey);
              removeHealthAccounts(deletedNames);
              setSelectedFiles((prev) => {
                if (prev.size === 0) return prev;
                const deletedSet = new Set(deletedNames);
                let changed = false;
                const next = new Set<string>();
                prev.forEach((name) => {
                  if (deletedSet.has(name)) {
                    changed = true;
                  } else {
                    next.add(name);
                  }
                });
                return changed ? next : prev;
              });

              if (failed === 0) {
                showNotification(
                  t('auth_files.delete_filtered_success_generic', {
                    count: success,
                    target: deleteTarget,
                  }),
                  'success'
                );
              } else {
                showNotification(
                  t('auth_files.delete_filtered_partial_generic', {
                    success,
                    failed,
                    target: deleteTarget,
                  }),
                  'warning'
                );
              }

              if (hasTypeFilter) {
                onResetFilterToAll();
              }
              if (hasProblemFilter) {
                onResetProblemOnly();
              }
              if (hasErrorFilter) {
                onResetErrorStatuses();
              }
              if (hasHealthFilter) {
                onResetHealthStates();
              }
            }
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
          } finally {
            setDeletingAll(false);
          }
        },
      });
    },
    [
      authFilesScopeKey,
      deselectAll,
      files,
      healthMap,
      removeHealthAccounts,
      showConfirmation,
      showNotification,
      t,
    ]
  );

  const handleDownload = useCallback(
    async (name: string) => {
      try {
        const response = await apiClient.getRaw(
          `/auth-files/download?name=${encodeURIComponent(name)}`,
          { responseType: 'blob' }
        );
        const blob = new Blob([response.data]);
        downloadBlob({ filename: name, blob });
        showNotification(t('auth_files.download_success'), 'success');
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        showNotification(`${t('notification.download_failed')}: ${errorMessage}`, 'error');
      }
    },
    [showNotification, t]
  );

  const handleStatusToggle = useCallback(
    async (item: AuthFileItem, enabled: boolean) => {
      const name = item.name;
      const nextDisabled = !enabled;
      const previousDisabled = item.disabled === true;

      setStatusUpdating((prev) => ({ ...prev, [name]: true }));
      setFiles((prev) => prev.map((f) => (f.name === name ? { ...f, disabled: nextDisabled } : f)));

      try {
        const res = await authFilesApi.setStatus(name, nextDisabled);
        setFiles((prev) =>
          prev.map((f) => (f.name === name ? { ...f, disabled: res.disabled } : f))
        );
        showNotification(
          enabled
            ? t('auth_files.status_enabled_success', { name })
            : t('auth_files.status_disabled_success', { name }),
          'success'
        );
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        setFiles((prev) =>
          prev.map((f) => (f.name === name ? { ...f, disabled: previousDisabled } : f))
        );
        showNotification(`${t('notification.update_failed')}: ${errorMessage}`, 'error');
      } finally {
        setStatusUpdating((prev) => {
          if (!prev[name]) return prev;
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }
    },
    [showNotification, t]
  );

  const batchSetStatus = useCallback(
    async (names: string[], enabled: boolean) => {
      if (batchStatusPendingRef.current) return;

      const uniqueNames = Array.from(new Set(names));
      if (uniqueNames.length === 0) return;
      if (uniqueNames.some((name) => statusUpdating[name] === true)) return;

      const originalDisabled = new Map(
        files
          .filter((file) => uniqueNames.includes(file.name))
          .map((file) => [file.name, file.disabled === true])
      );
      const targetNames = new Set(originalDisabled.keys());
      const targetNameList = Array.from(targetNames);
      if (targetNameList.length === 0) return;

      const nextDisabled = !enabled;

      batchStatusPendingRef.current = true;
      setBatchStatusUpdating(true);
      setStatusUpdating((prev) => {
        const next = { ...prev };
        targetNameList.forEach((name) => {
          next[name] = true;
        });
        return next;
      });
        setFiles((prev) =>
          prev.map((file) =>
            targetNames.has(file.name) ? { ...file, disabled: nextDisabled } : file
          )
        );

      try {
        const results = await Promise.allSettled(
          targetNameList.map((name) => authFilesApi.setStatus(name, nextDisabled))
        );

        let successCount = 0;
        let failCount = 0;
        const failedNames = new Set<string>();
        const confirmedDisabled = new Map<string, boolean>();

        results.forEach((result, index) => {
          const name = targetNameList[index];
          if (result.status === 'fulfilled') {
            successCount++;
            confirmedDisabled.set(name, result.value.disabled);
          } else {
            failCount++;
            failedNames.add(name);
          }
        });

        setFiles((prev) =>
          prev.map((file) => {
            if (failedNames.has(file.name)) {
              return { ...file, disabled: originalDisabled.get(file.name) === true };
            }
            if (confirmedDisabled.has(file.name)) {
              return { ...file, disabled: confirmedDisabled.get(file.name) };
            }
            return file;
          })
        );
        invalidateAuthFilesMapCache(authFilesScopeKey);

        if (failCount === 0) {
          showNotification(t('auth_files.batch_status_success', { count: successCount }), 'success');
        } else {
          showNotification(
            t('auth_files.batch_status_partial', { success: successCount, failed: failCount }),
            'warning'
          );
        }

        deselectAll();
      } finally {
        batchStatusPendingRef.current = false;
        setBatchStatusUpdating(false);
        setStatusUpdating((prev) => {
          const next = { ...prev };
          targetNameList.forEach((name) => {
            delete next[name];
          });
          return next;
        });
      }
    },
    [authFilesScopeKey, deselectAll, files, showNotification, statusUpdating, t]
  );

  const batchDownload = useCallback(
    async (names: string[]) => {
      const uniqueNames = Array.from(new Set(names));
      if (uniqueNames.length === 0) return;

      let successCount = 0;
      let failCount = 0;

      for (const name of uniqueNames) {
        try {
          const response = await apiClient.getRaw(
            `/auth-files/download?name=${encodeURIComponent(name)}`,
            { responseType: 'blob' }
          );
          const blob = new Blob([response.data]);
          downloadBlob({ filename: name, blob });
          successCount++;
        } catch {
          failCount++;
        }
      }

      if (failCount === 0) {
        showNotification(
          t('auth_files.batch_download_success', { count: successCount }),
          'success'
        );
      } else {
        showNotification(
          t('auth_files.batch_download_partial', { success: successCount, failed: failCount }),
          'warning'
        );
      }
    },
    [showNotification, t]
  );

  const batchDelete = useCallback(
    (names: string[]) => {
      const uniqueNames = Array.from(new Set(names));
      if (uniqueNames.length === 0) return;

      showConfirmation({
        title: t('auth_files.batch_delete_title'),
        message: t('auth_files.batch_delete_confirm', { count: uniqueNames.length }),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          const results = await Promise.allSettled(
            uniqueNames.map((name) => authFilesApi.deleteFile(name))
          );

          const deleted: string[] = [];
          let failCount = 0;
          results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
              deleted.push(uniqueNames[index]);
            } else {
              failCount++;
            }
          });

          if (deleted.length > 0) {
            const deletedSet = new Set(deleted);
            setFiles((prev) => prev.filter((file) => !deletedSet.has(file.name)));
            invalidateAuthFilesMapCache(authFilesScopeKey);
            removeHealthAccounts(deleted);
          }

          setSelectedFiles((prev) => {
            if (prev.size === 0) return prev;
            const deletedSet = new Set(deleted);
            let changed = false;
            const next = new Set<string>();
            prev.forEach((name) => {
              if (deletedSet.has(name)) {
                changed = true;
              } else {
                next.add(name);
              }
            });
            return changed ? next : prev;
          });

          if (failCount === 0) {
            showNotification(
              `${t('auth_files.delete_all_success')} (${deleted.length})`,
              'success'
            );
          } else {
            showNotification(
              t('auth_files.delete_filtered_partial', {
                success: deleted.length,
                failed: failCount,
                type: t('auth_files.filter_all'),
              }),
              'warning'
            );
          }
        },
      });
    },
    [authFilesScopeKey, removeHealthAccounts, showConfirmation, showNotification, t]
  );

  return {
    files,
    selectedFiles,
    selectionCount,
    loading,
    error,
    uploading,
    deleting,
    deletingAll,
    statusUpdating,
    batchStatusUpdating,
    fileInputRef,
    loadFiles,
    handleUploadClick,
    handleFileChange,
    handleDelete,
    handleDeleteAll,
    handleDownload,
    handleStatusToggle,
    toggleSelect,
    selectAllVisible,
    invertVisibleSelection,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchDelete,
    clearRecoveredFiles,
  };
}
