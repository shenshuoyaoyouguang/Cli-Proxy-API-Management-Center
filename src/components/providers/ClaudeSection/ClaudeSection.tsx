import iconClaude from '@/assets/icons/claude.svg';
import type { ProviderKeyConfig } from '@/types';
import { ProviderKeySection, type ProviderSectionConfig } from '../ProviderKeySection';
import type { KeyStats } from '@/utils/usage';
import type { UsageDetailsByAuthIndex, UsageDetailsBySource } from '@/utils/usageIndex';
import styles from '@/pages/AiProvidersPage.module.scss';

const claudeConfig: ProviderSectionConfig<ProviderKeyConfig> = {
  icon: iconClaude,
  i18nPrefix: 'claude',
  showIndexInTitle: false,
  showPriority: true,
  renderExtraFields: (item, _index, t) => (
    <>
      {item.cloak && (
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>{t('ai_providers.claude_cloak_mode_label')}:</span>
          <span className={styles.fieldValue}>
            {(() => {
              const raw = (item.cloak?.mode ?? '').trim().toLowerCase();
              const key = raw === 'always' || raw === 'never' ? raw : 'auto';
              return t(`ai_providers.claude_cloak_mode_${key}`);
            })()}
          </span>
        </div>
      )}
      {item.cloak?.strictMode ? (
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>{t('ai_providers.claude_cloak_strict_label')}:</span>
          <span className={styles.fieldValue}>{t('common.yes')}</span>
        </div>
      ) : null}
      {item.cloak?.sensitiveWords?.length ? (
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>
            {t('ai_providers.claude_cloak_sensitive_words_count')}:
          </span>
          <span className={styles.fieldValue}>{item.cloak.sensitiveWords.length}</span>
        </div>
      ) : null}
    </>
  ),
};

interface ClaudeSectionProps {
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

export function ClaudeSection(props: ClaudeSectionProps) {
  return <ProviderKeySection config={claudeConfig} {...props} />;
}
