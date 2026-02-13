import { useEffect, useMemo, useState } from 'react';
import { ITEM_MASTER } from '@/data/item-master';
import { ACHIEVEMENT_DEFINITIONS, TITLE_DEFINITIONS } from '@/lib/gamification/achievement-system';
import { useGameStore } from '@/store/gameStore';
import type {
  Achievement,
  ActivityLogEntry,
  Building,
  BuildingType,
  Decoration,
  GameState,
  InventoryItem,
  MaterialCollection,
  Mission,
  TaskCategory,
  Title,
} from '@/types';

export type BukanTab = 'martial' | 'construction' | 'magistrate' | 'collection';
type TrackedTaskCategory = Exclude<TaskCategory, 'idle' | 'other'>;
type BuildingScope = 'all' | 'specialized';
export type EquippedTitleSelectValue = string | '__none__';

interface ProgressSnapshot {
  activityLog: readonly ActivityLogEntry[];
  missions: readonly Mission[];
  buildings: readonly Building[];
  decorations: readonly Decoration[];
  materialCollection: readonly MaterialCollection[];
  inventory: readonly InventoryItem[];
  town: GameState['town'];
  economy: GameState['economy'];
}

export interface ProgressCardModel {
  id: string;
  name: string;
  description: string;
  current: number;
  target: number;
  unit: string;
  completed: boolean;
  detail?: string;
}

type AchievementDefinition = (typeof ACHIEVEMENT_DEFINITIONS)[number];

export const BUKAN_TABS: readonly BukanTab[] = ['martial', 'construction', 'magistrate', 'collection'];
export const BUKAN_TAB_LABELS: Record<BukanTab, string> = {
  martial: '武功',
  construction: '築城',
  magistrate: '奉行',
  collection: '蒐集',
};

const API_AUTH_HEADER = 'x-shogun-token';
const DEFAULT_API_AUTH_TOKEN = 'shogun-local-dev-token';
const CASTLE_TOWN_DEVELOPMENT_RECORD_ID = 'castle_town_development_record';
const TASK_MASTERY_ID_PREFIX = 'task_mastery_';
const TITLE_UNLOCKED_ERROR_PATTERN = /^Title is not unlocked:\s*(.+)$/i;
const TITLE_ID_INVALID_ERROR_PATTERN = /^titleId must be a non-empty string or null\.?$/i;
const MATERIAL_ITEM_ID_SET = new Set(
  ITEM_MASTER.filter((item) => item.itemType === 'material').map((item) => item.id)
);

const EMPTY_TOWN: GameState['town'] = {
  level: 1,
  xp: 0,
  gold: 0,
};
const EMPTY_ECONOMY: GameState['economy'] = {
  gold: 0,
};

const TRACKED_TASK_CATEGORIES: readonly TrackedTaskCategory[] = [
  'new_implementation',
  'refactoring',
  'skill_creation',
  'analysis',
  'bug_fix',
  'docs',
  'test',
];
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
];
const SPECIALIZED_BUILDING_TYPES: readonly BuildingType[] = [
  'dojo',
  'smithy',
  'training',
  'study',
  'healer',
  'watchtower',
  'scriptorium',
];

const toNonNegativeInt = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
};

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.floor(parsed));
};

const asOptionalNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const hasUnlockedAt = (title: Title | undefined): boolean =>
  asOptionalNonEmptyString(title?.unlockedAt) !== undefined;

