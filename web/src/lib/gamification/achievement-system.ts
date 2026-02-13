import { ITEM_MASTER } from '../../data/item-master';
import type {
  Achievement,
  BuildingType,
  GameState,
  TaskCategory,
  Title,
} from '../../types/game';

type AchievementMetric =
  | {
      type: 'task_complete_count';
      category: TaskCategory;
    }
  | {
      type: 'material_completion_rate';
    }
  | {
      type: 'building_count_at_or_above_level';
      level: number;
      scope: 'all' | 'specialized';
    }
  | {
      type: 'mission_claimed_count';
    };

interface AchievementDefinition extends Omit<Achievement, 'currentValue' | 'unlockedAt'> {
  metric: AchievementMetric;
}

type TitleCondition =
  | {
      type: 'mission_claimed_count';
      threshold: number;
    }
  | {
      type: 'building_count_at_or_above_level';
      threshold: number;
      level: number;
      scope: 'all' | 'specialized';
    }
  | {
      type: 'all_buildings_at_or_above_level';
      level: number;
    }
  | {
      type: 'total_tasks_completed';
      threshold: number;
    }
  | {
      type: 'total_gold_earned';
      threshold: number;
    }
  | {
      type: 'material_completion_rate';
      threshold: number;
    }
  | {
      type: 'decoration_placed_count';
      threshold: number;
    }
  | {
      type: 'total_xp_earned';
      threshold: number;
    };

type TitleCategory = NonNullable<Title['category']>;

interface TitleDefinition extends Omit<Title, 'unlockedAt' | 'category'> {
  category: TitleCategory;
  conditionSpec: TitleCondition;
}

export interface AchievementUnlock {
  id: string;
  name: string;
  reachedThreshold: number;
  currentValue: number;
  unlockedAt: string;
}

export interface AchievementCheckResult {
  achievements: Achievement[];
  unlocked: AchievementUnlock[];
}

export interface TitleCheckResult {
  titles: Title[];
  unlocked: Title[];
}

const TRACKED_TASK_CATEGORIES: readonly TaskCategory[] = [
  'new_implementation',
  'refactoring',
  'skill_creation',
  'analysis',
  'bug_fix',
  'docs',
  'test',
] as const;

const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  new_implementation: '新規実装',
  refactoring: '改修',
  skill_creation: '錬成',
  analysis: '軍議',
  bug_fix: '蟲討伐',
  docs: '記録作成',
  test: '検分',
  idle: '待機',
  other: '雑務',
};

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

const SPECIALIZED_BUILDINGS: readonly BuildingType[] = [
  'dojo',
  'smithy',
  'training',
  'study',
  'healer',
  'watchtower',
  'scriptorium',
] as const;

const MATERIAL_ITEM_IDS = ITEM_MASTER.filter((item) => item.itemType === 'material').map(
  (item) => item.id
);
const MATERIAL_ITEM_ID_SET = new Set<string>(MATERIAL_ITEM_IDS);

const TASK_CATEGORY_ACHIEVEMENTS: AchievementDefinition[] = TRACKED_TASK_CATEGORIES.map(
  (category) => ({
    id: `task_mastery_${category}`,
    category: 'task_mastery',
    name: `${TASK_CATEGORY_LABELS[category]}武勲章`,
    description: `${TASK_CATEGORY_LABELS[category]}の完了数で段階達成（10/30/60）`,
    thresholds: [10, 30, 60],
    metric: {
      type: 'task_complete_count',
      category,
    },
  })
);

export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] = [
  ...TASK_CATEGORY_ACHIEVEMENTS,
  {
    id: 'castle_town_development_record',
    category: 'castle_town_development',
    name: '城下建造譜',
    description: '建物育成の段階記録（3/7/10棟をLv3以上）',
    thresholds: [3, 7, 10],
    metric: {
      type: 'building_count_at_or_above_level',
      level: 3,
      scope: 'all',
    },
  },
  {
    id: 'material_collection_record',
    category: 'material_collection',
    name: '素材蒐集帖',
    description: '素材蒐集率の段階達成（30/60/100%）',
    thresholds: [30, 60, 100],
    metric: {
      type: 'material_completion_rate',
    },
  },
  {
    id: 'edict_completion_record',
    category: 'mission_progress',
    name: '御触書達成録',
    description: '御触書累計達成段階（5/20/50件）',
    thresholds: [5, 20, 50],
    metric: {
      type: 'mission_claimed_count',
    },
  },
] as const;

