import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InventoryItem, ItemDefinition } from '@/types';
import { ITEM_MASTER, ITEM_MASTER_SHOP_COST_BY_ID } from '@/data/item-master';
import { formatCurrency } from '@/lib/gamification/economy';
import { showOperationNotice, type OperationNoticeTone } from '@/lib/ui/operationNotice';
import { useGameStore } from '@/store/gameStore';
import { useUIStore } from '@/store/uiStore';
import { logger } from '@/lib/logger';

type ShopSectionKey = 'consumables' | 'materials' | 'decorations';
type ShopSection = {
  key: ShopSectionKey;
  label: string;
  items: ItemDefinition[];
};

type ItemMaterialRequirement = {
  itemId: string;
  quantity: number;
};

type MissingMaterial = ItemMaterialRequirement & {
  name: string;
  have: number;
  shortfall: number;
};

type PurchaseAvailability = {
  resolvedCost: number;
  canPurchase: boolean;
  shortageReason: string | null;
  priceDetail: string | null;
};

const PURCHASABLE_BY_ITEM_ID = new Map<string, boolean>(
  ITEM_MASTER.map((item) => [item.id, item.purchasable !== false])
);
const MATERIAL_NAME_BY_ID = new Map<string, string>(
  ITEM_MASTER.filter((item) => item.itemType === 'material').map((item) => [item.id, item.name])
);
const SHOP_SECTION_LABEL_BY_KEY: Record<ShopSectionKey, string> = {
  consumables: '日用品',
  materials: '素材',
  decorations: '装飾',
};
const HIGH_VALUE_PURCHASE_THRESHOLD = 100;

const RARITY_BADGE_CLASS: Record<ItemDefinition['rarity'], string> = {
  common: 'border-slate-300/40 bg-slate-400/15 text-slate-100',
  uncommon: 'border-emerald-300/45 bg-emerald-500/20 text-emerald-100',
  rare: 'border-sky-300/45 bg-sky-500/20 text-sky-100',
  epic: 'border-fuchsia-300/45 bg-fuchsia-500/20 text-fuchsia-100',
  legendary: 'border-amber-300/55 bg-amber-500/25 text-amber-100',
};

const RARITY_LABEL: Record<ItemDefinition['rarity'], string> = {
  common: '並',
  uncommon: '珍',
  rare: '稀',
  epic: '極',
  legendary: '伝説',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toSafePositiveInt = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.max(0, Math.floor(value));
  return normalized > 0 ? normalized : null;
};

const toInventoryQuantityMap = (inventory: readonly InventoryItem[]): Map<string, number> => {
  const quantityByItemId = new Map<string, number>();
  for (const entry of inventory) {
    quantityByItemId.set(entry.itemId, Math.max(0, Math.floor(entry.quantity)));
  }

  return quantityByItemId;
};

const resolveMaterialRequirements = (item: ItemDefinition): ItemMaterialRequirement[] => {
  const source = item as ItemDefinition & {
    requiredMaterials?: unknown;
    purchaseMaterials?: unknown;
    materials?: unknown;
  };
  const rawRequirements = Array.isArray(source.requiredMaterials)
    ? source.requiredMaterials
    : Array.isArray(source.purchaseMaterials)
      ? source.purchaseMaterials
      : Array.isArray(source.materials)
        ? source.materials
        : [];

  return rawRequirements.flatMap((entry): ItemMaterialRequirement[] => {
    if (!isRecord(entry)) {
      return [];
    }

    const itemId =
      typeof entry.itemId === 'string'
        ? entry.itemId.trim()
        : typeof entry.id === 'string'
          ? entry.id.trim()
          : '';
    const quantity = toSafePositiveInt(entry.quantity ?? entry.required);
    if (itemId.length < 1 || quantity === null) {
      return [];
    }

    return [
      {
        itemId,
        quantity,
      },
    ];
  });
};

const formatEffectText = (item: ItemDefinition): string => {
  switch (item.effect.type) {
    case 'town_xp_boost':
      return `城下町修練値 +${item.effect.value}`;
    case 'town_gold_boost':
      return `所持小判 +${formatCurrency(item.effect.value)}`;
    case 'passive_bonus':
      if (item.effect.key === 'gold_gain_rate' && item.effect.value > 0) {
        return `所持時に小判獲得量 +${item.effect.value}%`;
      }
      if (item.effect.key === 'decoration_gold_bonus' && item.effect.value > 0) {
        return `獲得小判+${item.effect.value}%/Lv`;
      }
      if (item.effect.key === 'decoration_xp_bonus' && item.effect.value > 0) {
        return `獲得修練値+${item.effect.value}%/Lv`;
      }
      if (item.effect.key === 'decoration_drop_rate_bonus' && item.effect.value > 0) {
        return `素材ドロップ率+${item.effect.value}%/Lv`;
      }

      return item.effect.value > 0 ? `常備効能 +${item.effect.value}%` : '細工素材';
    default:
      return '特別効能';
  }
};

