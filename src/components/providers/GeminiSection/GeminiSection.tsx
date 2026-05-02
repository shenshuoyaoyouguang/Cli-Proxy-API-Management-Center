import iconGemini from '@/assets/icons/gemini.svg';
import type { GeminiKeyConfig } from '@/types';
import { ProviderKeySection, type ProviderSectionConfig } from '../ProviderKeySection';
import type { KeyStats } from '@/utils/usage';
import type { UsageDetailsByAuthIndex, UsageDetailsBySource } from '@/utils/usageIndex';

const geminiConfig: ProviderSectionConfig<GeminiKeyConfig> = {
  icon: iconGemini,
  i18nPrefix: 'gemini',
  showIndexInTitle: true,
  showPriority: true,
};

interface GeminiSectionProps {
  configs: GeminiKeyConfig[];
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

export function GeminiSection(props: GeminiSectionProps) {
  return <ProviderKeySection config={geminiConfig} {...props} />;
}
