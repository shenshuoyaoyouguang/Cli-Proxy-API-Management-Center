import { create } from 'zustand';
import type { OpenAIFormState } from '@/components/providers/types';
import { buildApiKeyEntry } from '@/components/providers/utils';
import {
  editDraftStoreCreator,
  type TestStatus,
  type BaseEditDraft,
  type BaseEditDraftState,
} from './createEditDraftStore';

export type OpenAITestStatus = TestStatus;

export type KeyTestStatus = {
  status: OpenAITestStatus;
  message: string;
};

export type OpenAIEditBaseline = {
  name: string;
  priority: number | null;
  prefix: string;
  baseUrl: string;
  headers: Array<{ key: string; value: string }>;
  apiKeyEntries: Array<{
    apiKey: string;
    proxyUrl: string;
    headers: Array<{ key: string; value: string }>;
  }>;
  models: Array<{ name: string; alias: string }>;
  testModel: string;
};

export type OpenAIEditDraft = BaseEditDraft<OpenAIEditBaseline, OpenAIFormState> & {
  keyTestStatuses: KeyTestStatus[];
};

type OpenAIBaseState = BaseEditDraftState<OpenAIEditBaseline, OpenAIFormState, OpenAIEditDraft>;

export interface OpenAIEditDraftState extends OpenAIBaseState {
  setDraftKeyTestStatus: (draftKey: string, keyIndex: number, status: KeyTestStatus) => void;
  resetDraftKeyTestStatuses: (draftKey: string, count: number) => void;
}

const buildEmptyForm = (): OpenAIFormState => ({
  name: '',
  prefix: '',
  baseUrl: '',
  headers: [],
  apiKeyEntries: [buildApiKeyEntry()],
  modelEntries: [{ name: '', alias: '' }],
  testModel: undefined,
});

const buildEmptyDraft = (): OpenAIEditDraft => ({
  initialized: false,
  baseline: null,
  form: buildEmptyForm(),
  testModel: '',
  testStatus: 'idle',
  testMessage: '',
  keyTestStatuses: [],
});

const baseCreator = editDraftStoreCreator<OpenAIEditBaseline, OpenAIFormState, OpenAIEditDraft>(
  buildEmptyDraft,
);

export const useOpenAIEditDraftStore = create<OpenAIEditDraftState>((set, get) => ({
  ...baseCreator(
    set as (
      partial:
        | Partial<OpenAIBaseState>
        | ((state: OpenAIBaseState) => Partial<OpenAIBaseState>),
      replace?: false | undefined,
    ) => void,
    get as () => OpenAIBaseState,
  ),

  setDraftKeyTestStatus: (draftKey, keyIndex, status) => {
    if (!draftKey) return;
    set((state) => {
      const existing = state.drafts[draftKey] ?? buildEmptyDraft();
      const nextStatuses = [...existing.keyTestStatuses];
      nextStatuses[keyIndex] = status;
      return {
        drafts: {
          ...state.drafts,
          [draftKey]: { ...existing, initialized: true, keyTestStatuses: nextStatuses },
        },
      };
    });
  },

  resetDraftKeyTestStatuses: (draftKey, count) => {
    if (!draftKey) return;
    set((state) => {
      const existing = state.drafts[draftKey] ?? buildEmptyDraft();
      return {
        drafts: {
          ...state.drafts,
          [draftKey]: {
            ...existing,
            initialized: true,
            keyTestStatuses: Array.from({ length: count }, () => ({ status: 'idle', message: '' })),
          },
        },
      };
    });
  },
}));
