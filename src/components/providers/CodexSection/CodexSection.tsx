import iconCodex from '@/assets/icons/codex.svg';
import type { ProviderKeyConfig } from '@/types';
import { ProviderKeySection, type ProviderSectionConfig } from '../ProviderKeySection';
import type { KeyStats } from '@/utils/usage';
import type { UsageDetailsByAuthIndex, UsageDetailsBySource } from '@/utils/usageIndex';
import styles from '@/pages/AiProvidersPage.module.scss';

const codexConfig: ProviderSectionConfig<ProviderKeyConfig> = {
  icon: iconCodex,
  i18nPrefix: 'codex',
  showIndexInTitle: false,
  showPriority: true,
  renderExtraFields: (item, _index, t) =>
    item.websockets !== undefined ? (
      <div className={styles.fieldRow}>
        <span className={styles.fieldLabel}>{t('ai_providers.codex_websockets_label')}:</span>
        <span className={styles.fieldValue}>{item.websockets ? t('common.yes') : t('common.no')}</span>
      </div>
    ) : null,
};

interface CodexSectionProps {
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

export function CodexSection(props: CodexSectionProps) {
  return <ProviderKeySection config={codexConfig} {...props} />;
}
