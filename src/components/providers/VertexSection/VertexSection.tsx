import iconVertex from '@/assets/icons/vertex.svg';
import type { ProviderKeyConfig, ModelAlias } from '@/types';
import { ProviderKeySection, type ProviderSectionConfig } from '../ProviderKeySection';
import type { KeyStats } from '@/utils/usage';
import type { UsageDetailsByAuthIndex, UsageDetailsBySource } from '@/utils/usageIndex';

const vertexConfig: ProviderSectionConfig<ProviderKeyConfig> = {
  icon: iconVertex,
  i18nPrefix: 'vertex',
  showIndexInTitle: true,
  showPriority: false,
  getModelKey: (model: ModelAlias) => `${model.name}-${model.alias || 'default'}`,
  showModelAlias: (model: ModelAlias) => !!model.alias,
};

interface VertexSectionProps {
  configs: ProviderKeyConfig[];
  keyStats: KeyStats;
  usageDetailsBySource: UsageDetailsBySource;
  usageDetailsByAuthIndex: UsageDetailsByAuthIndex;
  loading: boolean;
  disableControls: boolean;
  isSwitching: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
}

export function VertexSection(props: VertexSectionProps) {
  return <ProviderKeySection config={vertexConfig} {...props} />;
}
