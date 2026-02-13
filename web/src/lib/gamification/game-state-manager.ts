import type {
  ActivityLogEntry,
  Achievement,
  AshigaruState,
  Building,
  BuildingType,
  DailyRecord,
  Decoration,
  EconomyState,
  GameState,
  MaterialCollection,
  Mission,
  Position,
  Title,
  TownState,
} from '../../types/game';
import type { InventoryItem } from '../../types/item';
import { TOWN_LEVEL_XP_THRESHOLDS } from '../../types/game';
import type { APIResponse } from '../../types/server';
import { createDefaultMissions } from './mission-system';

type FetchLike = typeof fetch;

const DEFAULT_API_PATH = '/api/game-state';
const MAX_ACTIVITY_LOG_ENTRIES = 100;
const ASHIGARU_STATUS_SET = new Set<AshigaruState['status']>([
  'idle',
  'working',
  'blocked',
  'offline',
]);
const TASK_CATEGORY_SET = new Set<AshigaruState['taskCategory']>([
  'new_implementation',
  'refactoring',
  'skill_creation',
  'analysis',
  'bug_fix',
  'docs',
  'test',
  'idle',
  'other',
]);

const DEFAULT_BUILDING_POSITIONS: Record<BuildingType, Position> = {
  castle: { x: 0, y: 0 },
  mansion: { x: 2, y: 0 },
  inn: { x: -2, y: 1 },
  dojo: { x: -4, y: -1 },
  smithy: { x: -4, y: 2 },
  training: { x: 4, y: -1 },
  study: { x: 4, y: 2 },
  healer: { x: 0, y: 3 },
  watchtower: { x: 0, y: -3 },
  scriptorium: { x: 3, y: 5 },
};

const DEFAULT_ASHIGARU_POSITIONS: readonly Position[] = [
  { x: -1, y: 2 },
  { x: -2, y: 2 },
  { x: -3, y: 2 },
  { x: -1, y: 3 },
  { x: -2, y: 3 },
  { x: -3, y: 3 },
  { x: -1, y: 4 },
  { x: -2, y: 4 },
] as const;

const resolveApiUrl = (apiBaseUrl: string): string => {
  const trimmed = apiBaseUrl.trim();
  if (!trimmed) {
    return DEFAULT_API_PATH;
  }

  return `${trimmed.replace(/\/+$/, '')}${DEFAULT_API_PATH}`;
};

const resolveTownLevel = (xp: number): number => {
  const safeXp = Math.max(0, Math.floor(xp));
  let level = 1;

  for (let i = 1; i < TOWN_LEVEL_XP_THRESHOLDS.length; i += 1) {
    if (safeXp >= TOWN_LEVEL_XP_THRESHOLDS[i]) {
      level = i + 1;
      continue;
    }
    break;
  }

  return level;
};

const normalizeTown = (town: TownState): TownState => {
  const xp = Math.max(0, Math.floor(town.xp));
  const gold = Math.max(0, Math.floor(town.gold));
  return {
    xp,
    gold,
    level: resolveTownLevel(xp),
  };
};

const createInitialAshigaru = (): AshigaruState[] =>
  Array.from({ length: 8 }, (_, index) => {
    const id = `ashigaru${index + 1}`;

    return {
      id,
      name: `足軽${index + 1}`,
      status: 'idle',
      taskId: null,
      taskCategory: 'idle',
      position: DEFAULT_ASHIGARU_POSITIONS[index] ?? { x: -2, y: 4 },
    };
  });

const createInitialBuildings = (): Building[] =>
  (Object.keys(DEFAULT_BUILDING_POSITIONS) as BuildingType[]).map((type) => ({
    type,
    level: 1,
    position: DEFAULT_BUILDING_POSITIONS[type],
  }));

const createInitialTown = (): TownState => ({
  level: 1,
  xp: 0,
  gold: 40,
});

