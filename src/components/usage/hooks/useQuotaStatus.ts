import { useMemo } from 'react';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type {
  ClaudeQuotaState,
  GeminiCliQuotaState,
  CodexQuotaState,
  KimiQuotaState,
} from '@/types/quota';
import type { QuotaAlertLevel } from '../types';

export interface QuotaStatusItem {
  id: string;
  label: string;
  usedPercent: number; // 0-100+
  alertLevel: QuotaAlertLevel;
  resetLabel?: string;
  provider: 'claude' | 'gemini' | 'codex' | 'kimi';
  metricCategory?: 'tpm' | 'monthly';
}

function getAlertLevel(percent: number): QuotaAlertLevel {
  if (percent >= 95) return 'critical';
  if (percent >= 80) return 'warning';
  return 'normal';
}

function normalizeUsedPercent(percent: number | null | undefined): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }

  return Math.max(0, percent as number);
}

function aggregateClaudeWindows(state: ClaudeQuotaState): QuotaStatusItem[] {
  if (state.status !== 'success' || !state.windows.length) return [];

  return state.windows.map((w) => ({
    id: `claude-${w.id}`,
    label: w.label || w.id,
    usedPercent: normalizeUsedPercent(w.usedPercent),
    alertLevel: getAlertLevel(normalizeUsedPercent(w.usedPercent)),
    resetLabel: w.resetLabel,
    provider: 'claude',
  }));
}

function aggregateClaudeMonthlyUsage(state: ClaudeQuotaState): QuotaStatusItem | null {
  if (state.status !== 'success' || !state.extraUsage?.is_enabled) {
    return null;
  }

  const utilization = state.extraUsage.utilization;
  const normalizedUtilization =
    typeof utilization === 'number' && Number.isFinite(utilization)
      ? utilization <= 1
        ? utilization * 100
        : utilization
      : null;
  const fallbackPercent =
    state.extraUsage.monthly_limit > 0
      ? (state.extraUsage.used_credits / state.extraUsage.monthly_limit) * 100
      : null;
  const usedPercent = normalizeUsedPercent(normalizedUtilization ?? fallbackPercent);

  return {
    id: 'claude-extra-usage-monthly',
    label: 'Claude extra usage',
    usedPercent,
    alertLevel: getAlertLevel(usedPercent),
    provider: 'claude',
    metricCategory: 'monthly',
  };
}

function aggregateGeminiBuckets(state: GeminiCliQuotaState): QuotaStatusItem[] {
  if (state.status !== 'success' || !state.buckets.length) return [];

  return state.buckets.map((b) => {
    const remainingFraction = b.remainingFraction ?? 1;
    const usedPercent = (1 - remainingFraction) * 100;
    return {
      id: `gemini-${b.id}`,
      label: b.label || b.tokenType || 'Unknown',
      usedPercent,
      alertLevel: getAlertLevel(usedPercent),
      resetLabel: b.resetTime,
      provider: 'gemini',
      metricCategory: 'tpm',
    };
  });
}

function aggregateCodexWindows(state: CodexQuotaState): QuotaStatusItem[] {
  if (state.status !== 'success' || !state.windows.length) return [];

  return state.windows.map((w) => ({
    id: `codex-${w.id}`,
    label: w.label || w.id,
    usedPercent: normalizeUsedPercent(w.usedPercent),
    alertLevel: getAlertLevel(normalizeUsedPercent(w.usedPercent)),
    resetLabel: w.resetLabel,
    provider: 'codex',
  }));
}

function aggregateKimiRows(state: KimiQuotaState): QuotaStatusItem[] {
  if (state.status !== 'success' || !state.rows.length) return [];

  return state.rows.map((r) => {
    const usedPercent = r.limit > 0 ? (r.used / r.limit) * 100 : 0;
    return {
      id: `kimi-${r.id}`,
      label: r.label || r.id,
      usedPercent,
      alertLevel: getAlertLevel(usedPercent),
      resetLabel: r.resetHint,
      provider: 'kimi',
    };
  });
}

export interface UseQuotaStatusReturn {
  items: QuotaStatusItem[];
  hasAnyQuota: boolean;
  criticalItems: QuotaStatusItem[];
  warningItems: QuotaStatusItem[];
  rpmItem: QuotaStatusItem | null;
  tpmItem: QuotaStatusItem | null;
  monthlyItem: QuotaStatusItem | null;
}

function pickMostConstrainedItem(items: QuotaStatusItem[]): QuotaStatusItem | null {
  if (items.length === 0) {
    return null;
  }

  return items.reduce((mostConstrained, current) =>
    current.usedPercent > mostConstrained.usedPercent ? current : mostConstrained
  );
}

export function useQuotaStatus(): UseQuotaStatusReturn {
  const claudeQuotaMap = useQuotaStore((s) => s.claudeQuota);
  const geminiCliQuotaMap = useQuotaStore((s) => s.geminiCliQuota);
  const codexQuotaMap = useQuotaStore((s) => s.codexQuota);
  const kimiQuotaMap = useQuotaStore((s) => s.kimiQuota);

  return useMemo(() => {
    const allItems: QuotaStatusItem[] = [];

    Object.values(claudeQuotaMap).forEach((state) => {
      allItems.push(...aggregateClaudeWindows(state));
      const monthlyUsage = aggregateClaudeMonthlyUsage(state);
      if (monthlyUsage) {
        allItems.push(monthlyUsage);
      }
    });
    Object.values(geminiCliQuotaMap).forEach((state) => {
      const buckets = aggregateGeminiBuckets(state);
      allItems.push(...buckets);
    });
    Object.values(codexQuotaMap).forEach((state) => {
      allItems.push(...aggregateCodexWindows(state));
    });
    Object.values(kimiQuotaMap).forEach((state) => {
      allItems.push(...aggregateKimiRows(state));
    });

    const criticalItems = allItems.filter((i) => i.alertLevel === 'critical');
    const warningItems = allItems.filter((i) => i.alertLevel === 'warning');

    return {
      items: allItems,
      hasAnyQuota: allItems.length > 0,
      criticalItems,
      warningItems,
      rpmItem: null,
      tpmItem: pickMostConstrainedItem(
        allItems.filter((item) => item.metricCategory === 'tpm')
      ),
      monthlyItem: pickMostConstrainedItem(
        allItems.filter((item) => item.metricCategory === 'monthly')
      ),
    };
  }, [claudeQuotaMap, geminiCliQuotaMap, codexQuotaMap, kimiQuotaMap]);
}
