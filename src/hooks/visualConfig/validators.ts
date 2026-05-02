import type {
  PayloadParamEntry,
  PayloadParamValidationErrorCode,
  VisualConfigValidationErrorCode,
  VisualConfigValidationErrors,
  VisualConfigValues,
} from '@/types/visualConfig';

function getNonNegativeIntegerError(value: string): VisualConfigValidationErrorCode | null {
  if (value.trim() === '') return null;
  if (!/^\d+$/.test(value.trim())) return 'non_negative_integer';
  return null;
}

function getPortError(value: string): VisualConfigValidationErrorCode | null {
  if (value.trim() === '') return null;
  if (!/^\d+$/.test(value.trim())) return 'port_range';
  const port = Number(value.trim());
  if (port < 1 || port > 65535) return 'port_range';
  return null;
}

export function getVisualConfigValidationErrors(values: VisualConfigValues): VisualConfigValidationErrors {
  const errors: VisualConfigValidationErrors = {};

  const portError = getPortError(values.port);
  if (portError) errors.port = portError;

  const logsMaxTotalSizeMbError = getNonNegativeIntegerError(values.logsMaxTotalSizeMb);
  if (logsMaxTotalSizeMbError) errors.logsMaxTotalSizeMb = logsMaxTotalSizeMbError;

  const requestRetryError = getNonNegativeIntegerError(values.requestRetry);
  if (requestRetryError) errors.requestRetry = requestRetryError;

  const maxRetryCredentialsError = getNonNegativeIntegerError(values.maxRetryCredentials);
  if (maxRetryCredentialsError) errors.maxRetryCredentials = maxRetryCredentialsError;

  const maxRetryIntervalError = getNonNegativeIntegerError(values.maxRetryInterval);
  if (maxRetryIntervalError) errors.maxRetryInterval = maxRetryIntervalError;

  const keepaliveError = getNonNegativeIntegerError(values.streaming.keepaliveSeconds);
  if (keepaliveError) errors['streaming.keepaliveSeconds'] = keepaliveError;

  const bootstrapRetriesError = getNonNegativeIntegerError(values.streaming.bootstrapRetries);
  if (bootstrapRetriesError) errors['streaming.bootstrapRetries'] = bootstrapRetriesError;

  const nonstreamKeepaliveError = getNonNegativeIntegerError(values.streaming.nonstreamKeepaliveInterval);
  if (nonstreamKeepaliveError) errors['streaming.nonstreamKeepaliveInterval'] = nonstreamKeepaliveError;

  return errors;
}

export function getPayloadParamValidationError(entry: PayloadParamEntry): PayloadParamValidationErrorCode | null {
  if (!entry.path?.trim()) return null;
  if (entry.valueType === 'number') {
    if (entry.value.trim() === '') return 'payload_invalid_number';
    if (!/^-?\d+(\.\d+)?$/.test(entry.value.trim())) return 'payload_invalid_number';
  }
  if (entry.valueType === 'boolean') {
    const normalized = entry.value.trim().toLowerCase();
    if (normalized !== 'true' && normalized !== 'false') return 'payload_invalid_boolean';
  }
  if (entry.valueType === 'json') {
    try {
      JSON.parse(entry.value);
    } catch {
      return 'payload_invalid_json';
    }
  }
  return null;
}

export function hasPayloadParamValidationErrors(rules: Array<{ params: PayloadParamEntry[] }>): boolean {
  return rules.some((rule) =>
    rule.params.some((param) => getPayloadParamValidationError(param) !== null)
  );
}