const normalizeThresholds = (thresholds: readonly number[]): number[] =>
  Array.from(
    new Set(
      thresholds
        .map((threshold) => toNonNegativeInt(threshold))
        .filter((threshold) => threshold > 0)
        .sort((left, right) => left - right)
    )
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const hasOptionalArrayField = (value: Record<string, unknown>, key: string): boolean =>
  value[key] === undefined || Array.isArray(value[key]);

const hasOptionalNullableStringField = (value: Record<string, unknown>, key: string): boolean =>
  value[key] === undefined || value[key] === null || typeof value[key] === 'string';

const isGameStatePayload = (value: unknown): value is GameState =>
  isRecord(value) &&
  Array.isArray(value.ashigaru) &&
  Array.isArray(value.buildings) &&
  isRecord(value.town) &&
  isRecord(value.economy) &&
  Array.isArray(value.inventory) &&
  Array.isArray(value.decorations) &&
  Array.isArray(value.missions) &&
  Array.isArray(value.activityLog) &&
  hasOptionalArrayField(value, 'achievements') &&
  hasOptionalArrayField(value, 'titles') &&
  hasOptionalNullableStringField(value, 'equippedTitle') &&
  hasOptionalArrayField(value, 'dailyRecords') &&
  hasOptionalArrayField(value, 'materialCollection');

const resolveApiAuthToken = (): string => {
  const envToken =
    typeof import.meta.env.VITE_SHOGUN_API_TOKEN === 'string'
      ? import.meta.env.VITE_SHOGUN_API_TOKEN.trim()
      : '';

  return envToken.length > 0 ? envToken : DEFAULT_API_AUTH_TOKEN;
};

const countCompletedTasksByCategory = (
  activityLog: readonly ActivityLogEntry[]
): Record<TrackedTaskCategory, number> => {
  const base = TRACKED_TASK_CATEGORIES.reduce<Record<TrackedTaskCategory, number>>((acc, category) => {
    acc[category] = 0;
    return acc;
  }, {} as Record<TrackedTaskCategory, number>);

  for (const entry of activityLog) {
    if (entry.type !== 'work_complete') {
      continue;
    }

    const category = typeof entry.taskCategory === 'string' ? entry.taskCategory : '';
    if (!Object.prototype.hasOwnProperty.call(base, category)) {
      continue;
    }

    base[category as TrackedTaskCategory] += 1;
  }

  return base;
};

const countCompletedTasks = (activityLog: readonly ActivityLogEntry[]): number =>
  activityLog.filter((entry) => entry.type === 'work_complete').length;

const countMissionClaims = (
  activityLog: readonly ActivityLogEntry[],
  missions: readonly Mission[]
): number => {
  const fromActivityLog = activityLog.filter((entry) => entry.type === 'mission_complete').length;
  const claimedMissions = missions.filter((mission) => mission.claimed === true).length;
  return Math.max(fromActivityLog, claimedMissions);
};

const sumPositiveActivityMetric = (
  activityLog: readonly ActivityLogEntry[],
  field: 'gold' | 'xp'
): number => {
  let total = 0;
  for (const entry of activityLog) {
    total += toNonNegativeInt(entry[field]);
  }
  return total;
};

const estimateTotalGoldEarned = (
  activityLog: readonly ActivityLogEntry[],
  town: GameState['town'],
  economy: GameState['economy']
): number => {
  const fromActivity = sumPositiveActivityMetric(activityLog, 'gold');
  const fromTown = toNonNegativeInt(town.gold);
  const fromEconomy = toNonNegativeInt(economy.gold);
  return Math.max(fromActivity, fromTown, fromEconomy);
};

const estimateTotalXPEarned = (
  activityLog: readonly ActivityLogEntry[],
  town: GameState['town']
): number => {
  const fromActivity = sumPositiveActivityMetric(activityLog, 'xp');
  const fromTown = toNonNegativeInt(town.xp);
  return Math.max(fromActivity, fromTown);
};

const countPlacedDecorations = (decorations: readonly Decoration[]): number => {
  const placedCount = decorations.filter((decoration) => decoration.position !== undefined).length;
  return placedCount > 0 ? placedCount : decorations.length;
};

const countBuildingsAtOrAboveLevel = (
  buildings: readonly Building[],
  level: number,
  scope: BuildingScope
): number => {
  const targetTypes = scope === 'specialized' ? SPECIALIZED_BUILDING_TYPES : ALL_BUILDING_TYPES;
  const levelByType = new Map<BuildingType, number>();

  for (const building of buildings) {
    levelByType.set(building.type, toNonNegativeInt(building.level));
  }

  return targetTypes.filter((type) => (levelByType.get(type) ?? 0) >= level).length;
};

const countMaterialCompletionRate = (
  materialCollection: readonly MaterialCollection[],
  inventory: readonly InventoryItem[]
): number => {
  if (MATERIAL_ITEM_ID_SET.size < 1) {
    return 0;
  }

  const obtained = new Set<string>();

  for (const entry of materialCollection) {
    if (!MATERIAL_ITEM_ID_SET.has(entry.itemId)) {
      continue;
    }

    if (toNonNegativeInt(entry.count) > 0) {
      obtained.add(entry.itemId);
    }
  }

  for (const entry of inventory) {
    if (!MATERIAL_ITEM_ID_SET.has(entry.itemId)) {
      continue;
    }

    if (toNonNegativeInt(entry.quantity) > 0) {
      obtained.add(entry.itemId);
    }
  }

  return Math.floor((obtained.size / MATERIAL_ITEM_ID_SET.size) * 100);
};

const resolveTitleProgress = (
  condition: string,
  snapshot: ProgressSnapshot
): Pick<ProgressCardModel, 'current' | 'target' | 'unit'> => {
  const parts = condition.split(':');
  const type = parts[0];

  if (type === 'mission_claimed_count') {
    const target = toPositiveInt(parts[1], 1);
    return {
      current: countMissionClaims(snapshot.activityLog, snapshot.missions),
      target,
      unit: '件',
    };
  }

  if (type === 'building_count_at_or_above_level') {
    const scope: BuildingScope = parts[1] === 'specialized' ? 'specialized' : 'all';
    const level = toPositiveInt(parts[2], 1);
    const target = toPositiveInt(parts[3], 1);
    return {
      current: countBuildingsAtOrAboveLevel(snapshot.buildings, level, scope),
      target,
      unit: '棟',
    };
  }

  if (type === 'all_buildings_at_or_above_level') {
    const level = toPositiveInt(parts[1], 1);
    return {
      current: countBuildingsAtOrAboveLevel(snapshot.buildings, level, 'all'),
      target: ALL_BUILDING_TYPES.length,
      unit: '棟',
    };
  }

  if (type === 'total_tasks_completed') {
    const target = toPositiveInt(parts[1], 1);
    return {
      current: countCompletedTasks(snapshot.activityLog),
      target,
      unit: '件',
    };
  }

  if (type === 'total_gold_earned') {
    const target = toPositiveInt(parts[1], 1);
    return {
      current: estimateTotalGoldEarned(snapshot.activityLog, snapshot.town, snapshot.economy),
      target,
      unit: '両',
    };
  }

  if (type === 'material_completion_rate') {
    const target = toPositiveInt(parts[1], 1);
    return {
      current: countMaterialCompletionRate(snapshot.materialCollection, snapshot.inventory),
      target,
      unit: '%',
    };
  }

  if (type === 'decoration_placed_count') {
    const target = toPositiveInt(parts[1], 1);
    return {
      current: countPlacedDecorations(snapshot.decorations),
      target,
      unit: '個',
    };
  }

  if (type === 'total_xp_earned') {
    const target = toPositiveInt(parts[1], 1);
    return {
      current: estimateTotalXPEarned(snapshot.activityLog, snapshot.town),
      target,
      unit: 'XP',
    };
  }

  return {
    current: 0,
    target: 1,
    unit: '件',
  };
};

const resolveAchievementFallbackValue = (
  definition: AchievementDefinition,
  snapshot: ProgressSnapshot,
  taskCountsByCategory: Record<TrackedTaskCategory, number>
): number => {
  if (definition.id.startsWith(TASK_MASTERY_ID_PREFIX)) {
    const category = definition.id.slice(TASK_MASTERY_ID_PREFIX.length);
    if (Object.prototype.hasOwnProperty.call(taskCountsByCategory, category)) {
      return taskCountsByCategory[category as TrackedTaskCategory];
    }

    return 0;
  }

  if (definition.id === CASTLE_TOWN_DEVELOPMENT_RECORD_ID) {
    return countBuildingsAtOrAboveLevel(snapshot.buildings, 3, 'all');
  }

  return 0;
};

const resolveAchievementUnit = (definitionId: string): string => {
  if (definitionId.startsWith(TASK_MASTERY_ID_PREFIX)) {
    return '件';
  }

  if (definitionId === CASTLE_TOWN_DEVELOPMENT_RECORD_ID) {
    return '棟';
  }

  if (definitionId === 'material_collection_record') {
    return '%';
  }

  return '件';
};

const toAchievementProgressCard = (
  definition: AchievementDefinition,
  savedAchievement: Achievement | undefined,
  snapshot: ProgressSnapshot,
  taskCountsByCategory: Record<TrackedTaskCategory, number>
): ProgressCardModel => {
  const thresholds = normalizeThresholds(
    Array.isArray(savedAchievement?.thresholds) ? savedAchievement.thresholds : definition.thresholds
  );
  const normalizedThresholds = thresholds.length > 0 ? thresholds : [1];
  const finalThreshold = normalizedThresholds[normalizedThresholds.length - 1];
  const currentValue = savedAchievement
    ? toNonNegativeInt(savedAchievement.currentValue)
    : resolveAchievementFallbackValue(definition, snapshot, taskCountsByCategory);
  const nextThreshold =
    normalizedThresholds.find((threshold) => currentValue < threshold) ?? finalThreshold;
  const reachedCount = normalizedThresholds.filter((threshold) => currentValue >= threshold).length;

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    current: currentValue,
    target: nextThreshold,
    unit: resolveAchievementUnit(definition.id),
    completed: currentValue >= finalThreshold,
    detail: `達成段階 ${reachedCount}/${normalizedThresholds.length}`,
  };
};