export const TITLE_DEFINITIONS: readonly TitleDefinition[] = [
  {
    id: 'fushin_apprentice',
    category: 'construction',
    name: '縄張り番',
    description: '建物を3棟以上Lv3へ育て上げた者',
    condition: 'building_count_at_or_above_level:all:3:3',
    conditionSpec: {
      type: 'building_count_at_or_above_level',
      scope: 'all',
      level: 3,
      threshold: 3,
    },
  },
  {
    id: 'castle_town_magistrate',
    category: 'construction',
    name: '石垣積みの鬼',
    description: '専門7棟をすべてLv3以上へ整えし者',
    condition: 'building_count_at_or_above_level:specialized:3:7',
    conditionSpec: {
      type: 'building_count_at_or_above_level',
      scope: 'specialized',
      level: 3,
      threshold: 7,
    },
  },
  {
    id: 'tenka_fushin',
    category: 'construction',
    name: '太閤普請',
    description: '全建物をLv5まで鍛え上げた大建造の達人',
    condition: 'all_buildings_at_or_above_level:5',
    conditionSpec: {
      type: 'all_buildings_at_or_above_level',
      level: 5,
    },
  },
  {
    id: 'foot_captain',
    category: 'martial',
    name: '一番槍',
    description: 'タスク累計10件を果たした者',
    condition: 'total_tasks_completed:10',
    conditionSpec: {
      type: 'total_tasks_completed',
      threshold: 10,
    },
  },
  {
    id: 'samurai_commander',
    category: 'martial',
    name: '先陣大将',
    description: 'タスク累計50件を果たした者',
    condition: 'total_tasks_completed:50',
    conditionSpec: {
      type: 'total_tasks_completed',
      threshold: 50,
    },
  },
  {
    id: 'warlord',
    category: 'martial',
    name: '鬼武者',
    description: 'タスク累計100件を果たした者',
    condition: 'total_tasks_completed:100',
    conditionSpec: {
      type: 'total_tasks_completed',
      threshold: 100,
    },
  },
  {
    id: 'peerless_warrior',
    category: 'martial',
    name: '軍神',
    description: 'タスク累計200件を果たした者',
    condition: 'total_tasks_completed:200',
    conditionSpec: {
      type: 'total_tasks_completed',
      threshold: 200,
    },
  },
  {
    id: 'edict_apprentice',
    category: 'magistrate',
    name: '朱印書記',
    description: '御触書を累計5件成就せし者',
    condition: 'mission_claimed_count:5',
    conditionSpec: {
      type: 'mission_claimed_count',
      threshold: 5,
    },
  },
  {
    id: 'edict_magistrate',
    category: 'magistrate',
    name: '町触奉行',
    description: '御触書を累計20件成就せし者',
    condition: 'mission_claimed_count:20',
    conditionSpec: {
      type: 'mission_claimed_count',
      threshold: 20,
    },
  },
  {
    id: 'edict_shogun',
    category: 'magistrate',
    name: '公儀御目付頭',
    description: '御触書を累計50件成就せし者',
    condition: 'mission_claimed_count:50',
    conditionSpec: {
      type: 'mission_claimed_count',
      threshold: 50,
    },
  },
  {
    id: 'gold_apprentice',
    category: 'magistrate',
    name: '銭勘定',
    description: '総獲得ゴールド500以上を成した者',
    condition: 'total_gold_earned:500',
    conditionSpec: {
      type: 'total_gold_earned',
      threshold: 500,
    },
  },
  {
    id: 'gold_merchant',
    category: 'magistrate',
    name: '千両箱番',
    description: '総獲得ゴールド5000以上を成した者',
    condition: 'total_gold_earned:5000',
    conditionSpec: {
      type: 'total_gold_earned',
      threshold: 5000,
    },
  },
  {
    id: 'gold_tycoon',
    category: 'magistrate',
    name: '天下の台所',
    description: '総獲得ゴールド20000以上を成した者',
    condition: 'total_gold_earned:20000',
    conditionSpec: {
      type: 'total_gold_earned',
      threshold: 20000,
    },
  },
  {
    id: 'material_apprentice',
    category: 'collection',
    name: '拾い屋',
    description: '素材蒐集率30%以上を達した者',
    condition: 'material_completion_rate:30',
    conditionSpec: {
      type: 'material_completion_rate',
      threshold: 30,
    },
  },
  {
    id: 'material_magistrate',
    category: 'collection',
    name: '目利き衆',
    description: '素材蒐集率60%以上を達した者',
    condition: 'material_completion_rate:60',
    conditionSpec: {
      type: 'material_completion_rate',
      threshold: 60,
    },
  },
  {
    id: 'material_master',
    category: 'collection',
    name: '南蛮渡来通',
    description: '素材蒐集率100%を達した者',
    condition: 'material_completion_rate:100',
    conditionSpec: {
      type: 'material_completion_rate',
      threshold: 100,
    },
  },
  {
    id: 'deco_apprentice',
    category: 'collection',
    name: '石灯籠守',
    description: '装飾を3個配置した者',
    condition: 'decoration_placed_count:3',
    conditionSpec: {
      type: 'decoration_placed_count',
      threshold: 3,
    },
  },
  {
    id: 'deco_magistrate',
    category: 'collection',
    name: '枯山水棟梁',
    description: '装飾を7個配置した者',
    condition: 'decoration_placed_count:7',
    conditionSpec: {
      type: 'decoration_placed_count',
      threshold: 7,
    },
  },
  {
    id: 'deco_master',
    category: 'collection',
    name: '借景の宗匠',
    description: '装飾を15個配置した者',
    condition: 'decoration_placed_count:15',
    conditionSpec: {
      type: 'decoration_placed_count',
      threshold: 15,
    },
  },
  {
    id: 'xp_apprentice',
    category: 'collection',
    name: '木刀小姓',
    description: '総獲得XP1000以上を成した者',
    condition: 'total_xp_earned:1000',
    conditionSpec: {
      type: 'total_xp_earned',
      threshold: 1000,
    },
  },
  {
    id: 'xp_master',
    category: 'collection',
    name: '兵法師範',
    description: '総獲得XP5000以上を成した者',
    condition: 'total_xp_earned:5000',
    conditionSpec: {
      type: 'total_xp_earned',
      threshold: 5000,
    },
  },
  {
    id: 'xp_sage',
    category: 'collection',
    name: '剣聖',
    description: '総獲得XP20000以上を成した者',
    condition: 'total_xp_earned:20000',
    conditionSpec: {
      type: 'total_xp_earned',
      threshold: 20000,
    },
  },
] as const;

