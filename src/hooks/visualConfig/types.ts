import type { parseDocument } from 'yaml';

export type YamlDocument = ReturnType<typeof parseDocument>;
export type YamlPath = string[];

export type VisualConfigState = {
  visualValues: import('@/types/visualConfig').VisualConfigValues;
  baselineValues: import('@/types/visualConfig').VisualConfigValues;
  dirtyFields: Set<string>;
  visualParseError: string | null;
};

export type VisualConfigAction =
  | {
      type: 'load_success';
      values: import('@/types/visualConfig').VisualConfigValues;
    }
  | {
      type: 'load_error';
      error: string;
    }
  | {
      type: 'set_values';
      values: Partial<import('@/types/visualConfig').VisualConfigValues>;
    };
