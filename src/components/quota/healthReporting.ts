import { useAccountHealthStore, type AccountHealthBatchResult } from '@/stores/useAccountHealthStore';

export const reportQuotaHealthResults = async (results: AccountHealthBatchResult[]) => {
  try {
    await useAccountHealthStore.getState().reportBatchResults(results);
  } catch (error) {
    console.warn('Failed to persist quota health results', error);
  }
};
