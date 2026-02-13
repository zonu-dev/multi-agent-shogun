import { useMemo } from 'react';
import type { Achievement, Building, BuildingType, Title } from '@/types';

interface BuildingAchievementViewProps {
  buildings: readonly Building[];
  achievements: readonly Achievement[];
  titles: readonly Title[];
}

interface BuildingProgressMetrics {
  allLevel3Count: number;
  specializedLevel3Count: number;
  allLevel5Count: number;
}

const DEVELOPMENT_ACHIEVEMENT_ID = 'castle_town_development_record';
const DEFAULT_DEVELOPMENT_THRESHOLDS = [3, 7, 10] as const;

const ALL_BUILDING_TYPES: readonly BuildingType[] = [
  'castle',
  'mansion',
  'inn',
  'dojo',
  'smithy',
  'training',
  'study',
  'healer',
  'watchtower',
  'scriptorium',
] as const;

const SPECIALIZED_BUILDING_TYPES: readonly BuildingType[] = [
  'dojo',
  'smithy',
  'training',
  'study',
  'healer',
  'watchtower',
  'scriptorium',
] as const;

const toNonNegativeInt = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
};

const normalizeThresholds = (thresholds: readonly number[]): number[] => {
  return Array.from(
    new Set(
      thresholds
        .map((threshold) => toNonNegativeInt(threshold))
        .filter((threshold) => threshold > 0)
        .sort((left, right) => left - right)
    )
  );
};

const hasUnlockedAt = (title: Title | undefined): boolean => {
  if (typeof title?.unlockedAt !== 'string') {
    return false;
  }

  return title.unlockedAt.trim().length > 0;
};

const countBuildingsAtOrAboveLevel = (
  buildings: readonly Building[],
  level: number,
  scope: 'all' | 'specialized'
): number => {
  const targetTypes = scope === 'specialized' ? SPECIALIZED_BUILDING_TYPES : ALL_BUILDING_TYPES;
  const levelByType = new Map<BuildingType, number>();

  for (const building of buildings) {
    levelByType.set(building.type, toNonNegativeInt(building.level));
  }

  return targetTypes.filter((type) => (levelByType.get(type) ?? 0) >= level).length;
};

const BuildingAchievementView = ({ buildings, achievements, titles }: BuildingAchievementViewProps) => {
  const progressMetrics = useMemo<BuildingProgressMetrics>(() => {
    return {
      allLevel3Count: countBuildingsAtOrAboveLevel(buildings, 3, 'all'),
      specializedLevel3Count: countBuildingsAtOrAboveLevel(buildings, 3, 'specialized'),
      allLevel5Count: countBuildingsAtOrAboveLevel(buildings, 5, 'all'),
    };
  }, [buildings]);

  const developmentRecord = useMemo(
    () => achievements.find((achievement) => achievement.id === DEVELOPMENT_ACHIEVEMENT_ID),
    [achievements]
  );

  const thresholds = useMemo(() => {
    const source = Array.isArray(developmentRecord?.thresholds)
      ? developmentRecord.thresholds
      : DEFAULT_DEVELOPMENT_THRESHOLDS;
    const normalized = normalizeThresholds(source);
    return normalized.length > 0 ? normalized : [...DEFAULT_DEVELOPMENT_THRESHOLDS];
  }, [developmentRecord?.thresholds]);

  const maxThreshold = thresholds[thresholds.length - 1] ?? DEFAULT_DEVELOPMENT_THRESHOLDS[2];
  const developmentCurrentValue = toNonNegativeInt(
    developmentRecord?.currentValue ?? progressMetrics.allLevel3Count
  );
  const developmentProgressRate = Math.min(
    100,
    maxThreshold > 0 ? Math.round((developmentCurrentValue / maxThreshold) * 100) : 0
  );

  const titleById = useMemo(() => {
    return titles.reduce<Map<string, Title>>((acc, title) => {
      if (typeof title.id === 'string' && title.id.trim().length > 0) {
        acc.set(title.id, title);
      }
      return acc;
    }, new Map<string, Title>());
  }, [titles]);

  const titleCards = [
    {
      id: 'fushin_apprentice',
      name: '建造見習い',
      condition: '建物3棟をLv3以上',
      progress: `${progressMetrics.allLevel3Count}/3棟`,
    },
    {
      id: 'castle_town_magistrate',
      name: '城下奉行',
      condition: '専門7棟をLv3以上',
      progress: `${progressMetrics.specializedLevel3Count}/7棟`,
    },
    {
      id: 'tenka_fushin',
      name: '天下建造',
      condition: '全建物をLv5以上',
      progress: `${progressMetrics.allLevel5Count}/${ALL_BUILDING_TYPES.length}棟`,
    },
  ] as const;

  return (
    <section className="space-y-3 rounded-lg border border-[color:var(--kincha)]/35 bg-black/30 p-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4
            className="text-xs font-semibold tracking-[0.08em] text-[color:var(--kincha)]"
            style={{ fontFamily: '"Noto Serif JP", serif' }}
          >
            城下建造譜
          </h4>
          <p className="text-[11px] font-semibold text-slate-100">
            Lv3以上 {developmentCurrentValue} / {maxThreshold}
          </p>
        </div>

        <div className="h-2.5 overflow-hidden rounded-full border border-[color:var(--kincha)]/35 bg-black/40">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-300/80 via-[color:var(--kincha)] to-amber-500 transition-all"
            style={{ width: `${developmentProgressRate}%` }}
          />
        </div>

        <ul className="grid grid-cols-3 gap-1">
          {thresholds.map((threshold) => {
            const reached = developmentCurrentValue >= threshold;
            return (
              <li
                key={`construction-threshold-${threshold}`}
                className={[
                  'rounded border px-1.5 py-1 text-center text-[10px] font-semibold',
                  reached
                    ? 'border-amber-300/70 bg-amber-400/15 text-amber-100'
                    : 'border-slate-500/35 bg-black/25 text-slate-300',
                ].join(' ')}
              >
                {threshold}棟
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-1.5 border-t border-[color:var(--kincha)]/25 pt-2">
        <p className="text-[11px] font-semibold text-[color:var(--kincha)]">建物称号</p>
        {titleCards.map((titleCard) => {
          const matched = titleById.get(titleCard.id);
          const unlocked = hasUnlockedAt(matched);
          const description = matched?.description ?? titleCard.condition;

          return (
            <article
              key={`building-title-progress-${titleCard.id}`}
              className={[
                'rounded-md border px-2.5 py-2 text-[11px]',
                unlocked
                  ? 'border-amber-300/70 bg-amber-500/10 text-amber-100'
                  : 'border-slate-500/35 bg-black/25 text-slate-200',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{titleCard.name}</p>
                <span
                  className={[
                    'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                    unlocked ? 'bg-amber-300/25 text-amber-100' : 'bg-slate-500/30 text-slate-200',
                  ].join(' ')}
                >
                  {unlocked ? '解放済み' : '未解放'}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-slate-300">{description}</p>
              <p className="mt-1 font-semibold">進捗: {titleCard.progress}</p>
              {!unlocked ? <p className="text-[10px] text-slate-300">条件: {titleCard.condition}</p> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default BuildingAchievementView;
