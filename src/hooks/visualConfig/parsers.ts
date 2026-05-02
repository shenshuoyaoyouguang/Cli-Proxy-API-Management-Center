import type {
  PayloadFilterRule,
  PayloadParamValueType,
  PayloadRule,
} from '@/types/visualConfig';
import { asRecord } from '@/atoms/usage/guards';

export function extractApiKeyValue(raw: unknown): string | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }

  const record = asRecord(raw);
  if (!record) return null;

  const candidates = [record['api-key'], record.apiKey, record.key, record.Key];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }

  return null;
}

export function parseApiKeysText(raw: unknown): string {
  if (!Array.isArray(raw)) return '';

  const keys: string[] = [];
  for (const item of raw) {
    const key = extractApiKeyValue(item);
    if (key) keys.push(key);
  }
  return keys.join('\n');
}

export function resolveApiKeysText(parsed: Record<string, unknown>): string {
  if (Object.prototype.hasOwnProperty.call(parsed, 'api-keys')) {
    return parseApiKeysText(parsed['api-keys']);
  }

  const auth = asRecord(parsed.auth);
  const providers = asRecord(auth?.providers);
  const configApiKeyProvider = asRecord(providers?.['config-api-key']);
  if (!configApiKeyProvider) return '';

  if (Object.prototype.hasOwnProperty.call(configApiKeyProvider, 'api-key-entries')) {
    return parseApiKeysText(configApiKeyProvider['api-key-entries']);
  }

  return parseApiKeysText(configApiKeyProvider['api-keys']);
}

export function parsePayloadParamValue(raw: unknown): { valueType: PayloadParamValueType; value: string } {
  if (typeof raw === 'number') {
    return { valueType: 'number', value: String(raw) };
  }

  if (typeof raw === 'boolean') {
    return { valueType: 'boolean', value: String(raw) };
  }

  if (raw === null || typeof raw === 'object') {
    try {
      const json = JSON.stringify(raw, null, 2);
      return { valueType: 'json', value: json ?? 'null' };
    } catch {
      return { valueType: 'json', value: String(raw) };
    }
  }

  return { valueType: 'string', value: String(raw ?? '') };
}

export function parseRawPayloadParamValue(raw: unknown): string {
  if (typeof raw === 'string') return raw;

  try {
    const json = JSON.stringify(raw, null, 2);
    return json ?? '';
  } catch {
    return String(raw ?? '');
  }
}

export function parsePayloadProtocol(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  return raw.trim() ? raw : undefined;
}

export function parsePayloadRules(rules: unknown): PayloadRule[] {
  if (!Array.isArray(rules)) return [];

  return rules.map((rule, index) => {
    const record = asRecord(rule) ?? {};

    const modelsRaw = record.models;
    const models = Array.isArray(modelsRaw)
      ? modelsRaw.map((model, modelIndex) => {
          const modelRecord = asRecord(model);
          const nameRaw =
            typeof model === 'string' ? model : (modelRecord?.name ?? modelRecord?.id ?? '');
          const name = typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? '');
          return {
            id: `model-${index}-${modelIndex}`,
            name,
            protocol: parsePayloadProtocol(modelRecord?.protocol),
          };
        })
      : [];

    const paramsRecord = asRecord(record.params);
    const params = paramsRecord
      ? Object.entries(paramsRecord).map(([path, value], pIndex) => {
          const parsedValue = parsePayloadParamValue(value);
          return {
            id: `param-${index}-${pIndex}`,
            path,
            valueType: parsedValue.valueType,
            value: parsedValue.value,
          };
        })
      : [];

    return { id: `payload-rule-${index}`, models, params };
  });
}

export function parsePayloadFilterRules(rules: unknown): PayloadFilterRule[] {
  if (!Array.isArray(rules)) return [];

  return rules.map((rule, index) => {
    const record = asRecord(rule) ?? {};

    const modelsRaw = record.models;
    const models = Array.isArray(modelsRaw)
      ? modelsRaw.map((model, modelIndex) => {
          const modelRecord = asRecord(model);
          const nameRaw =
            typeof model === 'string' ? model : (modelRecord?.name ?? modelRecord?.id ?? '');
          const name = typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? '');
          return {
            id: `filter-model-${index}-${modelIndex}`,
            name,
            protocol: parsePayloadProtocol(modelRecord?.protocol),
          };
        })
      : [];

    const paramsRaw = record.params;
    const params = Array.isArray(paramsRaw) ? paramsRaw.map(String) : [];

    return { id: `payload-filter-rule-${index}`, models, params };
  });
}

export function parseRawPayloadRules(rules: unknown): PayloadRule[] {
  if (!Array.isArray(rules)) return [];

  return rules.map((rule, index) => {
    const record = asRecord(rule) ?? {};

    const modelsRaw = record.models;
    const models = Array.isArray(modelsRaw)
      ? modelsRaw.map((model, modelIndex) => {
          const modelRecord = asRecord(model);
          const nameRaw =
            typeof model === 'string' ? model : (modelRecord?.name ?? modelRecord?.id ?? '');
          const name = typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? '');
          return {
            id: `raw-model-${index}-${modelIndex}`,
            name,
            protocol: parsePayloadProtocol(modelRecord?.protocol),
          };
        })
      : [];

    const paramsRecord = asRecord(record.params);
    const params = paramsRecord
      ? Object.entries(paramsRecord).map(([path, value], pIndex) => ({
          id: `raw-param-${index}-${pIndex}`,
          path,
          valueType: 'json' as const,
          value: parseRawPayloadParamValue(value),
        }))
      : [];

    return { id: `payload-raw-rule-${index}`, models, params };
  });
}
