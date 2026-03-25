import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import type { ModelPrice } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

const PRICE_PAGE_SIZE = 10;

export interface PriceSettingsCardProps {
  modelNames: string[];
  modelPrices: Record<string, ModelPrice>;
  onPricesChange: (prices: Record<string, ModelPrice>) => void;
}

export function PriceSettingsCard({
  modelNames,
  modelPrices,
  onPricesChange,
}: PriceSettingsCardProps) {
  const { t } = useTranslation();

  // Add form state
  const [modelQuery, setModelQuery] = useState('');
  const [appliedModel, setAppliedModel] = useState('');
  const [promptPrice, setPromptPrice] = useState('');
  const [completionPrice, setCompletionPrice] = useState('');
  const [cachePrice, setCachePrice] = useState('');
  const [page, setPage] = useState(1);

  const selectedModel = useMemo(
    () => modelNames.find((name) => name === modelQuery) ?? '',
    [modelNames, modelQuery]
  );

  const priceEntries = useMemo(() => Object.entries(modelPrices), [modelPrices]);
  const totalPages = Math.max(1, Math.ceil(priceEntries.length / PRICE_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external prop to internal state
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const visibleEntries = useMemo(() => {
    const start = (currentPage - 1) * PRICE_PAGE_SIZE;
    return priceEntries.slice(start, start + PRICE_PAGE_SIZE);
  }, [currentPage, priceEntries]);

  // Edit modal state
  const [editModel, setEditModel] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [editCompletion, setEditCompletion] = useState('');
  const [editCache, setEditCache] = useState('');

  const clearPriceInputs = () => {
    setPromptPrice('');
    setCompletionPrice('');
    setCachePrice('');
  };

  const resetCreateForm = () => {
    setModelQuery('');
    setAppliedModel('');
    clearPriceInputs();
  };

  const handleSavePrice = () => {
    if (!selectedModel) return;

    const prompt = parseFloat(promptPrice) || 0;
    const completion = parseFloat(completionPrice) || 0;
    const cache = cachePrice.trim() === '' ? prompt : parseFloat(cachePrice) || 0;
    const newPrices = { ...modelPrices, [selectedModel]: { prompt, completion, cache } };
    const targetIndex = Object.keys(newPrices).indexOf(selectedModel);
    const targetPage = targetIndex >= 0 ? Math.floor(targetIndex / PRICE_PAGE_SIZE) + 1 : 1;

    setPage(targetPage);
    onPricesChange(newPrices);
    resetCreateForm();
  };

  const handleDeletePrice = (model: string) => {
    const newPrices = { ...modelPrices };
    delete newPrices[model];

    const nextTotalPages = Math.max(1, Math.ceil(Object.keys(newPrices).length / PRICE_PAGE_SIZE));
    setPage((prev) => Math.min(prev, nextTotalPages));
    onPricesChange(newPrices);

    if (model === selectedModel) {
      setAppliedModel('');
      clearPriceInputs();
    }
  };

  const handleOpenEdit = (model: string) => {
    const price = modelPrices[model];
    setEditModel(model);
    setEditPrompt(price?.prompt?.toString() || '');
    setEditCompletion(price?.completion?.toString() || '');
    setEditCache(price?.cache?.toString() || '');
  };

  const handleSaveEdit = () => {
    if (!editModel) return;

    const prompt = parseFloat(editPrompt) || 0;
    const completion = parseFloat(editCompletion) || 0;
    const cache = editCache.trim() === '' ? prompt : parseFloat(editCache) || 0;
    const newPrices = { ...modelPrices, [editModel]: { prompt, completion, cache } };

    onPricesChange(newPrices);

    if (editModel === selectedModel) {
      setAppliedModel(editModel);
      setPromptPrice(prompt.toString());
      setCompletionPrice(completion.toString());
      setCachePrice(cache.toString());
    }

    setEditModel(null);
  };

  const handleModelInputChange = (
    value: string,
    meta?: {
      reason: 'input' | 'select' | 'blur';
    }
  ) => {
    setModelQuery(value);

    if (meta?.reason === 'input') {
      if (value !== appliedModel) {
        setAppliedModel('');
      }
      return;
    }

    const matchedModel = modelNames.find((name) => name === value);
    if (!matchedModel || matchedModel === appliedModel) {
      return;
    }

    setAppliedModel(matchedModel);

    const price = modelPrices[matchedModel];
    if (price) {
      setPromptPrice(price.prompt.toString());
      setCompletionPrice(price.completion.toString());
      setCachePrice(price.cache.toString());
      return;
    }

    setPromptPrice('');
    setCompletionPrice('');
    setCachePrice('');
  };

  return (
    <Card title={t('usage_stats.model_price_settings')}>
      <div className={styles.pricingSection}>
        {/* Price Form */}
        <div className={styles.priceForm}>
          <div className={styles.formRow}>
            <div className={styles.formField}>
              <label>{t('usage_stats.model_name')}</label>
              <AutocompleteInput
                value={modelQuery}
                onChange={handleModelInputChange}
                options={modelNames}
                placeholder={t('usage_stats.model_price_select_placeholder')}
                wrapperStyle={{ marginBottom: 0 }}
                confirmExactMatchOnBlur
              />
            </div>
            <div className={styles.formField}>
              <label>{t('usage_stats.model_price_prompt')} ($/1M)</label>
              <Input
                type="number"
                value={promptPrice}
                onChange={(e) => setPromptPrice(e.target.value)}
                placeholder="0.00"
                step="0.0001"
              />
            </div>
            <div className={styles.formField}>
              <label>{t('usage_stats.model_price_completion')} ($/1M)</label>
              <Input
                type="number"
                value={completionPrice}
                onChange={(e) => setCompletionPrice(e.target.value)}
                placeholder="0.00"
                step="0.0001"
              />
            </div>
            <div className={styles.formField}>
              <label>{t('usage_stats.model_price_cache')} ($/1M)</label>
              <Input
                type="number"
                value={cachePrice}
                onChange={(e) => setCachePrice(e.target.value)}
                placeholder="0.00"
                step="0.0001"
              />
            </div>
            <Button variant="primary" onClick={handleSavePrice} disabled={!selectedModel}>
              {t('common.save')}
            </Button>
          </div>
        </div>

        {/* Saved Prices List */}
        <div className={styles.pricesList}>
          <h4 className={styles.pricesTitle}>{t('usage_stats.saved_prices')}</h4>
          {priceEntries.length > 0 ? (
            <>
              <div className={styles.pricesGrid}>
                {visibleEntries.map(([model, price]) => (
                  <div key={model} className={styles.priceItem}>
                    <div className={styles.priceInfo}>
                      <span className={styles.priceModel}>{model}</span>
                      <div className={styles.priceMeta}>
                        <span>
                          {t('usage_stats.model_price_prompt')}: ${price.prompt.toFixed(4)}/1M
                        </span>
                        <span>
                          {t('usage_stats.model_price_completion')}: ${price.completion.toFixed(4)}
                          /1M
                        </span>
                        <span>
                          {t('usage_stats.model_price_cache')}: ${price.cache.toFixed(4)}/1M
                        </span>
                      </div>
                    </div>
                    <div className={styles.priceActions}>
                      <Button variant="secondary" size="sm" onClick={() => handleOpenEdit(model)}>
                        {t('common.edit')}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => handleDeletePrice(model)}>
                        {t('common.delete')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {priceEntries.length > PRICE_PAGE_SIZE && (
                <div className={styles.pricePagination}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage <= 1}
                  >
                    {t('auth_files.pagination_prev')}
                  </Button>
                  <span className={styles.pricePaginationInfo}>
                    {currentPage}/{totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage >= totalPages}
                  >
                    {t('auth_files.pagination_next')}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className={styles.hint}>{t('usage_stats.model_price_empty')}</div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      <Modal
        open={editModel !== null}
        title={editModel ?? ''}
        onClose={() => setEditModel(null)}
        footer={
          <div className={styles.priceActions}>
            <Button variant="secondary" onClick={() => setEditModel(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={handleSaveEdit}>
              {t('common.save')}
            </Button>
          </div>
        }
        width={420}
      >
        <div className={styles.editModalBody}>
          <div className={styles.formField}>
            <label>{t('usage_stats.model_price_prompt')} ($/1M)</label>
            <Input
              type="number"
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder="0.00"
              step="0.0001"
            />
          </div>
          <div className={styles.formField}>
            <label>{t('usage_stats.model_price_completion')} ($/1M)</label>
            <Input
              type="number"
              value={editCompletion}
              onChange={(e) => setEditCompletion(e.target.value)}
              placeholder="0.00"
              step="0.0001"
            />
          </div>
          <div className={styles.formField}>
            <label>{t('usage_stats.model_price_cache')} ($/1M)</label>
            <Input
              type="number"
              value={editCache}
              onChange={(e) => setEditCache(e.target.value)}
              placeholder="0.00"
              step="0.0001"
            />
          </div>
        </div>
      </Modal>
    </Card>
  );
}