const toNonNegativeInt = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
};

const asOptionalNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

const countCompletedTasksByCategory = (
  gameState: Pick<GameState, 'activityLog'>
): Record<TaskCategory, number> => {
  const base: Record<TaskCategory, number> = {
    new_implementation: 0,
    refactoring: 0,
    skill_creation: 0,
    analysis: 0,
    bug_fix: 0,
    docs: 0,
    test: 0,
    idle: 0,
    other: 0,
  };

  for (const entry of gameState.activityLog) {
    if (entry.type !== 'work_complete') {
      continue;
    }

    const category = entry.taskCategory;
    if (category === undefined || !Object.prototype.hasOwnProperty.call(base, category)) {
      continue;
    }

    base[category as TaskCategory] += 1;
  }

  return base;
};

const countCompletedTasks = (gameState: Pick<GameState, 'activityLog'>): number => {
  return gameState.activityLog.filter((entry) => entry.type === 'work_complete').length;
};

const countMissionClaims = (gameState: Pick<GameState, 'activityLog' | 'missions'>): number => {
  const fromActivityLog = gameState.activityLog.filter((entry) => entry.type === 'mission_complete')
    .length;
  const currentlyClaimed = gameState.missions.filter((mission) => mission.claimed === true).length;
  return Math.max(fromActivityLog, currentlyClaimed);
};

const sumPositiveActivityMetric = (
  gameState: Pick<GameState, 'activityLog'>,
  field: 'gold' | 'xp'
): number => {
  let total = 0;
  for (const entry of gameState.activityLog) {
    const value = toNonNegativeInt(entry[field]);
    total += value;
  }
  return total;
};

const estimateTotalGoldEarned = (
  gameState: Pick<GameState, 'activityLog' | 'town' | 'economy'>
): number => {
  const fromActivity = sumPositiveActivityMetric(gameState, 'gold');
  const fromTown = toNonNegativeInt(gameState.town.gold);
  const fromEconomy = toNonNegativeInt(gameState.economy.gold);
  return Math.max(fromActivity, fromTown, fromEconomy);
};

const estimateTotalXPEarned = (gameState: Pick<GameState, 'activityLog' | 'town'>): number => {
  const fromActivity = sumPositiveActivityMetric(gameState, 'xp');
  const fromTown = toNonNegativeInt(gameState.town.xp);
  return Math.max(fromActivity, fromTown);
};

const countPlacedDecorations = (gameState: Pick<GameState, 'decorations'>): number => {
  return gameState.decorations.filter((decoration) => decoration.position !== undefined).length;
};

