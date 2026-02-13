import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ItemDefinition } from '@/types';
import { ITEM_MASTER } from '@/data/item-master';
import { showOperationNotice, type OperationNoticeTone } from '@/lib/ui/operationNotice';
import { useGameStore } from '@/store/gameStore';
import { useUIStore } from '@/store/uiStore';
import { logger } from '@/lib/logger';

type StorageSection = {
  key: 'provisions' | 'materials' | 'treasures';
  label: string;
  items: ItemDefinition[];
  canUse: boolean;
  showEffect: boolean;
};

type StoragePartition = Record<StorageSection['key'], ItemDefinition[]>;

const formatEffectText = (item: ItemDefinition): string => {
  switch (item.effect.type) {
    case 'town_xp_boost':
      return `城下町修練値 +${item.effect.value}`;
    case 'town_gold_boost':
      return `所持小判 +${item.effect.value}両`;
    case 'passive_bonus':
      if (item.effect.key === 'gold_gain_rate') {
        return `所持中: 小判獲得量 +${item.effect.value}%`;
      }
      return item.effect.value > 0 ? `常備効能 +${item.effect.value}%` : '細工素材';
    default:
      return '特別効能';
  }
};

const StorageView = () => {
  const inventory = useGameStore((state) => state.inventory);
  const itemCatalog = useGameStore((state) => state.itemCatalog);
  const loadItems = useGameStore((state) => state.loadItems);
  const consumeItem = useGameStore((state) => state.consumeItem);

  const openPopup = useUIStore((state) => state.openPopup);
  const notifyOperation = useCallback(
    (message: string, tone: OperationNoticeTone = 'info') => {
      showOperationNotice(openPopup, message, { tone });
    },
    [openPopup]
  );

  const [usingItemId, setUsingItemId] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;

    void loadItems()
      .catch(() => {
        // 初期描画では空表示へフォールバックする。
      })
      .finally(() => {
        if (!cancelled) {
          setInitialLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadItems]);

  const inventoryMap = useMemo(() => {
    const byId = new Map<string, { quantity: number }>();

    for (const entry of inventory) {
      byId.set(entry.itemId, {
        quantity: Math.max(0, Math.floor(entry.quantity)),
      });
    }

    return byId;
  }, [inventory]);

  const effectiveCatalog = useMemo(() => {
    const byId = new Map(itemCatalog.map((item) => [item.id, item]));
    for (const fallback of ITEM_MASTER) {
      if (!byId.has(fallback.id)) {
        byId.set(fallback.id, fallback);
      }
    }
    return Array.from(byId.values());
  }, [itemCatalog]);

  const partitionedItems = useMemo<StoragePartition>(() => {
    const partition: StoragePartition = {
      provisions: [],
      materials: [],
      treasures: [],
    };

    for (const item of effectiveCatalog) {
      const stock = inventoryMap.get(item.id);
      if ((stock?.quantity ?? 0) < 1) {
        continue;
      }

      if (item.itemType === 'material') {
        partition.materials.push(item);
      } else if (item.usable) {
        partition.provisions.push(item);
      } else {
        partition.treasures.push(item);
      }
    }

    return partition;
  }, [effectiveCatalog, inventoryMap]);

  const storageSections = useMemo<StorageSection[]>(
    () => {
      const sections: StorageSection[] = [
        {
          key: 'provisions',
          label: '兵糧',
          items: partitionedItems.provisions,
          canUse: true,
          showEffect: true,
        },
        {
          key: 'materials',
          label: '素材',
          items: partitionedItems.materials,
          canUse: false,
          showEffect: false,
        },
        {
          key: 'treasures',
          label: '宝物',
          items: partitionedItems.treasures,
          canUse: false,
          showEffect: true,
        },
      ];

      return sections.filter((section) => section.items.length > 0);
    },
    [partitionedItems]
  );

  const onUseItem = async (item: ItemDefinition) => {
    setUsingItemId(item.id);
    try {
      const result = await consumeItem(item.id);
      notifyOperation(result.message, result.success ? 'success' : 'error');
    } catch (error) {
      logger.error('Failed to use item', {
        itemId: item.id,
        error,
      });
      notifyOperation('行使不能でござる。通信が乱れた。', 'error');
    } finally {
      setUsingItemId((current) => (current === item.id ? null : current));
    }
  };

  return (
    <div className="space-y-4 text-sm text-slate-100">
      {initialLoading ? (
        <div className="space-y-4" aria-busy="true" aria-live="polite">
          {Array.from({ length: 2 }).map((_, sectionIndex) => (
            <section key={`storage-skeleton-${sectionIndex}`} className="space-y-2">
              <div className="h-3 w-20 animate-pulse rounded bg-slate-500/30" />
              {Array.from({ length: 2 }).map((__, itemIndex) => (
                <article
                  key={`storage-skeleton-item-${sectionIndex}-${itemIndex}`}
                  className="animate-pulse rounded-lg border border-[color:var(--kincha)]/20 bg-black/15 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-24 rounded bg-slate-500/35" />
                      <div className="h-2.5 w-20 rounded bg-slate-500/25" />
                      <div className="h-2.5 w-40 rounded bg-slate-500/20" />
                    </div>
                    <div className="h-7 w-14 rounded bg-slate-500/25" />
                  </div>
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : storageSections.length > 0 ? (
        storageSections.map((section) => (
          <section key={`storage-section-${section.key}`} className="space-y-2" aria-label={section.label}>
            <h4
              className="text-xs font-semibold tracking-[0.08em] text-[color:var(--kincha)]"
              style={{ fontFamily: '"Noto Serif JP", serif' }}
            >
              {'— '}
              {section.label}
              {' —'}
            </h4>
            {section.items.map((item) => {
              const quantity = inventoryMap.get(item.id)?.quantity ?? 0;
              const isUsing = usingItemId === item.id;
              const canUse = section.canUse && item.usable && quantity > 0;

              return (
                <article
                  key={`storage-item-${section.key}-${item.id}`}
                  className="rounded-lg border border-[color:var(--kincha)]/25 bg-black/20 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-100">{item.name}</p>
                      <p className="text-[11px] text-slate-300">所持数: {quantity}</p>
                      <p className="text-[11px] text-slate-300">{item.description}</p>
                      {section.showEffect ? (
                        <p className="text-[10px] text-slate-400">効能: {formatEffectText(item)}</p>
                      ) : null}
                    </div>
                    {section.canUse ? (
                      <button
                        type="button"
                        onClick={() => onUseItem(item)}
                        disabled={!canUse || isUsing}
                        className="rounded-md border border-[color:var(--kincha)]/45 bg-[color:var(--kincha)]/20 px-2 py-1 text-[11px] font-semibold text-[color:var(--kincha)] transition hover:bg-[color:var(--kincha)]/30 disabled:cursor-not-allowed disabled:border-slate-500/50 disabled:bg-slate-500/20 disabled:text-slate-300"
                      >
                        {isUsing ? '行使中...' : '行使'}
                      </button>
                    ) : (
                      <p className="rounded-md border border-[color:var(--kincha)]/35 bg-[color:var(--kincha)]/15 px-2 py-1 text-xs font-semibold text-[color:var(--kincha)]">
                        {quantity}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        ))
      ) : (
        <div className="rounded-lg border border-dashed border-slate-500/35 px-3 py-2 text-xs text-slate-300">
          所持品なし
        </div>
      )}
    </div>
  );
};

export default StorageView;