const createInitialEconomy = (): EconomyState => ({
  gold: 40,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const hasOptionalArrayField = (value: Record<string, unknown>, key: string): boolean =>
  value[key] === undefined || Array.isArray(value[key]);

const hasOptionalNullableStringField = (value: Record<string, unknown>, key: string): boolean =>
  value[key] === undefined || value[key] === null || typeof value[key] === 'string';

const clampActivityLogEntries = (entries: ActivityLogEntry[]): ActivityLogEntry[] => {
  if (entries.length <= MAX_ACTIVITY_LOG_ENTRIES) {
    return entries;
  }

  return entries.slice(entries.length - MAX_ACTIVITY_LOG_ENTRIES);
};

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

export interface GameStatePatch {
  ashigaru?: Array<Partial<AshigaruState> & Pick<AshigaruState, 'id'>>;
  buildings?: Array<Partial<Building> & Pick<Building, 'type'>>;
  town?: Partial<TownState>;
  economy?: Partial<EconomyState>;
  inventory?: Array<Partial<InventoryItem> & Pick<InventoryItem, 'itemId'>>;
  decorations?: Array<Partial<Decoration> & Pick<Decoration, 'id'>>;
  missions?: Array<Partial<Mission> & Pick<Mission, 'id'>>;
  activityLog?: ActivityLogEntry[];
  achievements?: Array<Partial<Achievement> & Pick<Achievement, 'id'>>;
  titles?: Array<Partial<Title> & Pick<Title, 'id'>>;
  equippedTitle?: string | null;
  dailyRecords?: Array<Partial<DailyRecord> & Pick<DailyRecord, 'date'>>;
  materialCollection?: Array<Partial<MaterialCollection> & Pick<MaterialCollection, 'itemId'>>;
}

const mergeAshigaru = (
  base: AshigaruState[],
  patch: Array<Partial<AshigaruState> & Pick<AshigaruState, 'id'>>
): AshigaruState[] => {
  const isAshigaruStatus = (value: unknown): value is AshigaruState['status'] =>
    typeof value === 'string' && ASHIGARU_STATUS_SET.has(value as AshigaruState['status']);
  const isTaskCategory = (value: unknown): value is AshigaruState['taskCategory'] =>
    typeof value === 'string' && TASK_CATEGORY_SET.has(value as AshigaruState['taskCategory']);
  const resolveDerivedStatus = (
    taskId: string | null,
    fallback: AshigaruState['status']
  ): AshigaruState['status'] => {
    if (taskId !== null) {
      return 'working';
    }

    return fallback === 'offline' ? 'offline' : 'idle';
  };

  const byId = new Map(base.map((worker) => [worker.id, worker]));

  for (const change of patch) {
    const existing = byId.get(change.id);
    const hasTaskIdPatch = Object.prototype.hasOwnProperty.call(change, 'taskId');
    const hasTaskCategoryPatch = Object.prototype.hasOwnProperty.call(change, 'taskCategory');
    const hasStatusPatch = Object.prototype.hasOwnProperty.call(change, 'status');
    const fallbackStatus = existing?.status ?? 'idle';
    const fallbackTaskId = existing?.taskId ?? null;
    const fallbackTaskCategory = existing?.taskCategory ?? 'idle';
    const nextTaskId = hasTaskIdPatch
      ? typeof change.taskId === 'string'
        ? change.taskId
        : null
      : fallbackTaskId;
    const nextTaskCategory = hasTaskCategoryPatch
      ? isTaskCategory(change.taskCategory)
        ? change.taskCategory
        : nextTaskId === null
          ? 'idle'
          : fallbackTaskCategory
      : fallbackTaskCategory;
    const derivedStatus = resolveDerivedStatus(nextTaskId, fallbackStatus);
    const nextStatus =
      hasStatusPatch && isAshigaruStatus(change.status)
        ? change.status
        : hasTaskIdPatch || hasTaskCategoryPatch
          ? derivedStatus
          : fallbackStatus;

    if (!existing) {
      byId.set(change.id, {
        id: change.id,
        name: change.name ?? change.id,
        status: nextStatus,
        taskId: nextTaskId,
        taskCategory: nextTaskCategory,
        position: change.position ?? { x: 0, y: 0 },
      });
      continue;
    }

    byId.set(change.id, {
      ...existing,
      ...change,
      status: nextStatus,
      taskId: nextTaskId,
      taskCategory: nextTaskCategory,
      position: change.position ?? existing.position,
    });
  }

  return Array.from(byId.values());
};

const mergeBuildings = (
  base: Building[],
  patch: Array<Partial<Building> & Pick<Building, 'type'>>
): Building[] => {
  const byType = new Map(base.map((building) => [building.type, building]));

  for (const change of patch) {
    const existing = byType.get(change.type);
    if (!existing) {
      byType.set(change.type, {
        type: change.type,
        level: change.level ?? 1,
        position: change.position ?? DEFAULT_BUILDING_POSITIONS[change.type] ?? { x: 0, y: 0 },
      });
      continue;
    }

    byType.set(change.type, {
      ...existing,
      ...change,
      position: change.position ?? existing.position,
    });
  }

  return Array.from(byType.values());
};

const mergeDecorations = (
  base: Decoration[],
  patch: Array<Partial<Decoration> & Pick<Decoration, 'id'>>
): Decoration[] => {
  const byId = new Map(base.map((decoration) => [decoration.id, decoration]));

  for (const change of patch) {
    const existing = byId.get(change.id);
    const hasPositionPatch = Object.prototype.hasOwnProperty.call(change, 'position');
    if (!existing) {
      byId.set(change.id, {
        id: change.id,
        type: change.type ?? 'decoration',
        ...(change.position ? { position: change.position } : {}),
      });
      continue;
    }

    const nextDecoration: Decoration = {
      ...existing,
      ...change,
    };

    if (hasPositionPatch) {
      if (change.position) {
        nextDecoration.position = change.position;
      } else {
        delete nextDecoration.position;
      }
    }

    byId.set(change.id, nextDecoration);
  }

  return Array.from(byId.values());
};

const mergeInventory = (
  base: InventoryItem[],
  patch: Array<Partial<InventoryItem> & Pick<InventoryItem, 'itemId'>>
): InventoryItem[] => {
  const byId = new Map(base.map((item) => [item.itemId, item]));

  for (const change of patch) {
    const existing = byId.get(change.itemId);
    const nextQuantity = Math.max(0, Math.floor(change.quantity ?? existing?.quantity ?? 0));

    if (!existing) {
      byId.set(change.itemId, {
        itemId: change.itemId,
        quantity: nextQuantity,
      });
      continue;
    }

    byId.set(change.itemId, {
      ...existing,
      ...change,
      quantity: nextQuantity,
    });
  }

  return Array.from(byId.values());
};

const mergeMissions = (
  base: Mission[],
  patch: Array<Partial<Mission> & Pick<Mission, 'id'>>
): Mission[] => {
  const byId = new Map(base.map((mission) => [mission.id, mission]));

  for (const change of patch) {
    const existing = byId.get(change.id);
    if (!existing) {
      byId.set(change.id, {
        id: change.id,
        title: change.title ?? change.id,
        conditions: change.conditions ?? [],
        claimed: change.claimed ?? false,
        reward: change.reward ?? { xp: 0, gold: 0 },
        progress: change.progress ?? { current: 0, target: 1 },
      });
      continue;
    }

    byId.set(change.id, {
      ...existing,
      ...change,
      conditions: change.conditions ?? existing.conditions,
      reward: change.reward ?? existing.reward,
      progress: change.progress ?? existing.progress,
    });
  }

  return Array.from(byId.values());
};

const mergeAchievements = (
  base: Achievement[],
  patch: Array<Partial<Achievement> & Pick<Achievement, 'id'>>
): Achievement[] => {
  const byId = new Map(base.map((achievement) => [achievement.id, achievement]));

  for (const change of patch) {
    const existing = byId.get(change.id);
    if (!existing) {
      byId.set(change.id, {
        id: change.id,
        category: change.category ?? 'general',
        name: change.name ?? change.id,
        description: change.description ?? '',
        thresholds: Array.isArray(change.thresholds) ? change.thresholds : [],
        currentValue: Math.max(0, Math.floor(change.currentValue ?? 0)),
        ...(typeof change.unlockedAt === 'string' ? { unlockedAt: change.unlockedAt } : {}),
      });
      continue;
    }

    byId.set(change.id, {
      ...existing,
      ...change,
      thresholds: Array.isArray(change.thresholds) ? change.thresholds : existing.thresholds,
      currentValue: Math.max(0, Math.floor(change.currentValue ?? existing.currentValue)),
      ...(typeof change.unlockedAt === 'string'
        ? { unlockedAt: change.unlockedAt }
        : existing.unlockedAt
          ? { unlockedAt: existing.unlockedAt }
          : {}),
    });
  }

  return Array.from(byId.values());
};

const mergeTitles = (base: Title[], patch: Array<Partial<Title> & Pick<Title, 'id'>>): Title[] => {
  const byId = new Map(base.map((title) => [title.id, title]));

  for (const change of patch) {
    const existing = byId.get(change.id);
    if (!existing) {
      byId.set(change.id, {
        id: change.id,
        name: change.name ?? change.id,
        description: change.description ?? '',
        condition: change.condition ?? '',
        ...(typeof change.unlockedAt === 'string' ? { unlockedAt: change.unlockedAt } : {}),
      });
      continue;
    }

    byId.set(change.id, {
      ...existing,
      ...change,
      ...(typeof change.unlockedAt === 'string'
        ? { unlockedAt: change.unlockedAt }
        : existing.unlockedAt
          ? { unlockedAt: existing.unlockedAt }
          : {}),
    });
  }

  return Array.from(byId.values());
};

const mergeDailyRecords = (
  base: DailyRecord[],
  patch: Array<Partial<DailyRecord> & Pick<DailyRecord, 'date'>>
): DailyRecord[] => {
  const byDate = new Map(base.map((record) => [record.date, record]));

  for (const change of patch) {
    const existing = byDate.get(change.date);
    if (!existing) {
      byDate.set(change.date, {
        date: change.date,
        xp: Math.max(0, Math.floor(change.xp ?? 0)),
        gold: Math.max(0, Math.floor(change.gold ?? 0)),
        tasksCompleted: Math.max(0, Math.floor(change.tasksCompleted ?? 0)),
        consecutiveCompletions: Math.max(0, Math.floor(change.consecutiveCompletions ?? 0)),
        previousBest: Math.max(0, Math.floor(change.previousBest ?? 0)),
      });
      continue;
    }

    byDate.set(change.date, {
      ...existing,
      ...change,
      xp: Math.max(0, Math.floor(change.xp ?? existing.xp)),
      gold: Math.max(0, Math.floor(change.gold ?? existing.gold)),
      tasksCompleted: Math.max(0, Math.floor(change.tasksCompleted ?? existing.tasksCompleted)),
      consecutiveCompletions: Math.max(
        0,
        Math.floor(change.consecutiveCompletions ?? existing.consecutiveCompletions)
      ),
      previousBest: Math.max(0, Math.floor(change.previousBest ?? existing.previousBest)),
    });
  }

  return Array.from(byDate.values());
};

const mergeMaterialCollection = (
  base: MaterialCollection[],
  patch: Array<Partial<MaterialCollection> & Pick<MaterialCollection, 'itemId'>>
): MaterialCollection[] => {
  const byItemId = new Map(base.map((entry) => [entry.itemId, entry]));

  for (const change of patch) {
    const existing = byItemId.get(change.itemId);
    if (!existing) {
      byItemId.set(change.itemId, {
        itemId: change.itemId,
        count: Math.max(0, Math.floor(change.count ?? 0)),
        ...(typeof change.firstObtainedAt === 'string'
          ? { firstObtainedAt: change.firstObtainedAt }
          : {}),
      });
      continue;
    }

    byItemId.set(change.itemId, {
      ...existing,
      ...change,
      count: Math.max(0, Math.floor(change.count ?? existing.count)),
      ...(typeof change.firstObtainedAt === 'string'
        ? { firstObtainedAt: change.firstObtainedAt }
        : existing.firstObtainedAt
          ? { firstObtainedAt: existing.firstObtainedAt }
          : {}),
    });
  }

  return Array.from(byItemId.values());
};

export const createInitialGameState = (): GameState => ({
  ashigaru: createInitialAshigaru(),
  buildings: createInitialBuildings(),
  town: createInitialTown(),
  economy: createInitialEconomy(),
  inventory: [],
  decorations: [],
  missions: createDefaultMissions(),
  activityLog: [],
  achievements: [],
  titles: [],
  equippedTitle: null,
  dailyRecords: [],
  materialCollection: [],
});

export const mergeGameState = (
  base: GameState,
  patch: GameStatePatch | Partial<GameState>
): GameState => {
  const ashigaruPatch = Array.isArray(patch.ashigaru) ? patch.ashigaru : null;
  const buildingsPatch = Array.isArray(patch.buildings) ? patch.buildings : null;
  const decorationsPatch = Array.isArray(patch.decorations) ? patch.decorations : null;
  const inventoryPatch = Array.isArray(patch.inventory) ? patch.inventory : null;
  const missionsPatch = Array.isArray(patch.missions) ? patch.missions : null;
  const activityLogPatch = Array.isArray(patch.activityLog) ? patch.activityLog : null;
  const achievementsPatch = Array.isArray(patch.achievements) ? patch.achievements : null;
  const titlesPatch = Array.isArray(patch.titles) ? patch.titles : null;
  const dailyRecordsPatch = Array.isArray(patch.dailyRecords) ? patch.dailyRecords : null;
  const materialCollectionPatch = Array.isArray(patch.materialCollection)
    ? patch.materialCollection
    : null;
  const hasEquippedTitlePatch = Object.prototype.hasOwnProperty.call(patch, 'equippedTitle');
  const equippedTitlePatch = hasEquippedTitlePatch ? (patch as { equippedTitle?: unknown }).equippedTitle : undefined;
  const townPatch = isRecord(patch.town) ? (patch.town as Partial<TownState>) : null;
  const economyPatch = isRecord(patch.economy) ? (patch.economy as Partial<EconomyState>) : null;

  const mergedAshigaru = ashigaruPatch
    ? mergeAshigaru(base.ashigaru, ashigaruPatch)
    : base.ashigaru;

  const mergedBuildings = buildingsPatch
    ? mergeBuildings(base.buildings, buildingsPatch)
    : base.buildings;

  const mergedDecorations = decorationsPatch
    ? mergeDecorations(base.decorations, decorationsPatch)
    : base.decorations;
  const mergedInventory = inventoryPatch
    ? mergeInventory(base.inventory, inventoryPatch)
    : base.inventory;

  const mergedMissions = missionsPatch
    ? mergeMissions(base.missions, missionsPatch)
    : base.missions;
  const mergedAchievements = achievementsPatch
    ? mergeAchievements(base.achievements, achievementsPatch)
    : base.achievements;
  const mergedTitles = titlesPatch ? mergeTitles(base.titles, titlesPatch) : base.titles;
  const mergedDailyRecords = dailyRecordsPatch
    ? mergeDailyRecords(base.dailyRecords, dailyRecordsPatch)
    : base.dailyRecords;
  const mergedMaterialCollection = materialCollectionPatch
    ? mergeMaterialCollection(base.materialCollection, materialCollectionPatch)
    : base.materialCollection;
  const mergedEquippedTitle =
    hasEquippedTitlePatch && (typeof equippedTitlePatch === 'string' || equippedTitlePatch === null)
      ? equippedTitlePatch
      : base.equippedTitle;

  const mergedTown = townPatch ? normalizeTown({ ...base.town, ...townPatch }) : base.town;
  const mergedEconomy = economyPatch ? { ...base.economy, ...economyPatch } : base.economy;
  const mergedActivityLog = clampActivityLogEntries(activityLogPatch ?? base.activityLog);

  return {
    ashigaru: mergedAshigaru,
    buildings: mergedBuildings,
    town: mergedTown,
    economy: {
      ...mergedEconomy,
      gold: mergedTown.gold,
    },
    inventory: mergedInventory,
    decorations: mergedDecorations,
    missions: mergedMissions,
    activityLog: mergedActivityLog,
    achievements: mergedAchievements,
    titles: mergedTitles,
    equippedTitle: mergedEquippedTitle,
    dailyRecords: mergedDailyRecords,
    materialCollection: mergedMaterialCollection,
  };
};

const parseGameStateResponse = (data: unknown): GameState => {
  if (!isRecord(data)) {
    throw new Error('Invalid game-state response payload.');
  }

  if ('success' in data) {
    const response = data as Partial<APIResponse<unknown>>;
    if (response.success === false) {
      throw new Error(response.error ?? 'Failed to access game-state endpoint.');
    }

    const payload = response.data;
    if (!payload) {
      throw new Error('Missing game-state payload.');
    }

    if (isRecord(payload) && 'state' in payload) {
      const nestedState = payload.state;
      if (!isGameStatePayload(nestedState)) {
        throw new Error('Invalid nested game-state payload shape.');
      }
      return nestedState;
    }

    if (isRecord(payload) && 'gameState' in payload) {
      const nestedGameState = payload.gameState;
      if (!isGameStatePayload(nestedGameState)) {
        throw new Error('Invalid nested game-state payload shape.');
      }
      return nestedGameState;
    }

    if (!isGameStatePayload(payload)) {
      throw new Error('Invalid game-state payload shape.');
    }

    return payload;
  }

  // Backward compatibility while migrating endpoints.
  if (isRecord(data) && 'state' in data) {
    const nestedState = data.state;
    if (!isGameStatePayload(nestedState)) {
      throw new Error('Invalid nested game-state payload shape.');
    }
    return nestedState;
  }

  if (isRecord(data) && 'gameState' in data) {
    const nestedGameState = data.gameState;
    if (!isGameStatePayload(nestedGameState)) {
      throw new Error('Invalid nested game-state payload shape.');
    }
    return nestedGameState;
  }

  if (isGameStatePayload(data)) {
    return data;
  }

  throw new Error('Missing game-state payload.');
};

const ensureFetch = (fetchImpl?: FetchLike): FetchLike => {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (!resolved) {
    throw new Error('fetch implementation is not available.');
  }
  return resolved;
};

export const getGameState = async (apiBaseUrl = '', fetchImpl?: FetchLike): Promise<GameState> => {
  const fetchFn = ensureFetch(fetchImpl);
  const response = await fetchFn(resolveApiUrl(apiBaseUrl), {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`GET /api/game-state failed: ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  return parseGameStateResponse(data);
};

export const postGameState = async (
  state: GameState,
  apiBaseUrl = '',
  fetchImpl?: FetchLike
): Promise<GameState> => {
  const fetchFn = ensureFetch(fetchImpl);
  const response = await fetchFn(resolveApiUrl(apiBaseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state }),
  });

  if (!response.ok) {
    throw new Error(`POST /api/game-state failed: ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  return parseGameStateResponse(data);
};

export const loadOrCreateGameState = async (
  apiBaseUrl = '',
  fetchImpl?: FetchLike
): Promise<GameState> => {
  try {
    return await getGameState(apiBaseUrl, fetchImpl);
  } catch {
    return createInitialGameState();
  }
};

export interface GameStateManager {
  createInitialState: () => GameState;
  mergeState: (base: GameState, patch: GameStatePatch | Partial<GameState>) => GameState;
  getState: () => Promise<GameState>;
  saveState: (state: GameState) => Promise<GameState>;
}

export const createGameStateManager = (
  apiBaseUrl = '',
  fetchImpl?: FetchLike
): GameStateManager => ({
  createInitialState: createInitialGameState,
  mergeState: mergeGameState,
  getState: () => getGameState(apiBaseUrl, fetchImpl),
  saveState: (state) => postGameState(state, apiBaseUrl, fetchImpl),
});