const countBuildingsAtOrAboveLevel = (
  gameState: Pick<GameState, 'buildings'>,
  level: number,
  scope: 'all' | 'specialized'
): number => {
  const targetBuildings = scope === 'specialized' ? SPECIALIZED_BUILDINGS : ALL_BUILDING_TYPES;
  const levelByType = new Map<BuildingType, number>(
    gameState.buildings.map((building) => [building.type, toNonNegativeInt(building.level)])
  );

  return targetBuildings.filter((type) => (levelByType.get(type) ?? 0) >= level).length;
};

const isAllBuildingsAtOrAboveLevel = (
  gameState: Pick<GameState, 'buildings'>,
  level: number
): boolean => {
  return countBuildingsAtOrAboveLevel(gameState, level, 'all') >= ALL_BUILDING_TYPES.length;
};

const countMaterialCompletionRate = (
  gameState: Pick<GameState, 'materialCollection' | 'inventory'>
): number => {
  if (MATERIAL_ITEM_IDS.length < 1) {
    return 0;
  }

  const obtainedItemIds = new Set<string>();

  for (const entry of gameState.materialCollection) {
    if (!MATERIAL_ITEM_ID_SET.has(entry.itemId)) {
      continue;
    }
    if (toNonNegativeInt(entry.count) > 0) {
      obtainedItemIds.add(entry.itemId);
    }
  }

  for (const entry of gameState.inventory) {
    if (!MATERIAL_ITEM_ID_SET.has(entry.itemId)) {
      continue;
    }
    if (toNonNegativeInt(entry.quantity) > 0) {
      obtainedItemIds.add(entry.itemId);
    }
  }

  return Math.floor((obtainedItemIds.size / MATERIAL_ITEM_IDS.length) * 100);
};

const resolveAchievementMetricValue = (
  definition: AchievementDefinition,
  gameState: GameState,
  completedTaskCountsByCategory: Record<TaskCategory, number>,
  missionClaimCount: number
): number => {
  if (definition.metric.type === 'task_complete_count') {
    return completedTaskCountsByCategory[definition.metric.category] ?? 0;
  }

  if (definition.metric.type === 'material_completion_rate') {
    return countMaterialCompletionRate(gameState);
  }

  if (definition.metric.type === 'building_count_at_or_above_level') {
    return countBuildingsAtOrAboveLevel(gameState, definition.metric.level, definition.metric.scope);
  }

  return missionClaimCount;
};

const getHighestReachedThreshold = (thresholds: readonly number[], value: number): number => {
  let reached = 0;
  for (const threshold of thresholds) {
    if (value >= threshold) {
      reached = threshold;
    }
  }
  return reached;
};

const toAchievementRecordMap = (achievements: readonly Achievement[]): Map<string, Achievement> => {
  const byId = new Map<string, Achievement>();
  for (const achievement of achievements) {
    if (typeof achievement.id !== 'string' || achievement.id.trim().length < 1) {
      continue;
    }
    byId.set(achievement.id, achievement);
  }
  return byId;
};

const toTitleRecordMap = (titles: readonly Title[]): Map<string, Title> => {
  const byId = new Map<string, Title>();
  for (const title of titles) {
    if (typeof title.id !== 'string' || title.id.trim().length < 1) {
      continue;
    }
    byId.set(title.id, title);
  }
  return byId;
};

const isTitleConditionSatisfied = (condition: TitleCondition, gameState: GameState): boolean => {
  if (condition.type === 'mission_claimed_count') {
    return countMissionClaims(gameState) >= condition.threshold;
  }

  if (condition.type === 'building_count_at_or_above_level') {
    return (
      countBuildingsAtOrAboveLevel(gameState, condition.level, condition.scope) >= condition.threshold
    );
  }

  if (condition.type === 'all_buildings_at_or_above_level') {
    return isAllBuildingsAtOrAboveLevel(gameState, condition.level);
  }

  if (condition.type === 'total_tasks_completed') {
    return countCompletedTasks(gameState) >= condition.threshold;
  }

  if (condition.type === 'total_gold_earned') {
    return estimateTotalGoldEarned(gameState) >= condition.threshold;
  }

  if (condition.type === 'material_completion_rate') {
    return countMaterialCompletionRate(gameState) >= condition.threshold;
  }

  if (condition.type === 'decoration_placed_count') {
    return countPlacedDecorations(gameState) >= condition.threshold;
  }

  return estimateTotalXPEarned(gameState) >= condition.threshold;
};