const ShopView = () => {
  const gameState = useGameStore((state) => state.gameState);
  const inventory = useGameStore((state) => state.inventory);
  const itemCatalog = useGameStore((state) => state.itemCatalog);
  const loadItems = useGameStore((state) => state.loadItems);
  const buyItem = useGameStore((state) => state.buyItem);

  const openPopup = useUIStore((state) => state.openPopup);
  const notifyOperation = useCallback(
    (message: string, tone: OperationNoticeTone = 'info') => {
      showOperationNotice(openPopup, message, { tone });
    },
    [openPopup]
  );

  const [buyingItemId, setBuyingItemId] = useState<string | null>(null);
  const [processingAction, setProcessingAction] = useState<string | null>(null);
  const [reloadingCatalog, setReloadingCatalog] = useState<boolean>(false);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;

    void loadItems()
      .catch(() => {
        // 初期描画では空表示へフォールバックし、再読込導線を維持する。
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

  const isProcessing = processingAction !== null;
  const gold = gameState?.town.gold ?? 0;
  const inventoryQuantityByItemId = useMemo(() => toInventoryQuantityMap(inventory), [inventory]);

  const resolvePurchaseAvailability = useCallback(
    (item: ItemDefinition): PurchaseAvailability => {
      const fallbackCost = Math.max(0, Math.floor(item.shopCost));
      const canonicalCost = ITEM_MASTER_SHOP_COST_BY_ID[item.id];
      const resolvedCost = canonicalCost ?? fallbackCost;
      const missingGold = Math.max(0, resolvedCost - gold);
      const missingMaterials = resolveMaterialRequirements(item).flatMap((required): MissingMaterial[] => {
        const have = inventoryQuantityByItemId.get(required.itemId) ?? 0;
        const shortfall = Math.max(0, required.quantity - have);
        if (shortfall < 1) {
          return [];
        }

        return [
          {
            ...required,
            name: MATERIAL_NAME_BY_ID.get(required.itemId) ?? required.itemId,
            have,
            shortfall,
          },
        ];
      });
      const shortageParts: string[] = [];
      if (missingGold > 0) {
        shortageParts.push(`小判不足（あと${formatCurrency(missingGold)}）`);
      }
      if (missingMaterials.length > 0) {
        shortageParts.push(
          `素材不足（${missingMaterials.map((material) => `${material.name}×${material.shortfall}`).join(' / ')}）`
        );
      }

      return {
        resolvedCost,
        canPurchase: missingGold === 0 && missingMaterials.length === 0,
        shortageReason: shortageParts.length > 0 ? shortageParts.join(' / ') : null,
        priceDetail:
          canonicalCost !== undefined && canonicalCost !== fallbackCost
            ? `価格帳: ${formatCurrency(canonicalCost)}（取得値 ${formatCurrency(fallbackCost)} を補正）`
            : null,
      };
    },
    [gold, inventoryQuantityByItemId]
  );

  const onBuyItem = async (item: ItemDefinition, availability: PurchaseAvailability) => {
    if (isProcessing || !availability.canPurchase) {
      return;
    }

    if (availability.resolvedCost >= HIGH_VALUE_PURCHASE_THRESHOLD && typeof window !== 'undefined') {
      const confirmed = window.confirm(
        `${item.name}を${formatCurrency(availability.resolvedCost)}で購入いたす。よろしいか？`
      );
      if (!confirmed) {
        notifyOperation('高額購入を取りやめた。');
        return;
      }
    }

    setProcessingAction(`item:${item.id}`);
    setBuyingItemId(item.id);
    try {
      const result = await buyItem(item.id, 1);
      notifyOperation(
        result.success ? result.message : `購入不能でござる。${result.message}`,
        result.success ? 'success' : 'error'
      );
    } catch (error) {
      logger.error('Failed to buy item', {
        itemId: item.id,
        error,
      });
      notifyOperation('購入不能でござる。通信が乱れた。', 'error');
    } finally {
      setBuyingItemId((current) => (current === item.id ? null : current));
      setProcessingAction(null);
    }
  };

  const shopItems = useMemo(
    () =>
      itemCatalog.filter((item) => {
        if (item.purchasable === false) {
          return false;
        }

        const fromMaster = PURCHASABLE_BY_ITEM_ID.get(item.id);
        if (fromMaster === false) {
          return false;
        }

        if (item.purchasable === true || fromMaster === true) {
          return true;
        }

        return item.itemType !== 'material';
      }),
    [itemCatalog]
  );

  const shopSections = useMemo<ShopSection[]>(() => {
    const bySection: Record<ShopSectionKey, ItemDefinition[]> = {
      consumables: [],
      materials: [],
      decorations: [],
    };

    for (const item of shopItems) {
      if (item.itemType === 'material') {
        bySection.materials.push(item);
      } else if (item.itemType === 'decoration') {
        bySection.decorations.push(item);
      } else {
        bySection.consumables.push(item);
      }
    }

    return (Object.keys(bySection) as ShopSectionKey[])
      .map((key) => ({
        key,
        label: SHOP_SECTION_LABEL_BY_KEY[key],
        items: bySection[key],
      }))
      .filter((section) => section.items.length > 0);
  }, [shopItems]);

  const reloadItemCatalog = async (): Promise<void> => {
    if (reloadingCatalog) {
      return;
    }

    setReloadingCatalog(true);
    try {
      await loadItems();
    } finally {
      setReloadingCatalog(false);
    }
  };

  return (
    <div className="space-y-4 text-sm text-slate-100">
      <section className="space-y-3">
        <h4
          className="text-xs font-semibold tracking-[0.08em] text-[color:var(--kincha)]"
          style={{ fontFamily: '"Noto Serif JP", serif' }}
        >
          道具屋
        </h4>
        {initialLoading ? (
          <div className="space-y-2" aria-busy="true" aria-live="polite">
            {Array.from({ length: 3 }).map((_, index) => (
              <article
                key={`shop-skeleton-${index}`}
                className="animate-pulse rounded-lg border border-[color:var(--kincha)]/20 bg-black/15 p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3 w-28 rounded bg-slate-500/35" />
                    <div className="h-2.5 w-full rounded bg-slate-500/25" />
                    <div className="h-2.5 w-2/3 rounded bg-slate-500/20" />
                  </div>
                  <div className="h-7 w-16 rounded bg-slate-500/25" />
                </div>
              </article>
            ))}
          </div>
        ) : shopSections.length > 0 ? (
          shopSections.map((section) => (
            <section key={`shop-section-${section.key}`} className="space-y-2" aria-label={section.label}>
              <h5 className="text-[11px] font-semibold tracking-[0.06em] text-[color:var(--kincha)]/85">
                {section.label}
              </h5>
              {section.items.map((item) => {
                const isBuying = processingAction === `item:${item.id}` && buyingItemId === item.id;
                const availability = resolvePurchaseAvailability(item);
                const isDisabled = isProcessing || !availability.canPurchase;
                const disabledReason = isProcessing ? '処理中でござる。' : availability.shortageReason;
                const isDecorationItem = item.itemType === 'decoration';
                const tieredCosts = (item.upgradeCosts ?? []).filter((cost) => Number.isFinite(cost));
                const tieredPriceText =
                  tieredCosts.length > 0
                    ? `段階価格: ${tieredCosts.map((cost, index) => `${index + 1}段 ${formatCurrency(cost)}`).join(' / ')}`
                    : null;

                return (
                  <article
                    key={item.id}
                    className="rounded-lg border border-[color:var(--kincha)]/25 bg-black/20 p-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-xs font-semibold text-slate-100">{item.name}</p>
                          <span
                            className={[
                              'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                              RARITY_BADGE_CLASS[item.rarity],
                            ].join(' ')}
                          >
                            {RARITY_LABEL[item.rarity]}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-300">{item.description}</p>
                        <p className="text-[10px] text-slate-400">
                          {isDecorationItem
                            ? `${item.name} — ${formatCurrency(availability.resolvedCost)} — ${formatEffectText(item)}`
                            : `効能: ${formatEffectText(item)}`}
                        </p>
                        {tieredPriceText ? <p className="text-[10px] text-slate-400">{tieredPriceText}</p> : null}
                        {availability.priceDetail ? (
                          <p className="text-[10px] text-amber-100/90">{availability.priceDetail}</p>
                        ) : null}
                        {availability.shortageReason ? (
                          <p className="text-[10px] text-rose-100/90">{availability.shortageReason}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void onBuyItem(item, availability);
                        }}
                        disabled={isDisabled}
                        title={disabledReason ?? undefined}
                        className="rounded-md border border-[color:var(--kincha)]/45 bg-[color:var(--kincha)]/20 px-2 py-1 text-[11px] font-semibold text-[color:var(--kincha)] transition hover:bg-[color:var(--kincha)]/30 disabled:cursor-not-allowed disabled:border-slate-500/50 disabled:bg-slate-500/20 disabled:text-slate-300"
                      >
                        {isBuying ? '商談中...' : availability.canPurchase ? formatCurrency(availability.resolvedCost) : '不足'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
          ))
        ) : (
          <article className="rounded-lg border border-dashed border-slate-500/35 bg-black/10 p-3 text-xs text-slate-300">
            <p>商品がございませぬ。</p>
            <button
              type="button"
              onClick={() => {
                void reloadItemCatalog();
              }}
              disabled={reloadingCatalog}
              className="mt-2 rounded border border-[color:var(--kincha)]/45 bg-[color:var(--kincha)]/20 px-2 py-1 text-[11px] font-semibold text-[color:var(--kincha)] transition hover:bg-[color:var(--kincha)]/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {reloadingCatalog ? '再読込中...' : '再読込'}
            </button>
          </article>
        )}
      </section>
    </div>
  );
};

export default ShopView;