export const getWrappedBukanTab = (startIndex: number): BukanTab => {
  const tabCount = BUKAN_TABS.length;
  const wrappedIndex = ((startIndex % tabCount) + tabCount) % tabCount;
  return BUKAN_TABS[wrappedIndex];
};

const localizeEquipErrorMessage = (
  errorMessage: string | undefined,
  resolveTitleName: (titleId: string | null | undefined) => string
): string => {
  const normalizedMessage = asOptionalNonEmptyString(errorMessage);
  if (!normalizedMessage) {
    return '装備の切替に失敗いたした。';
  }

  const unlockErrorMatch = normalizedMessage.match(TITLE_UNLOCKED_ERROR_PATTERN);
  if (unlockErrorMatch) {
    return `称号未解放: ${resolveTitleName(unlockErrorMatch[1])}`;
  }

  if (TITLE_ID_INVALID_ERROR_PATTERN.test(normalizedMessage)) {
    return '称号指定が不正でござる。';
  }

  return normalizedMessage;
};

interface UseBukanDataResult {
  titleCardsByTab: Record<BukanTab, ProgressCardModel[]>;
  martialAchievementCards: ProgressCardModel[];
  constructionAchievementCards: ProgressCardModel[];
  unlockedTitles: Title[];
  selectedTitleId: EquippedTitleSelectValue;
  setSelectedTitleId: (value: EquippedTitleSelectValue) => void;
  equippedTitleId: string | null;
  equippedTitleName: string | null;
  equippingTitle: boolean;
  canEquipSelectedTitle: boolean;
  isEquipSelectionUnchanged: boolean;
  equipNotice: string | null;
  resolveTitleDisplayName: (titleId: string | null | undefined) => string;
  onEquipTitle: () => Promise<void>;
}

