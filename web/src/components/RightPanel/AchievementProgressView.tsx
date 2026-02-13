import { useMemo } from 'react';
import { ACHIEVEMENT_DEFINITIONS } from '@/lib/gamification/achievement-system';
import { useGameStore } from '@/store/gameStore';
import type { Achievement } from '@/types';

const STAR_SLOT_COUNT = 3;
const AUXILIARY_ACHIEVEMENT_IDS = [
  'castle_town_development_record',
  'material_collection_record',
  'edict_completion_record',
] as const;

type AchievementDefinition = (typeof ACHIEVEMENT_DEFINITIONS)[number];

interface AchievementViewModel {
  id: string;
  category: string;
  name: string;
  description: string;
  thresholds: number[];
  currentValue: number;
}

const toSafeInt = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
};

const normalizeThresholds = (thresholds: readonly number[]): number[] =>
  Array.from(new Set(thresholds.map((threshold) => toSafeInt(threshold)).filter((value) => value > 0))).sort(
    (left, right) => left - right
  );

const toViewModel = (
  definition: AchievementDefinition,
  savedAchievement: Achievement | undefined
): AchievementViewModel => ({
  id: definition.id,
  category: definition.category,
  name: definition.name,
  description: definition.description,
  thresholds: normalizeThresholds(definition.thresholds),
  currentValue: toSafeInt(savedAchievement?.currentValue),
});

const formatValue = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

const AchievementRow = ({ achievement }: { achievement: AchievementViewModel }) => {
  const unlockedStageCount = achievement.thresholds.filter(
    (threshold) => achievement.currentValue >= threshold
  ).length;
  const unlockedStars = Math.min(STAR_SLOT_COUNT, unlockedStageCount);
  const nextThreshold = achievement.thresholds.find((threshold) => achievement.currentValue < threshold);
  const finalThreshold =
    achievement.thresholds.length > 0 ? achievement.thresholds[achievement.thresholds.length - 1] : 0;
  const targetThreshold = nextThreshold ?? finalThreshold;
  const progressPercent =
    targetThreshold > 0 ? Math.min(100, (achievement.currentValue / targetThreshold) * 100) : 0;
  const isCompleted = achievement.thresholds.length > 0 && unlockedStageCount >= achievement.thresholds.length;

  return (
    <article className="rounded-lg border border-[color:var(--kincha)]/25 bg-black/20 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-100">{achievement.name}</p>
          <p className="text-[10px] text-slate-300">{achievement.description}</p>
        </div>
        <span
          className={[
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
            isCompleted
              ? 'border-[color:var(--kincha)]/45 bg-[color:var(--kincha)]/20 text-[color:var(--kincha)]'
              : 'border-slate-400/30 bg-black/30 text-slate-300',
          ].join(' ')}
        >
          {isCompleted ? '満願' : `第${Math.min(unlockedStageCount + 1, STAR_SLOT_COUNT)}段`}
        </span>
      </div>

      <p className="mt-1 text-sm leading-none" aria-label={`${achievement.name} 段階`}>
        {Array.from({ length: STAR_SLOT_COUNT }, (_, index) => (
          <span
            key={`${achievement.id}-star-${index}`}
            className={index < unlockedStars ? 'text-[color:var(--kincha)]' : 'text-slate-500'}
          >
            {index < unlockedStars ? '★' : '☆'}
          </span>
        ))}
      </p>

      <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/35 ring-1 ring-[color:var(--kincha)]/25">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-400/80 to-[color:var(--kincha)]"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <p className="mt-1 text-[11px] text-slate-300">
        進捗 {formatValue(achievement.currentValue)}/
        {targetThreshold > 0 ? formatValue(targetThreshold) : '-'}
      </p>
    </article>
  );
};

const AchievementProgressView = () => {
  const achievements = useGameStore((state) => state.gameState?.achievements ?? []);

  const { taskMasteryAchievements, auxiliaryAchievements } = useMemo(() => {
    const byId = new Map<string, Achievement>();
    for (const achievement of achievements) {
      byId.set(achievement.id, achievement);
    }

    const viewModels = ACHIEVEMENT_DEFINITIONS.map((definition) =>
      toViewModel(definition, byId.get(definition.id))
    );
    const taskMastery = viewModels.filter((achievement) => achievement.category === 'task_mastery');
    const auxiliaryById = new Map(viewModels.map((achievement) => [achievement.id, achievement] as const));
    const auxiliary = AUXILIARY_ACHIEVEMENT_IDS.map((id) => auxiliaryById.get(id)).filter(
      (achievement): achievement is AchievementViewModel => achievement !== undefined
    );

    return {
      taskMasteryAchievements: taskMastery,
      auxiliaryAchievements: auxiliary,
    };
  }, [achievements]);

  return (
    <section className="space-y-3 rounded-lg border border-[color:var(--kincha)]/25 bg-black/20 p-3">
      <h4
        className="text-xs font-semibold tracking-[0.08em] text-[color:var(--kincha)]"
        style={{ fontFamily: '"Noto Serif JP", serif' }}
      >
        武功録
      </h4>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-slate-200">兵科別武勲章</p>
        {taskMasteryAchievements.length > 0 ? (
          <div className="space-y-2">
            {taskMasteryAchievements.map((achievement) => (
              <AchievementRow key={achievement.id} achievement={achievement} />
            ))}
          </div>
        ) : (
          <p className="rounded border border-dashed border-slate-500/35 px-2 py-1 text-[11px] text-slate-300">
            武勲章データなし
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-slate-200">諸記録</p>
        {auxiliaryAchievements.length > 0 ? (
          <div className="space-y-2">
            {auxiliaryAchievements.map((achievement) => (
              <AchievementRow key={achievement.id} achievement={achievement} />
            ))}
          </div>
        ) : (
          <p className="rounded border border-dashed border-slate-500/35 px-2 py-1 text-[11px] text-slate-300">
            記録データなし
          </p>
        )}
      </div>
    </section>
  );
};

export default AchievementProgressView;
