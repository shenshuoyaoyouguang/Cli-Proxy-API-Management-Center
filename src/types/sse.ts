import type { UsageDetail } from '@/utils/usage';

export type UsageSSEEventType = 'usage:delta' | 'usage:full' | 'usage:heartbeat';

export type UsageSSEConnectionStatus = 'connecting' | 'connected' | 'degraded' | 'disconnected';

export interface UsageTokenDelta {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface UsageDeltaDetailItem {
  model: string;
  source: string;
  timestamp: number;
  success: boolean;
  tokens: { prompt: number; completion: number; total: number };
}

export interface UsageDeltaEvent {
  seq: number;
  timestamp: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
  tokenDelta: UsageTokenDelta;
  details: UsageDeltaDetailItem[];
}

export interface UsageFullEvent {
  seq: number;
  timestamp: number;
  usage: Record<string, unknown>;
  usageDetails?: UsageDetail[];
}

export interface UsageSSEHandler {
  onDelta: (data: UsageDeltaEvent) => void;
  onFull: (data: UsageFullEvent) => void;
  onHeartbeat: () => void;
  onError: (event: Event) => void;
  onAuthError: () => void;
}
