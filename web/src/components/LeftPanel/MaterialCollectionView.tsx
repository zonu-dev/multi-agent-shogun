import { useMemo } from 'react';
import { ITEM_MASTER } from '@/data/item-master';
import { useGameStore } from '@/store/gameStore';
import type { Achievement, ItemDefinition, MaterialCollection } from '@/types';

const MATERIAL_ACHIEVEMENT_ID = 'material_collection_record';
const DEFAULT_THRESHOLDS = [30, 60, 100] as const;
const OBTAINED_AT_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const MATERIAL_ITEMS = ITEM_MASTER.filter((item) => item.itemType === 'material');
const MATERIAL_ITEM_ID_SET = new Set(MATERIAL_ITEMS.map((item) => item.id));

interface MaterialCollectionSnapshot {
  count: number;
  firstObtainedAt?: string;
}

interface MaterialCollectionRow {
  item: ItemDefinition;
  isObtained: boolean;
  firstObtainedAt?: string;
  inventoryCount: number;
}

const toNonNegativeInt = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
};

const toOptionalDateString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const formatFirstObtainedAt = (value?: string): string => {
  if (!value) {
    return '記録なし';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '記録なし';
  }

  return OBTAINED_AT_FORMATTER.format(parsed);
};

const resolveMaterialIcon = (item: ItemDefinition): string => {
  const name = item.name.trim();
  return name.length > 0 ? name.slice(0, 1) : '材';
};

const resolveMaterialThresholds = (achievement: Achievement | null): number[] => {
  const source = achievement?.thresholds ?? DEFAULT_THRESHOLDS;
  const normalized = Array.from(
    new Set(
      source
        .map((threshold) => toNonNegativeInt(threshold))
        .filter((threshold) => threshold > 0)
        .sort((left, right) => left - right)
    )
  );

  return normalized.length > 0 ? normalized : [...DEFAULT_THRESHOLDS];
};

const mergeMaterialCollectionEntries = (
  collection: readonly MaterialCollection[]
): Map<string, MaterialCollectionSnapshot> => {
  const byItemId = new Map<string, MaterialCollectionSnapshot>();

  for (const entry of collection) {
    if (!MATERIAL_ITEM_ID_SET.has(entry.itemId)) {
      continue;
    }

    const normalizedCount = toNonNegativeInt(entry.count);
    const normalizedFirstObtainedAt = toOptionalDateString(entry.firstObtainedAt);
    const existing = byItemId.get(entry.itemId);

    if (!existing) {
      byItemId.set(entry.itemId, {
        count: normalizedCount,
        ...(normalizedFirstObtainedAt ? { firstObtainedAt: normalizedFirstObtainedAt } : {}),
      });
      continue;
    }

    byItemId.set(entry.itemId, {
      count: Math.max(existing.count, normalizedCount),
      ...(existing.firstObtainedAt
        ? { firstObtainedAt: existing.firstObtainedAt }
        : normalizedFirstObtainedAt
          ? { firstObtainedAt: normalizedFirstObtainedAt }
          : {}),
    });
  }

  return byItemId;
};

