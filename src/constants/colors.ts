/**
 * Centralized color theme constants for the application.
 * All hardcoded color values should be defined here and imported by components.
 */

// Statistics cards color palette
export const STAT_COLORS = {
  requests: {
    accent: '#8b8680',
    soft: 'rgba(139, 134, 128, 0.18)',
    border: 'rgba(139, 134, 128, 0.35)',
  },
  tokens: {
    accent: '#8b5cf6',
    soft: 'rgba(139, 92, 246, 0.18)',
    border: 'rgba(139, 92, 246, 0.35)',
  },
  rpm: {
    accent: '#22c55e',
    soft: 'rgba(34, 197, 94, 0.18)',
    border: 'rgba(34, 197, 94, 0.32)',
  },
  tpm: {
    accent: '#f97316',
    soft: 'rgba(249, 115, 22, 0.18)',
    border: 'rgba(249, 115, 22, 0.32)',
  },
  cost: {
    accent: '#f59e0b',
    soft: 'rgba(245, 158, 11, 0.18)',
    border: 'rgba(245, 158, 11, 0.32)',
  },
} as const;

// Request status colors
export const STATUS_COLORS = {
  success: '#10b981',
  failure: '#c65746',
} as const;

// Model mapping diagram provider colors
export const PROVIDER_COLORS = [
  '#8b8680',
  '#10b981',
  '#f59e0b',
  '#c65746',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
] as const;

// Success rate color thresholds
export const SUCCESS_RATE_COLORS = {
  excellent: '#22c55e', // >= 95%
  good: '#eab308', // >= 80%
  poor: '#ef4444', // < 80%
} as const;

// Model usage summary accent color
export const MODEL_USAGE_SUMMARY = {
  accent: '#6366f1',
  soft: 'rgba(99, 102, 241, 0.18)',
  border: 'rgba(99, 102, 241, 0.5)',
} as const;
