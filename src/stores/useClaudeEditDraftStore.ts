import type { ProviderFormState } from '@/components/providers/types';
import {
  createEditDraftStore,
  type TestStatus,
  type BaseEditDraft,
  type BaseEditDraftState,
} from './createEditDraftStore';

export type ClaudeTestStatus = TestStatus;

export type ClaudeCloakBaseline = {
  mode: string;
  strictMode: boolean;
  sensitiveWords: string[] | null;
} | null;

export type ClaudeEditBaseline = {
  apiKey: string;
  priority: number | null;
  prefix: string;
  baseUrl: string;
  proxyUrl: string;
  headers: Array<{ key: string; value: string }>;
  models: Array<{ name: string; alias: string }>;
  excludedModels: string[];
  cloak: ClaudeCloakBaseline;
};

export type ClaudeEditDraft = BaseEditDraft<ClaudeEditBaseline, ProviderFormState>;

export type ClaudeEditDraftState = BaseEditDraftState<
  ClaudeEditBaseline,
  ProviderFormState,
  ClaudeEditDraft
>;

const buildEmptyForm = (): ProviderFormState => ({
  apiKey: '',
  prefix: '',
  baseUrl: '',
  proxyUrl: '',
  headers: [],
  models: [],
  excludedModels: [],
  modelEntries: [{ name: '', alias: '' }],
  excludedText: '',
});

const buildEmptyDraft = (): ClaudeEditDraft => ({
  initialized: false,
  baseline: null,
  form: buildEmptyForm(),
  testModel: '',
  testStatus: 'idle',
  testMessage: '',
});

export const useClaudeEditDraftStore = createEditDraftStore(buildEmptyDraft);