const MaterialCollectionView = () => {
  const gameState = useGameStore((state) => state.gameState);
  const inventory = useGameStore((state) => state.inventory);

  const inventoryCountByItemId = useMemo(() => {
    const byItemId = new Map<string, number>();

    for (const entry of inventory) {
      if (!MATERIAL_ITEM_ID_SET.has(entry.itemId)) {
        continue;
      }

      byItemId.set(entry.itemId, toNonNegativeInt(entry.quantity));
    }

    return byItemId;
  }, [inventory]);

  const collectionByItemId = useMemo(
    () => mergeMaterialCollectionEntries(gameState?.materialCollection ?? []),
    [gameState?.materialCollection]
  );

  const materialRows = useMemo<MaterialCollectionRow[]>(
    () =>
      MATERIAL_ITEMS.map((item) => {
        const collectionEntry = collectionByItemId.get(item.id);
        const inventoryCount = inventoryCountByItemId.get(item.id) ?? 0;
        const recordedCount = collectionEntry?.count ?? 0;
        const isObtained = inventoryCount > 0 || recordedCount > 0;

        return {
          item,
          isObtained,
          firstObtainedAt: collectionEntry?.firstObtainedAt,
          inventoryCount,
        };
      }),
    [collectionByItemId, inventoryCountByItemId]
  );

  const obtainedCount = useMemo(
    () => materialRows.filter((row) => row.isObtained).length,
    [materialRows]
  );
  const totalCount = materialRows.length;
  const completionRate =
    totalCount > 0 ? Math.floor((obtainedCount / Math.max(1, totalCount)) * 100) : 0;

  const materialAchievement = useMemo(
    () =>
      (gameState?.achievements ?? []).find(
        (achievement) => achievement.id === MATERIAL_ACHIEVEMENT_ID
      ) ?? null,
    [gameState?.achievements]
  );

  const thresholds = useMemo(
    () => resolveMaterialThresholds(materialAchievement),
    [materialAchievement]
  );
  const achievementValue = toNonNegativeInt(materialAchievement?.currentValue);
  const badgeMetric = Math.max(completionRate, achievementValue);
  const reachedThresholdCount = thresholds.filter((threshold) => badgeMetric >= threshold).length;

  return (
    <section className="space-y-3 rounded-lg border border-[color:var(--kincha)]/25 bg-black/20 p-3 text-sm text-slate-100">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p
              className="text-[10px] font-semibold tracking-[0.1em] text-[color:var(--kincha)]/90"
              style={{ fontFamily: '"Noto Serif JP", serif' }}
            >
              素材蒐集帖
            </p>
            <h4 className="text-xs font-semibold text-slate-100">
              蒐集率: {obtainedCount}/{totalCount} ({completionRate}%)
            </h4>
          </div>
          <p className="rounded-md border border-[color:var(--kincha)]/35 bg-[color:var(--kincha)]/10 px-2 py-1 text-[11px] font-semibold text-[color:var(--kincha)]">
            達成段階: {reachedThresholdCount}/{thresholds.length}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {thresholds.map((threshold) => {
            const unlocked = badgeMetric >= threshold;
            return (
              <div
                key={`material-collection-threshold-${threshold}`}
                className={[
                  'rounded-md border px-2 py-1 text-center',
                  unlocked
                    ? 'border-amber-300/45 bg-amber-500/15 text-amber-100'
                    : 'border-slate-500/35 bg-slate-900/35 text-slate-300',
                ].join(' ')}
              >
                <p className="text-[11px] font-semibold">{threshold}%</p>
                <p className="text-[10px]">{unlocked ? '達成' : '未達'}</p>
              </div>
            );
          })}
        </div>
      </header>

      {totalCount > 0 ? (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {materialRows.map((row) => (
            <li key={`material-collection-entry-${row.item.id}`}>
              <article
                className={[
                  'flex items-center justify-between gap-2 rounded-md border p-2',
                  row.isObtained
                    ? 'border-[color:var(--kincha)]/25 bg-black/25'
                    : 'border-slate-500/25 bg-slate-900/30 opacity-70',
                ].join(' ')}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div
                    aria-hidden="true"
                    className={[
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-xs font-semibold',
                      row.isObtained
                        ? 'border-[color:var(--kincha)]/40 bg-[color:var(--kincha)]/15 text-[color:var(--kincha)]'
                        : 'border-slate-500/35 bg-slate-900/50 text-slate-400',
                    ].join(' ')}
                  >
                    {row.isObtained ? resolveMaterialIcon(row.item) : '?'}
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-xs font-semibold text-slate-100">
                      {row.isObtained ? row.item.name : '???'}
                    </p>
                    <p className="text-[10px] text-slate-300">
                      初獲得: {row.isObtained ? formatFirstObtainedAt(row.firstObtainedAt) : '--'}
                    </p>
                  </div>
                </div>
                <p className="shrink-0 rounded-md border border-[color:var(--kincha)]/30 bg-[color:var(--kincha)]/10 px-2 py-1 text-[11px] font-semibold text-[color:var(--kincha)]">
                  所持数: {row.isObtained ? row.inventoryCount : '--'}
                </p>
              </article>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-md border border-dashed border-slate-500/30 px-3 py-2 text-xs text-slate-300">
          素材定義なし
        </div>
      )}
    </section>
  );
};

export default MaterialCollectionView;
