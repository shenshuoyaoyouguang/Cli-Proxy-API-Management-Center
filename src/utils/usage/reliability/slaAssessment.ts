import { SLA_TIERS, reliabilityConfig } from './config';
import { collectWindowAvailability, collectWindowCounts } from './snapshot';
import type {
  DataQuality,
  ReliabilityMetricId,
  ReliabilitySnapshot,
  SLACompensation,
  SLAStatus,
  SlaAssessment,
  SlaCommitment,
  SubscriptionTier
} from './types';

const getCommitmentStatus = (current: number, target: number): SLAStatus => {
  const ratio = current / target;
  if (ratio >= 1) {
    return 'met';
  }
  if (ratio >= 0.95) {
    return 'at_risk';
  }
  return 'breached';
};

const buildRatioCommitment = ({
  id,
  target,
  current,
  sampleCount,
  dataQuality
}: {
  id: ReliabilityMetricId;
  target: number;
  current: number | null;
  sampleCount: number;
  dataQuality: DataQuality;
}): SlaCommitment => ({
  id,
  target,
  current,
  unit: 'ratio',
  sampleCount,
  dataQuality,
  status: current === null || dataQuality !== 'ok' ? 'unknown' : getCommitmentStatus(current, target)
});

const buildUnsupportedCommitment = ({
  id,
  target,
  unit
}: {
  id: ReliabilityMetricId;
  target: number | null;
  unit: 'ratio' | 'milliseconds' | 'minutes';
}): SlaCommitment => ({
  id,
  target,
  current: null,
  unit,
  sampleCount: 0,
  dataQuality: 'unsupported',
  status: 'unsupported'
});

export const getSLAStatus = (current: number, target: number): SLAStatus => {
  if (!Number.isFinite(target) || target <= 0) {
    return 'unsupported';
  }
  return getCommitmentStatus(current, target);
};

export const getOverallSLAStatus = (commitments: SlaAssessment['commitments']): SLAStatus => {
  const requiredCommitments = Object.values(commitments).filter((commitment) => commitment.target !== null);
  if (requiredCommitments.length === 0) {
    return 'unsupported';
  }

  if (requiredCommitments.some((commitment) => commitment.status === 'breached')) {
    return 'breached';
  }

  if (requiredCommitments.some((commitment) => commitment.status === 'at_risk')) {
    return 'at_risk';
  }

  if (requiredCommitments.some((commitment) => commitment.status === 'unsupported')) {
    return 'unknown';
  }

  if (requiredCommitments.some((commitment) => commitment.status === 'unknown')) {
    return 'unknown';
  }

  return 'met';
};

const calculateRemainingDowntime = (tier: SubscriptionTier, availability: number | null): number => {
  const target = SLA_TIERS[tier].availabilityTarget;
  if (availability === null || target === null) {
    return 0;
  }

  const monthlyMinutes = reliabilityConfig.slaWindowMs / reliabilityConfig.minuteMs;
  const allowedDowntime = monthlyMinutes * (1 - target);
  const currentDowntime = monthlyMinutes * (1 - availability);
  return Math.max(0, Math.round(allowedDowntime - currentDowntime));
};

const calculateRemainingErrors = (
  tier: SubscriptionTier,
  successCount: number,
  failureCount: number
): number => {
  const target = SLA_TIERS[tier].successRateTarget;
  if (target === null) {
    return 0;
  }

  const total = successCount + failureCount;
  if (total === 0) {
    return 0;
  }

  const allowedFailures = total * (1 - target);
  return Math.max(0, Math.round(allowedFailures - failureCount));
};

const calculateCompensation = (
  tier: SubscriptionTier,
  availability: number | null,
  monthlyFee: number = 99
): SLACompensation => {
  const config = SLA_TIERS[tier];
  if (!config.hasCompensation || availability === null) {
    return {
      eligible: false,
      amount: 0,
      percentage: 0,
      description: ''
    };
  }

  const matchedRule = config.compensationRules.find(
    (rule) => availability >= rule.minRate && availability < rule.maxRate
  );

  if (!matchedRule || matchedRule.percentage === 0) {
    return {
      eligible: false,
      amount: 0,
      percentage: 0,
      description: 'met'
    };
  }

  return {
    eligible: true,
    amount: (monthlyFee * matchedRule.percentage) / 100,
    percentage: matchedRule.percentage,
    description: `credit_${matchedRule.percentage}`
  };
};

export function buildSlaAssessment({
  snapshot,
  tier,
  monthlyFee
}: {
  snapshot: ReliabilitySnapshot;
  tier: SubscriptionTier;
  monthlyFee?: number;
}): SlaAssessment {
  const config = SLA_TIERS[tier];
  const counts = collectWindowCounts(snapshot, reliabilityConfig.slaWindowMs);

  if (tier === 'free') {
    const unsupportedCommitment = buildUnsupportedCommitment({
      id: 'availability',
      target: null,
      unit: 'ratio'
    });

    return {
      tier,
      overallStatus: 'unsupported',
      dataQuality: 'unsupported',
      commitments: {
        availability: unsupportedCommitment,
        successRate: buildUnsupportedCommitment({ id: 'success_rate', target: null, unit: 'ratio' }),
        responseTime: buildUnsupportedCommitment({ id: 'latency', target: null, unit: 'milliseconds' }),
        recoveryTime: buildUnsupportedCommitment({ id: 'recovery_time', target: null, unit: 'minutes' })
      },
      remainingBudget: { downtime: 0, errors: 0 },
      compensation: { eligible: false, amount: 0, percentage: 0, description: '' },
      missingTelemetry: [],
      hasData: counts.total > 0
    };
  }

  const { availability, totalWeight } = collectWindowAvailability(snapshot, reliabilityConfig.slaWindowMs);
  const availabilityCommitment = buildRatioCommitment({
    id: 'availability',
    target: config.availabilityTarget ?? 0,
    current: availability,
    sampleCount: totalWeight,
    dataQuality:
      totalWeight === 0 ? 'no_data' : availability === null ? 'no_data' : 'ok'
  });

  const successRate = counts.total > 0 ? counts.success / counts.total : null;
  const successRateCommitment = buildRatioCommitment({
    id: 'success_rate',
    target: config.successRateTarget ?? 0,
    current: successRate,
    sampleCount: counts.total,
    dataQuality: counts.total === 0 ? 'no_data' : 'ok'
  });

  const commitments: SlaAssessment['commitments'] = {
    availability: availabilityCommitment,
    successRate: successRateCommitment,
    responseTime: buildUnsupportedCommitment({
      id: 'latency',
      target: config.responseTimeTarget,
      unit: 'milliseconds'
    }),
    recoveryTime: buildUnsupportedCommitment({
      id: 'recovery_time',
      target: config.recoveryTimeTarget,
      unit: 'minutes'
    })
  };

  const missingTelemetry = Object.values(commitments)
    .filter((commitment) => commitment.target !== null && commitment.status === 'unsupported')
    .map((commitment) => commitment.id);

  const overallStatus = getOverallSLAStatus(commitments);
  const dataQuality: DataQuality = counts.total === 0 ? 'no_data' : missingTelemetry.length > 0 ? 'unsupported' : 'ok';

  return {
    tier,
    overallStatus,
    dataQuality,
    commitments,
    remainingBudget: {
      downtime: calculateRemainingDowntime(tier, availability),
      errors: calculateRemainingErrors(tier, counts.success, counts.failure)
    },
    compensation: calculateCompensation(tier, availability, monthlyFee),
    missingTelemetry,
    hasData: counts.total > 0
  };
}
