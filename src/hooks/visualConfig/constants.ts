import type { PayloadParamValueType } from '@/types/visualConfig';

export const VISUAL_CONFIG_PROTOCOL_OPTIONS = [
  {
    value: '',
    labelKey: 'config_management.visual.payload_rules.provider_default',
    defaultLabel: 'Default',
  },
  {
    value: 'openai',
    labelKey: 'config_management.visual.payload_rules.provider_openai',
    defaultLabel: 'OpenAI',
  },
  {
    value: 'openai-response',
    labelKey: 'config_management.visual.payload_rules.provider_openai_response',
    defaultLabel: 'OpenAI Response',
  },
  {
    value: 'gemini',
    labelKey: 'config_management.visual.payload_rules.provider_gemini',
    defaultLabel: 'Gemini',
  },
  {
    value: 'claude',
    labelKey: 'config_management.visual.payload_rules.provider_claude',
    defaultLabel: 'Claude',
  },
  {
    value: 'codex',
    labelKey: 'config_management.visual.payload_rules.provider_codex',
    defaultLabel: 'Codex',
  },
  {
    value: 'antigravity',
    labelKey: 'config_management.visual.payload_rules.provider_antigravity',
    defaultLabel: 'Antigravity',
  },
] as const;

export const VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS = [
  {
    value: 'string',
    labelKey: 'config_management.visual.payload_rules.value_type_string',
    defaultLabel: 'String',
  },
  {
    value: 'number',
    labelKey: 'config_management.visual.payload_rules.value_type_number',
    defaultLabel: 'Number',
  },
  {
    value: 'boolean',
    labelKey: 'config_management.visual.payload_rules.value_type_boolean',
    defaultLabel: 'Boolean',
  },
  {
    value: 'json',
    labelKey: 'config_management.visual.payload_rules.value_type_json',
    defaultLabel: 'JSON',
  },
] as const satisfies ReadonlyArray<{
  value: PayloadParamValueType;
  labelKey: string;
  defaultLabel: string;
}>;
