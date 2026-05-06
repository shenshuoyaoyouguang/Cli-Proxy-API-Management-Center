import type { UsageDetail } from '@/utils/usage';

export type UsageSSEEventType = 'usage:delta' | 'usage:full' | 'usage:heartbeat';

export type UsageSSEConnectionStatus = 'connecting' | 'connected' | 'degraded' | 'disconnected';

export interface UsageTokenDelta {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  totalTokens: number;
}

export interface UsageDeltaDetailItem {
  model: string;
  source: string;
  timestamp: number;
  success: boolean;
  tokens: { prompt: number; completion: number; total: number; reasoning?: number; cached?: number };
}

export interface UsageModelBreakdownItem {
  endpoint: string;
  model: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  tokenDelta: UsageTokenDelta;
}

export interface UsageDeltaEvent {
  seq: number;
  timestamp: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
  tokenDelta: UsageTokenDelta;
  details: UsageDeltaDetailItem[];
  modelBreakdown?: UsageModelBreakdownItem[];
}

export interface UsageSnapshotDetailItem extends UsageDetail {
  model?: string;
  provider?: string;
  auth_type?: string;
  endpoint?: string;
  request_id?: string;
  latency_ms?: number;
}

export interface UsageFullEvent {
  seq: number;
  timestamp: number;
  usage: Record<string, unknown>;
  usageDetails?: UsageSnapshotDetailItem[];
}

export interface UsageSSEHandler {
  onDelta: (data: UsageDeltaEvent) => void;
  onFull: (data: UsageFullEvent) => void;
  onHeartbeat: () => void;
  onError: (event: Event) => void;
  onAuthError: () => void;
}