export const useBukanData = (): UseBukanDataResult => {
  const gameState = useGameStore((state) => state.gameState);
  const updateGameState = useGameStore((state) => state.updateGameState);
  const [equippingTitle, setEquippingTitle] = useState<boolean>(false);
  const [selectedTitleId, setSelectedTitleIdState] = useState<EquippedTitleSelectValue>('__none__');
  const [equipNotice, setEquipNotice] = useState<string | null>(null);

  const snapshot = useMemo<ProgressSnapshot>(
    () => ({
      activityLog: gameState?.activityLog ?? [],
      missions: gameState?.missions ?? [],
      buildings: gameState?.buildings ?? [],
      decorations: gameState?.decorations ?? [],
      materialCollection: gameState?.materialCollection ?? [],
      inventory: gameState?.inventory ?? [],
      town: gameState?.town ?? EMPTY_TOWN,
      economy: gameState?.economy ?? EMPTY_ECONOMY,
    }),
    [
      gameState?.activityLog,
      gameState?.buildings,
      gameState?.decorations,
      gameState?.economy,
      gameState?.inventory,
      gameState?.materialCollection,
      gameState?.missions,
      gameState?.town,
    ]
  );

  const titleById = useMemo(() => {
    const byId = new Map<string, Title>();
    for (const title of gameState?.titles ?? []) {
      byId.set(title.id, title);
    }
    return byId;
  }, [gameState?.titles]);

  const titleNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const definition of TITLE_DEFINITIONS) {
      byId.set(definition.id, definition.name);
    }
    for (const title of gameState?.titles ?? []) {
      const normalizedTitleName = asOptionalNonEmptyString(title.name);
      if (!normalizedTitleName) {
        continue;
      }
      byId.set(title.id, normalizedTitleName);
    }
    return byId;
  }, [gameState?.titles]);

  const achievementById = useMemo(() => {
    const byId = new Map<string, Achievement>();
    for (const achievement of gameState?.achievements ?? []) {
      byId.set(achievement.id, achievement);
    }
    return byId;
  }, [gameState?.achievements]);

  const taskCountsByCategory = useMemo(
    () => countCompletedTasksByCategory(snapshot.activityLog),
    [snapshot.activityLog]
  );

  const titleCardsByTab = useMemo<Record<BukanTab, ProgressCardModel[]>>(() => {
    const byTab: Record<BukanTab, ProgressCardModel[]> = {
      martial: [],
      construction: [],
      magistrate: [],
      collection: [],
    };

    for (const definition of TITLE_DEFINITIONS) {
      const tab = definition.category;
      if (
        tab !== 'martial' &&
        tab !== 'construction' &&
        tab !== 'magistrate' &&
        tab !== 'collection'
      ) {
        continue;
      }

      const progress = resolveTitleProgress(definition.condition, snapshot);
      const unlocked = hasUnlockedAt(titleById.get(definition.id));

      byTab[tab].push({
        id: definition.id,
        name: definition.name,
        description: definition.description,
        current: progress.current,
        target: progress.target,
        unit: progress.unit,
        completed: unlocked || progress.current >= progress.target,
      });
    }

    return byTab;
  }, [snapshot, titleById]);

  const martialAchievementCards = useMemo(
    () =>
      ACHIEVEMENT_DEFINITIONS.filter((definition) => definition.category === 'task_mastery').map(
        (definition) =>
          toAchievementProgressCard(
            definition,
            achievementById.get(definition.id),
            snapshot,
            taskCountsByCategory
          )
      ),
    [achievementById, snapshot, taskCountsByCategory]
  );

  const constructionAchievementCards = useMemo(() => {
    const definition = ACHIEVEMENT_DEFINITIONS.find(
      (item) => item.id === CASTLE_TOWN_DEVELOPMENT_RECORD_ID
    );
    if (!definition) {
      return [];
    }

    return [
      toAchievementProgressCard(
        definition,
        achievementById.get(definition.id),
        snapshot,
        taskCountsByCategory
      ),
    ];
  }, [achievementById, snapshot, taskCountsByCategory]);

  const unlockedTitles = useMemo(
    () => (gameState?.titles ?? []).filter((title) => hasUnlockedAt(title)),
    [gameState?.titles]
  );
  const equippedTitleId = gameState?.equippedTitle ?? null;
  const selectedEquippedTitleId = selectedTitleId === '__none__' ? null : selectedTitleId;
  const canEquipSelectedTitle =
    !equippingTitle &&
    (selectedEquippedTitleId === null ||
      unlockedTitles.some((title) => title.id === selectedEquippedTitleId));
  const isEquipSelectionUnchanged = selectedEquippedTitleId === equippedTitleId;

  const resolveTitleDisplayName = (titleId: string | null | undefined): string => {
    const normalizedTitleId = asOptionalNonEmptyString(titleId);
    if (!normalizedTitleId) {
      return '不明称号';
    }
    return titleNameById.get(normalizedTitleId) ?? '不明称号';
  };

  const equippedTitleName = useMemo(() => {
    const normalizedEquippedTitleId = asOptionalNonEmptyString(equippedTitleId);
    if (normalizedEquippedTitleId === undefined) {
      return null;
    }

    const matched = (gameState?.titles ?? []).find((title) => title.id === normalizedEquippedTitleId);
    const matchedName = asOptionalNonEmptyString(matched?.name);
    if (matchedName) {
      return matchedName;
    }

    return titleNameById.get(normalizedEquippedTitleId) ?? '不明称号';
  }, [equippedTitleId, gameState?.titles, titleNameById]);

  useEffect(() => {
    setSelectedTitleIdState((current) => {
      const fallback = (equippedTitleId ?? '__none__') as EquippedTitleSelectValue;
      if (current === fallback) {
        return current;
      }

      if (current === '__none__' || unlockedTitles.some((title) => title.id === current)) {
        return current;
      }

      return fallback;
    });
  }, [equippedTitleId, unlockedTitles]);

  const onEquipTitle = async () => {
    if (!canEquipSelectedTitle) {
      return;
    }

    const titleId = selectedTitleId === '__none__' ? null : selectedTitleId;
    setEquippingTitle(true);
    setEquipNotice(null);
    try {
      const apiAuthToken = resolveApiAuthToken();
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiAuthToken.length > 0) {
        requestHeaders[API_AUTH_HEADER] = apiAuthToken;
      }

      const response = await fetch('/api/equip-title', {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ titleId }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            error?: string;
            gameState?: unknown;
          }
        | null;

      if (!response.ok || payload?.success === false) {
        setEquipNotice(localizeEquipErrorMessage(payload?.error, resolveTitleDisplayName));
        return;
      }

      if (isGameStatePayload(payload?.gameState)) {
        updateGameState(payload.gameState);
      }

      setEquipNotice(titleId === null ? '装備称号を外した。' : '装備称号を切替えた。');
    } catch {
      setEquipNotice('装備変更に失敗いたした。通信が乱れた。');
    } finally {
      setEquippingTitle(false);
    }
  };

  const setSelectedTitleId = (value: EquippedTitleSelectValue): void => {
    setSelectedTitleIdState(value);
  };

  return {
    titleCardsByTab,
    martialAchievementCards,
    constructionAchievementCards,
    unlockedTitles,
    selectedTitleId,
    setSelectedTitleId,
    equippedTitleId,
    equippedTitleName,
    equippingTitle,
    canEquipSelectedTitle,
    isEquipSelectionUnchanged,
    equipNotice,
    resolveTitleDisplayName,
    onEquipTitle,
  };
};