export const checkAchievements = (gameState: GameState): AchievementCheckResult => {
  const now = new Date().toISOString();
  const byId = toAchievementRecordMap(gameState.achievements ?? []);
  const completedTaskCountsByCategory = countCompletedTasksByCategory(gameState);
  const missionClaimCount = countMissionClaims(gameState);
  const definedIds = new Set<string>(ACHIEVEMENT_DEFINITIONS.map((definition) => definition.id));
  const nextAchievements: Achievement[] = [];
  const unlocked: AchievementUnlock[] = [];

  for (const definition of ACHIEVEMENT_DEFINITIONS) {
    const existing = byId.get(definition.id);
    const normalizedThresholds = normalizeThresholds(definition.thresholds);
    const currentValue = resolveAchievementMetricValue(
      definition,
      gameState,
      completedTaskCountsByCategory,
      missionClaimCount
    );
    const previousValue = toNonNegativeInt(existing?.currentValue);
    const previousReachedThreshold = getHighestReachedThreshold(normalizedThresholds, previousValue);
    const reachedThreshold = getHighestReachedThreshold(normalizedThresholds, currentValue);
    const unlockedAt =
      asOptionalNonEmptyString(existing?.unlockedAt) ??
      (reachedThreshold > 0 ? now : undefined);

    if (reachedThreshold > previousReachedThreshold && unlockedAt !== undefined) {
      unlocked.push({
        id: definition.id,
        name: definition.name,
        reachedThreshold,
        currentValue,
        unlockedAt,
      });
    }

    nextAchievements.push({
      id: definition.id,
      category: definition.category,
      name: definition.name,
      description: definition.description,
      thresholds: normalizedThresholds,
      currentValue,
      ...(unlockedAt ? { unlockedAt } : {}),
    });
  }

  for (const achievement of gameState.achievements ?? []) {
    if (definedIds.has(achievement.id)) {
      continue;
    }

    nextAchievements.push({
      ...achievement,
      thresholds: normalizeThresholds(achievement.thresholds ?? []),
      currentValue: toNonNegativeInt(achievement.currentValue),
      ...(asOptionalNonEmptyString(achievement.unlockedAt)
        ? { unlockedAt: asOptionalNonEmptyString(achievement.unlockedAt) }
        : {}),
    });
  }

  return {
    achievements: nextAchievements,
    unlocked,
  };
};

export const checkTitles = (gameState: GameState): TitleCheckResult => {
  const now = new Date().toISOString();
  const existingById = toTitleRecordMap(gameState.titles ?? []);
  const definedIds = new Set<string>(TITLE_DEFINITIONS.map((definition) => definition.id));
  const nextTitles: Title[] = [];
  const unlocked: Title[] = [];

  for (const definition of TITLE_DEFINITIONS) {
    const existing = existingById.get(definition.id);
    const eligible = isTitleConditionSatisfied(definition.conditionSpec, gameState);
    const existingUnlockedAt = asOptionalNonEmptyString(existing?.unlockedAt);

    if (!eligible && existingUnlockedAt === undefined) {
      continue;
    }

    const unlockedAt = existingUnlockedAt ?? (eligible ? now : undefined);
    if (existingUnlockedAt === undefined && unlockedAt !== undefined) {
      unlocked.push({
        id: definition.id,
        name: definition.name,
        description: definition.description,
        condition: definition.condition,
        category: definition.category,
        unlockedAt,
      });
    }

    nextTitles.push({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      condition: definition.condition,
      category: definition.category,
      ...(unlockedAt ? { unlockedAt } : {}),
    });
  }

  for (const title of gameState.titles ?? []) {
    if (definedIds.has(title.id)) {
      continue;
    }

    const unlockedAt = asOptionalNonEmptyString(title.unlockedAt);
    nextTitles.push({
      ...title,
      ...(unlockedAt ? { unlockedAt } : {}),
    });
  }

  return {
    titles: nextTitles,
    unlocked,
  };
};

export const resolveEquippedTitle = (
  equippedTitleId: string | null | undefined,
  titles: readonly Title[]
): string | null => {
  const unlockedTitleIds = new Set(
    titles
      .filter((title) => asOptionalNonEmptyString(title.unlockedAt) !== undefined)
      .map((title) => title.id)
  );

  if (typeof equippedTitleId === 'string' && unlockedTitleIds.has(equippedTitleId)) {
    return equippedTitleId;
  }

  const fallback = titles.find((title) => asOptionalNonEmptyString(title.unlockedAt) !== undefined);
  return fallback?.id ?? null;
};
