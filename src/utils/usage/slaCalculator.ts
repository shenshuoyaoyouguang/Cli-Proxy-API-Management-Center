import type { UsageDetail } from '../usage';
import {
  SLA_TIERS,
  buildReliabilitySnapshot,
  buildSlaAssessment,
  getOverallSLAStatus as getReliabilityOverallSLAStatus,
  getSLAStatus as getReliabilitySLAStatus,
  type SlaAssessment,
  type SlaCommitment,
  type SLAStatus as ReliabilitySLAStatus,
  type SubscriptionTier as ReliabilitySubscriptionTier
} from './reliability';

export type SubscriptionTier = ReliabilitySubscriptionTier;
export type SLAStatus = ReliabilitySLAStatus;
export type SLACommitment = SlaCommitment;
export interface SLACommitments {
  availability: SLACommitment;
  successRate: SLACommitment;
  responseTime: SLACommitment;
  recoveryTime: SLACommitment;
}
export type SLARemainingBudget = SlaAssessment['remainingBudget'];
export type SLACompensation = SlaAssessment['compensation'];
export type SLAMetrics = SlaAssessment;

export { SLA_TIERS };

export function getSLAStatus(current: number, target: number): SLAStatus {
  return getReliabilitySLAStatus(current, target);
}

export function getStatusColor(status: SLAStatus): string {
  switch (status) {
    case 'met':
      return '#22c55e';
    case 'at_risk':
      return '#f59e0b';
    case 'breached':
      return '#ef4444';
    case 'unsupported':
      return '#64748b';
    case 'unknown':
    default:
      return '#94a3b8';
  }
}

export function getStatusLabel(status: SLAStatus, t?: (key: string) => string): string {
  const labels: Record<SLAStatus, string> = {
    met: t ? t('sla.status_met') : '达标',
    at_risk: t ? t('sla.status_at_risk') : '接近上限',
    breached: t ? t('sla.status_breached') : '违约',
    unknown: t ? t('sla.status_unknown') : '未知',
    unsupported: t ? t('sla.status_unsupported') : '未接入'
  };

  return labels[status];
}

export function getTierLabel(tier: SubscriptionTier, t?: (key: string) => string): string {
  const labels: Record<SubscriptionTier, string> = {
    free: t ? t('sla.tier_free') : 'Free',
    basic: t ? t('sla.tier_basic') : 'Basic',
    pro: t ? t('sla.tier_pro') : 'Pro',
    enterprise: t ? t('sla.tier_enterprise') : 'Enterprise'
  };

  return labels[tier];
}

export function getOverallSLAStatus(commitments: SLACommitments): SLAStatus {
  return getReliabilityOverallSLAStatus(commitments);
}

export function calculateSLAMetrics(
  tier: SubscriptionTier,
  _successCount: number,
  _failureCount: number,
  details: UsageDetail[],
  monthlyFee?: number,
  nowMs: number = Date.now()
): SLAMetrics {
  const snapshot = buildReliabilitySnapshot(details, nowMs);
  return buildSlaAssessment({ snapshot, tier, monthlyFee });
}
