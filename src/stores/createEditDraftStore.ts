import type { SetStateAction } from 'react';
import { create } from 'zustand';

export type TestStatus = 'idle' | 'loading' | 'success' | 'error';

export type BaseEditDraft<TBaseline, TForm> = {
  initialized: boolean;
  baseline: TBaseline | null;
  form: TForm;
  testModel: string;
  testStatus: TestStatus;
  testMessage: string;
};

export interface BaseEditDraftState<
  TBaseline,
  TForm,
  TDraft extends BaseEditDraft<TBaseline, TForm>,
> {
  drafts: Record<string, TDraft>;
  refCounts: Record<string, number>;
  acquireDraft: (key: string) => void;
  releaseDraft: (key: string) => void;
  ensureDraft: (key: string) => void;
  initDraft: (key: string, draft: Omit<TDraft, 'initialized'>) => void;
  setDraftBaseline: (key: string, baseline: TBaseline) => void;
  setDraftForm: (key: string, action: SetStateAction<TForm>) => void;
  setDraftTestModel: (key: string, action: SetStateAction<string>) => void;
  setDraftTestStatus: (key: string, action: SetStateAction<TestStatus>) => void;
  setDraftTestMessage: (key: string, action: SetStateAction<string>) => void;
  clearDraft: (key: string) => void;
}

export function resolveAction<T>(action: SetStateAction<T>, prev: T): T {
  return typeof action === 'function' ? (action as (prev: T) => T)(prev) : action;
}

type BaseState<TBaseline, TForm, TDraft extends BaseEditDraft<TBaseline, TForm>> =
  BaseEditDraftState<TBaseline, TForm, TDraft>;

type SetFn<S> = (
  partial: Partial<S> | ((state: S) => Partial<S>),
  replace?: false | undefined,
) => void;

type GetFn<S> = () => S;

export function editDraftStoreCreator<
  TBaseline,
  TForm,
  TDraft extends BaseEditDraft<TBaseline, TForm>,
>(buildEmptyDraft: () => TDraft) {
  type S = BaseState<TBaseline, TForm, TDraft>;

  const mergeDraft = (
    state: S,
    key: string,
    patch: Record<string, unknown>,
  ): Partial<S> => {
    const existing = state.drafts[key] ?? buildEmptyDraft();
    return {
      drafts: {
        ...state.drafts,
        [key]: { ...existing, ...patch } as TDraft,
      },
    };
  };

  return (set: SetFn<S>, get: GetFn<S>): S => ({
    drafts: {},
    refCounts: {},

    acquireDraft: (key) => {
      if (!key) return;
      set((state) => {
        const existingDraft = state.drafts[key];
        const currentCount = state.refCounts[key] ?? 0;
        return {
          drafts: existingDraft ? state.drafts : { ...state.drafts, [key]: buildEmptyDraft() },
          refCounts: { ...state.refCounts, [key]: currentCount + 1 },
        };
      });
    },

    releaseDraft: (key) => {
      if (!key) return;
      set((state) => {
        const currentCount = state.refCounts[key];
        if (!currentCount) return state;
        if (currentCount > 1) {
          return { refCounts: { ...state.refCounts, [key]: currentCount - 1 } };
        }
        const nextCounts = { ...state.refCounts };
        delete nextCounts[key];
        const nextDrafts = { ...state.drafts };
        delete nextDrafts[key];
        return { refCounts: nextCounts, drafts: nextDrafts };
      });
    },

    ensureDraft: (key) => {
      if (!key) return;
      const existing = get().drafts[key];
      if (existing) return;
      set((state) => ({
        drafts: { ...state.drafts, [key]: buildEmptyDraft() },
      }));
    },

    initDraft: (key, draft) => {
      if (!key) return;
      const existing = get().drafts[key];
      if (existing?.initialized) return;
      set((state) => ({
        drafts: {
          ...state.drafts,
          [key]: { ...draft, initialized: true } as TDraft,
        },
      }));
    },

    setDraftBaseline: (key, baseline) => {
      if (!key) return;
      set((state) => mergeDraft(state, key, { initialized: true, baseline }));
    },

    setDraftForm: (key, action) => {
      if (!key) return;
      set((state) => {
        const existing = state.drafts[key] ?? buildEmptyDraft();
        return mergeDraft(state, key, { initialized: true, form: resolveAction(action, existing.form) });
      });
    },

    setDraftTestModel: (key, action) => {
      if (!key) return;
      set((state) => {
        const existing = state.drafts[key] ?? buildEmptyDraft();
        return mergeDraft(state, key, { initialized: true, testModel: resolveAction(action, existing.testModel) });
      });
    },

    setDraftTestStatus: (key, action) => {
      if (!key) return;
      set((state) => {
        const existing = state.drafts[key] ?? buildEmptyDraft();
        return mergeDraft(state, key, { initialized: true, testStatus: resolveAction(action, existing.testStatus) });
      });
    },

    setDraftTestMessage: (key, action) => {
      if (!key) return;
      set((state) => {
        const existing = state.drafts[key] ?? buildEmptyDraft();
        return mergeDraft(state, key, { initialized: true, testMessage: resolveAction(action, existing.testMessage) });
      });
    },

    clearDraft: (key) => {
      if (!key) return;
      set((state) => {
        if (!state.drafts[key] && !state.refCounts[key]) return state;
        const nextDrafts = { ...state.drafts };
        delete nextDrafts[key];
        const nextCounts = { ...state.refCounts };
        delete nextCounts[key];
        return { drafts: nextDrafts, refCounts: nextCounts };
      });
    },
  });
}

export function createEditDraftStore<
  TBaseline,
  TForm,
  TDraft extends BaseEditDraft<TBaseline, TForm>,
>(buildEmptyDraft: () => TDraft) {
  type S = BaseState<TBaseline, TForm, TDraft>;
  return create<S>(editDraftStoreCreator(buildEmptyDraft) as (set: SetFn<S>, get: GetFn<S>) => S);
}
