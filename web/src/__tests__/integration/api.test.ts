import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ITEM_MASTER } from '@/data/item-master';
import type { ActivityLogEntry, BuildingType, GameState, InventoryItem, ItemDefinition } from '@/types';
import { registerApiRoutes, type ApiRoutesDependencies } from '@server/routes/api';

type LooseRecord = Record<string, unknown>;

type MutationResult<T> = {
  nextState: LooseRecord | null;
  result: T;
};

interface TestHarness {
  app: express.Express;
  writes: LooseRecord[];
  broadcasts: Array<{ type: string; payload: unknown }>;
  getState: () => LooseRecord;
  queueGameStateWrite: (nextState: LooseRecord) => Promise<void>;
}

interface TestHarnessOptions {
  gameStateService?: Partial<ApiRoutesDependencies['gameStateService']>;
  gameLogicService?: Partial<ApiRoutesDependencies['gameLogicService']>;
}

const BUILDING_TYPES: BuildingType[] = [
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

const ITEM_MASTER_BY_ID_LOOKUP = new Map<string, ItemDefinition>(
  ITEM_MASTER.map((item) => [item.id, item])
);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isRecord = (value: unknown): value is LooseRecord =>
  typeof value === 'object' && value !== null;

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const toSafeInt = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
};

const normalizeTown = (
  value: unknown,
  fallbackGold: number
): {
  level: number;
  xp: number;
  gold: number;
} => {
  const source = isRecord(value) ? value : {};
  const xp = toSafeInt(source.xp);
  const explicitGold = typeof source.gold === 'number' && Number.isFinite(source.gold);
  const gold = explicitGold
    ? Math.max(0, Math.floor(source.gold as number))
    : toSafeInt(fallbackGold);
  const level =
    typeof source.level === 'number' && Number.isFinite(source.level)
      ? Math.max(1, Math.floor(source.level as number))
      : xp >= 100
        ? 2
        : 1;

  return {
    level,
    xp,
    gold,
  };
};

const normalizeTownFromState = (value: unknown): { level: number; xp: number; gold: number } => {
  if (!isRecord(value)) {
    return normalizeTown(null, 40);
  }

  const fallbackGold =
    isRecord(value.economy) && typeof value.economy.gold === 'number'
      ? (value.economy.gold as number)
      : 40;
  return normalizeTown(value.town, fallbackGold);
};

const normalizeInventory = (value: unknown, fallback: InventoryItem[]): InventoryItem[] => {
  if (!Array.isArray(value)) {
    return clone(fallback);
  }

  const normalized: InventoryItem[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const itemId = asString(entry.itemId);
    if (itemId === null) {
      continue;
    }

    const quantity = toSafeInt(entry.quantity);
    if (quantity <= 0) {
      continue;
    }

    normalized.push({ itemId, quantity });
  }

  return normalized;
};

const toInventoryMap = (inventory: InventoryItem[]): Map<string, InventoryItem> =>
  new Map(inventory.map((entry) => [entry.itemId, { ...entry }]));

const inventoryFromMap = (inventoryMap: Map<string, InventoryItem>): InventoryItem[] =>
  Array.from(inventoryMap.values()).sort((left, right) => left.itemId.localeCompare(right.itemId));

const applyMissionRewardToTown = (
  currentTown: unknown,
  rewardXp: number,
  rewardGold: number
): { level: number; xp: number; gold: number } => {
  const normalizedTown = normalizeTown(currentTown, 0);
  return normalizeTown(
    {
      ...normalizedTown,
      xp: normalizedTown.xp + toSafeInt(rewardXp),
      gold: normalizedTown.gold + toSafeInt(rewardGold),
    },
    normalizedTown.gold
  );
};

const normalizeEconomyPatch = (payload: unknown): Partial<{ gold: number }> | null => {
  if (!isRecord(payload) || typeof payload.gold !== 'number' || !Number.isFinite(payload.gold)) {
    return null;
  }

  return {
    gold: Math.max(0, Math.floor(payload.gold)),
  };
};

const normalizeTownPatch = (payload: unknown): Partial<{ xp: number; gold: number }> | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const patch: Partial<{ xp: number; gold: number }> = {};
  if (typeof payload.xp === 'number' && Number.isFinite(payload.xp)) {
    patch.xp = Math.max(0, Math.floor(payload.xp));
  }
  if (typeof payload.gold === 'number' && Number.isFinite(payload.gold)) {
    patch.gold = Math.max(0, Math.floor(payload.gold));
  }

  return patch.xp !== undefined || patch.gold !== undefined ? patch : null;
};

const normalizeUseItemPayload = (payload: unknown): { itemId: string } | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const itemId = asString(payload.itemId);
  return itemId === null ? null : { itemId };
};

const normalizePosition = (value: unknown): { x: number; y: number } | null => {
  if (!isRecord(value)) {
    return null;
  }

  const x = typeof value.x === 'number' && Number.isFinite(value.x) ? Math.floor(value.x) : null;
  const y = typeof value.y === 'number' && Number.isFinite(value.y) ? Math.floor(value.y) : null;
  if (x === null || y === null) {
    return null;
  }

  return { x, y };
};

const normalizeDecorationsForState = (value: unknown): GameState['decorations'] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: GameState['decorations'] = [];
  const seenIds = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const id = asString(entry.id);
    const type = asString(entry.type);
    if (!id || !type || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    const position = normalizePosition(entry.position);
    normalized.push(position ? { id, type, position } : { id, type });
  }

  return normalized;
};

const normalizeBuildingsForState = (value: unknown): GameState['buildings'] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const type = asString(entry.type);
    if (!type || !BUILDING_TYPES.includes(type as BuildingType)) {
      return [];
    }

    const levelRaw = typeof entry.level === 'number' && Number.isFinite(entry.level) ? entry.level : 1;
    const level = Math.max(1, Math.min(5, Math.floor(levelRaw))) as 1 | 2 | 3 | 4 | 5;
    const position = normalizePosition(entry.position) ?? { x: 0, y: 0 };

    return [
      {
        type: type as BuildingType,
        level,
        position,
      },
    ];
  });
};

const createBaseGameState = (overrides: Partial<GameState> = {}): GameState => ({
  ashigaru: [],
  buildings: [{ type: 'castle', level: 1, position: { x: 0, y: 0 } }],
  town: { level: 1, xp: 0, gold: 100 },
  economy: { gold: 100 },
  inventory: [],
  decorations: [],
  missions: [],
  activityLog: [],
  achievements: [],
  titles: [],
  equippedTitle: null,
  dailyRecords: [],
  materialCollection: [],
  ...overrides,
});

const TEST_UPGRADE_BUILDING_ID: BuildingType = 'dojo';
const TEST_UPGRADE_MATERIAL_ID =
  ITEM_MASTER.find((item) => item.itemType === 'material')?.id ?? 'stone_block';
const TEST_UPGRADE_COST: {
  buildingId: BuildingType;
  fromLevel: 1 | 2 | 3 | 4;
  toLevel: 1 | 2 | 3 | 4 | 5;
  gold: number;
  materials: Array<{ itemId: string; quantity: number }>;
} = {
  buildingId: TEST_UPGRADE_BUILDING_ID,
  fromLevel: 1,
  toLevel: 2,
  gold: 120,
  materials: [{ itemId: TEST_UPGRADE_MATERIAL_ID, quantity: 2 }],
};

const normalizeUpgradeCostQueryPayloadForTest = (
  query: unknown
): { buildingId: BuildingType; currentLevel: 1 | 2 | 3 | 4 | 5 } | null => {
  if (!isRecord(query)) {
    return null;
  }

  const buildingId = asString(query.buildingId);
  const currentLevelRaw = Array.isArray(query.currentLevel) ? query.currentLevel[0] : query.currentLevel;
  const currentLevel =
    typeof currentLevelRaw === 'string'
      ? Number.parseInt(currentLevelRaw, 10)
      : typeof currentLevelRaw === 'number' && Number.isFinite(currentLevelRaw)
        ? Math.floor(currentLevelRaw)
        : Number.NaN;
  if (buildingId === null || !BUILDING_TYPES.includes(buildingId as BuildingType)) {
    return null;
  }

  if (![1, 2, 3, 4, 5].includes(currentLevel)) {
    return null;
  }

  return {
    buildingId: buildingId as BuildingType,
    currentLevel: currentLevel as 1 | 2 | 3 | 4 | 5,
  };
};

const normalizeUpgradeBuildingPayloadForTest = (
  payload: unknown
): { buildingId: BuildingType } | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const buildingId = asString(payload.buildingId);
  if (buildingId === null || !BUILDING_TYPES.includes(buildingId as BuildingType)) {
    return null;
  }

  return {
    buildingId: buildingId as BuildingType,
  };
};

const normalizeBuyItemPayloadForTest = (
  payload: unknown
): { itemId: string; quantity: number } | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const itemId = asString(payload.itemId);
  if (itemId === null) {
    return null;
  }

  const rawQuantity = typeof payload.quantity === 'number' && Number.isFinite(payload.quantity)
    ? Math.floor(payload.quantity)
    : 1;
  return {
    itemId,
    quantity: Math.max(1, Math.min(99, rawQuantity)),
  };
};

const collectMissingUpgradeMaterialsForTest = (
  inventoryMap: Map<string, InventoryItem>,
  materials: Array<{ itemId: string; quantity: number }>
): Array<{ id: string; required: number; have: number }> => {
  const missing: Array<{ id: string; required: number; have: number }> = [];
  for (const material of materials) {
    const required = Math.max(0, Math.floor(material.quantity));
    if (required <= 0) {
      continue;
    }

    const have = Math.max(0, Math.floor(inventoryMap.get(material.itemId)?.quantity ?? 0));
    if (have >= required) {
      continue;
    }

    missing.push({
      id: material.itemId,
      required,
      have,
    });
  }

  return missing;
};

const applyUpgradeMaterialCostForTest = (
  inventoryMap: Map<string, InventoryItem>,
  materials: Array<{ itemId: string; quantity: number }>
): void => {
  for (const material of materials) {
    const required = Math.max(0, Math.floor(material.quantity));
    if (required <= 0) {
      continue;
    }

    const current = inventoryMap.get(material.itemId);
    if (current === undefined) {
      continue;
    }

    const nextQuantity = Math.max(0, current.quantity - required);
    if (nextQuantity <= 0) {
      inventoryMap.delete(material.itemId);
      continue;
    }

    inventoryMap.set(material.itemId, {
      ...current,
      quantity: nextQuantity,
    });
  }
};

const resolveUpgradeCostForTest = (
  buildingId: BuildingType,
  currentLevel: 1 | 2 | 3 | 4 | 5
) => {
  if (
    buildingId !== TEST_UPGRADE_COST.buildingId ||
    currentLevel !== TEST_UPGRADE_COST.fromLevel
  ) {
    return null;
  }

  return clone(TEST_UPGRADE_COST);
};

const resolveDecorationCostForTest = (decorationId: string): number | null => {
  const item = ITEM_MASTER_BY_ID_LOOKUP.get(decorationId);
  if (item === undefined || typeof item.shopCost !== 'number' || !Number.isFinite(item.shopCost)) {
    return null;
  }

  return Math.max(0, Math.floor(item.shopCost));
};

const syncEconomyWithTownInPlace = (state: LooseRecord): void => {
  const normalizedTown = normalizeTownFromState(state);
  state.town = normalizedTown;
  state.economy = {
    gold: normalizedTown.gold,
  };
};

const createTestHarness = (
  initialState: GameState,
  options: TestHarnessOptions = {}
): TestHarness => {
  let persistedState = clone(initialState) as unknown as LooseRecord;
  let queue = Promise.resolve();

  const writes: LooseRecord[] = [];
  const broadcasts: Array<{ type: string; payload: unknown }> = [];
  const itemMasterById = new Map<string, ItemDefinition>(
    ITEM_MASTER.map((item) => [item.id, item])
  );

  const enqueue = async <T>(work: () => Promise<T>): Promise<T> => {
    let failed = false;
    let thrown: unknown = null;
    let result: T | null = null;

    queue = queue
      .catch(() => undefined)
      .then(async () => {
        try {
          result = await work();
        } catch (error) {
          failed = true;
          thrown = error;
        }
      });

    await queue;

    if (failed) {
      throw thrown;
    }

    return result as T;
  };

  const queueGameStateWrite = async (nextState: LooseRecord): Promise<void> => {
    await enqueue(async () => {
      const snapshot = clone(nextState);
      syncEconomyWithTownInPlace(snapshot);
      persistedState = snapshot;
      writes.push(clone(snapshot));
    });
  };

  const queueGameStateMutation = async <T>(
    mutate: (currentState: LooseRecord) => Promise<MutationResult<T>> | MutationResult<T>
  ): Promise<T> => {
    return enqueue(async () => {
      const { nextState, result } = await mutate(clone(persistedState));
      if (nextState !== null) {
        const snapshot = clone(nextState);
        syncEconomyWithTownInPlace(snapshot);
        persistedState = snapshot;
        writes.push(clone(snapshot));
      }
      return result;
    });
  };

  const app = express();
  app.use(express.json());

  const defaultPositions: Record<BuildingType, { x: number; y: number }> = BUILDING_TYPES.reduce(
    (acc, buildingId, index) => {
      acc[buildingId] = { x: index, y: 0 };
      return acc;
    },
    {} as Record<BuildingType, { x: number; y: number }>
  );

  const gameStateServiceDefaults: ApiRoutesDependencies['gameStateService'] = {
    readGameState: async () => clone(persistedState),
    getInitialStateCached: async () => ({
      dashboard: '',
      gameState: clone(persistedState),
      tasks: [],
      reports: [],
      commands: [],
      contextStats: [],
    }),
    readContextStats: async () => [],
    getTaskSnapshotsCached: async () => [],
    getReportSnapshotsCached: async () => [],
    getCommandTitleByIdMapCached: async () => new Map<string, string>(),
    toTaskPayload: () => null,
    toReportPayload: () => null,
    persistDerivedGameStateIfNeeded: async () => undefined,
    readArchivedCommands: async () => [],
    readCommands: async () => [],
    queueGameStateMutation,
  };

  const gameLogicServiceDefaults: ApiRoutesDependencies['gameLogicService'] = {
    toGameState: (rawGameState) =>
      isRecord(rawGameState)
        ? (clone(rawGameState) as unknown as GameState)
        : createBaseGameState(),
    getDefaultGameState: () => createBaseGameState(),
    normalizeTownFromState,
    normalizeTown,
    normalizeInventory,
    getDefaultInventory: () => [],
    toInventoryMap,
    collectMissingUpgradeMaterials: () => [],
    formatUpgradeCost: (cost) => ({
      buildingId: cost.buildingId,
      fromLevel: cost.fromLevel,
      toLevel: cost.toLevel,
      gold: cost.gold,
      materials: [],
    }),
    resolveUpgradeCost: () => null,
    appendActivityLog: (activityLog, ...entries) => {
      const base = Array.isArray(activityLog) ? (activityLog as ActivityLogEntry[]) : [];
      const additions = entries.filter((entry): entry is ActivityLogEntry => entry !== null);
      return [...base, ...additions];
    },
    createActivityLogEntry: (entry) => ({
      ...entry,
      id: entry.id ?? `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }),
    resolveBuildingLabel: (buildingType) =>
      typeof buildingType === 'string' ? buildingType : '建物',
    resolveGameStateFromBody: (currentState, body) =>
      isRecord(body) ? ({ ...currentState, ...body } as LooseRecord) : null,
    asString,
    isRecord,
    toSafeInt,
    applyMissionRewardToTown,
    normalizeEconomyPatch,
    normalizeTownPatch,
    normalizeUseItemPayload,
    inventoryFromMap,
    normalizeBuildings: normalizeBuildingsForState,
    normalizeBuildingLevel: (value) =>
      Math.max(1, Math.min(5, Math.floor(value))) as 1 | 2 | 3 | 4 | 5,
    normalizeBuyItemPayload: () => null,
    normalizeUpgradeBuildingPayload: () => null,
    isUpgradeCostBuildingType: (value): value is BuildingType =>
      BUILDING_TYPES.includes(value as BuildingType),
    findBuildingLevel: () => 1,
    applyUpgradeMaterialCost: () => undefined,
    toBuildingState: (buildingId, level) => ({ type: buildingId, level }),
    resolveBuildingProductionProfile: () => ({
      taskCategories: [],
      rewardGoldPerMinute: 0,
      rewardXpPerMinute: 0,
      materialDropCountPerCompletion: 0,
    }),
    normalizePurchaseDecorationPayload: (payload) => {
      if (!isRecord(payload)) {
        return null;
      }

      const decorationId = asString(payload.decorationId);
      const position = normalizePosition(payload.position);
      if (!decorationId || !position) {
        return null;
      }

      return {
        decorationId,
        position,
      };
    },
    clampDecorationPosition: (position) => ({
      x: Math.floor(position.x),
      y: Math.floor(position.y),
    }),
    resolveDecorationCost: () => null,
    normalizeDecorationsForState,
    createBuildingOccupiedTiles: (buildings) => {
      const occupied = new Set<string>();
      for (const building of buildings) {
        occupied.add(`${building.position.x}:${building.position.y}`);
      }
      return occupied;
    },
    toDecorationTileKey: (x, y) => `${x}:${y}`,
    normalizeRenameAgentPayload: () => null,
    normalizeUpgradeCostQueryPayload: () => null,
  };

  const deps: ApiRoutesDependencies = {
    gameStateService: {
      ...gameStateServiceDefaults,
      ...(options.gameStateService ?? {}),
    },
    gameLogicService: {
      ...gameLogicServiceDefaults,
      ...(options.gameLogicService ?? {}),
    },
    broadcast: (type, payload) => {
      broadcasts.push({ type, payload });
    },
    normalizeAgentId: () => null,
    normalizeCommanderId: () => null,
    resolveAgentDisplayName: (_rawState, agentId) => agentId,
    normalizeWorkerId: () => null,
    parseTaskSnapshot: () => null,
    parseReportHistoryEntries: () => [],
    parseCommanderHistoryEntries: () => [],
    sortHistoryEntries: (entries) => entries,
    parsePositiveIntegerQuery: (_value, fallback) => fallback,
    toArchivedCommandSummary: () => null,
    sortArchivedCommandsByIdDesc: () => 0,
    getCommanderNamesFromState: () => ({ shogun: '将軍', karo: '家老' }),
    TASKS_DIR: 'queue/tasks',
    REPORTS_DIR: 'queue/reports',
    SHOGUN_TARGET_PANE: 'multiagent:0.0',
    VITE_DEV_HOST: 'localhost',
    VITE_DEV_PORT: 3210,
    ITEM_MASTER,
    ITEM_MASTER_BY_ID: itemMasterById,
    DEFAULT_BUILDING_POSITIONS: defaultPositions,
  };

  registerApiRoutes(app, deps);

  return {
    app,
    writes,
    broadcasts,
    getState: () => clone(persistedState),
    queueGameStateWrite,
  };
};

const createEconomyApiHarness = (initialState: GameState): TestHarness =>
  createTestHarness(initialState, {
    gameLogicService: {
      normalizeUpgradeCostQueryPayload: normalizeUpgradeCostQueryPayloadForTest,
      normalizeUpgradeBuildingPayload: normalizeUpgradeBuildingPayloadForTest,
      normalizeBuyItemPayload: normalizeBuyItemPayloadForTest,
      resolveUpgradeCost: resolveUpgradeCostForTest,
      collectMissingUpgradeMaterials: collectMissingUpgradeMaterialsForTest,
      applyUpgradeMaterialCost: applyUpgradeMaterialCostForTest,
      resolveDecorationCost: resolveDecorationCostForTest,
      formatUpgradeCost: (cost) => ({
        buildingId: cost.buildingId,
        fromLevel: cost.fromLevel,
        toLevel: cost.toLevel,
        gold: cost.gold,
        materials: cost.materials.map((material) => ({
          id: material.itemId,
          name: ITEM_MASTER_BY_ID_LOOKUP.get(material.itemId)?.name ?? material.itemId,
          quantity: material.quantity,
        })),
      }),
      findBuildingLevel: (buildings, buildingId) =>
        (buildings.find((building) => building.type === buildingId)?.level ?? 1) as
          | 1
          | 2
          | 3
          | 4
          | 5,
    },
  });

describe('API integration', () => {
  it('rejects unknown fields for /api/game-state mutation requests', async () => {
    const harness = createTestHarness(createBaseGameState());

    const response = await request(harness.app).post('/api/game-state').send({
      forbiddenField: 'unexpected',
    });

    expect(response.status).toBe(400);
    expect(harness.writes).toHaveLength(0);
    expect(harness.broadcasts).toHaveLength(0);
  });

  it('accepts whitelisted /api/game-state patch payloads', async () => {
    const harness = createTestHarness(createBaseGameState());

    const response = await request(harness.app).post('/api/game-state').send({
      town: {
        gold: 345,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
    });
    expect((harness.getState().town as { gold: number }).gold).toBe(345);
    expect((harness.getState().economy as { gold: number }).gold).toBe(345);
    expect(harness.broadcasts).toHaveLength(1);
    expect(harness.broadcasts[0]?.type).toBe('game_state_update');
  });

  it('serializes state transitions across queueGameStateWrite and queueGameStateMutation', async () => {
    const harness = createTestHarness(createBaseGameState());

    await harness.queueGameStateWrite({
      ...harness.getState(),
      town: {
        level: 1,
        xp: 10,
        gold: 75,
      },
      economy: {
        gold: 75,
      },
    });

    const townUpdate = request(harness.app).post('/api/update-town').send({ xp: 120 });
    const economyUpdate = request(harness.app).post('/api/update-economy').send({ gold: 230 });

    const [townResponse, economyResponse] = await Promise.all([townUpdate, economyUpdate]);

    expect(townResponse.status).toBe(200);
    expect(economyResponse.status).toBe(200);

    const finalState = harness.getState();
    expect(finalState.town).toMatchObject({ xp: 120, gold: 230 });
    expect(finalState.economy).toMatchObject({ gold: 230 });

    const writtenGoldHistory = harness.writes.map((state) => {
      const town = state.town as { gold: number };
      return town.gold;
    });

    expect(writtenGoldHistory).toEqual([75, 75, 230]);
    expect(harness.broadcasts).toHaveLength(2);
    expect(harness.broadcasts.every((entry) => entry.type === 'game_state_update')).toBe(true);
  });

  it('applies /api/use-item mutations and broadcasts the synchronized game state', async () => {
    const harness = createTestHarness(
      createBaseGameState({
        town: {
          level: 1,
          xp: 0,
          gold: 50,
        },
        economy: {
          gold: 50,
        },
        inventory: [
          {
            itemId: 'koban_chest',
            quantity: 1,
          },
        ],
      })
    );

    const response = await request(harness.app)
      .post('/api/use-item')
      .send({ itemId: 'koban_chest' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      itemId: 'koban_chest',
    });

    const finalState = harness.getState();
    expect(finalState.town).toMatchObject({ gold: 170 });
    expect(finalState.economy).toMatchObject({ gold: 170 });
    expect(finalState.inventory).toEqual([]);

    expect(harness.broadcasts).toHaveLength(1);
    expect(harness.broadcasts[0]?.type).toBe('game_state_update');
  });

  it('applies /api/equip-title only for unlocked titles and supports unequip', async () => {
    const harness = createTestHarness(
      createBaseGameState({
        titles: [
          {
            id: 'edict_apprentice',
            name: '御触書見習い',
            description: '御触書を累計5件成就せし者',
            condition: 'mission_claimed_count:5',
            unlockedAt: '2026-02-09T06:10:00',
          },
        ],
        equippedTitle: null,
      })
    );

    const forbidden = await request(harness.app).post('/api/equip-title').send({
      titleId: 'edict_shogun',
    });
    expect(forbidden.status).toBe(403);

    const equip = await request(harness.app).post('/api/equip-title').send({
      titleId: 'edict_apprentice',
    });
    expect(equip.status).toBe(200);
    expect(equip.body).toMatchObject({
      success: true,
      equippedTitle: 'edict_apprentice',
    });
    expect(harness.getState().equippedTitle).toBe('edict_apprentice');

    const unequip = await request(harness.app).post('/api/equip-title').send({
      titleId: null,
    });
    expect(unequip.status).toBe(200);
    expect(unequip.body).toMatchObject({
      success: true,
      equippedTitle: null,
    });
    expect(harness.getState().equippedTitle).toBeNull();
  });

  it('auto-repairs and equips titles when derived state is eligible but persisted titles are stale', async () => {
    const staleState = createBaseGameState({
      activityLog: Array.from({ length: 7 }, (_, index) => ({
        id: `persisted-${index}`,
        type: 'work_complete',
        timestamp: `2026-02-10T00:0${index}:00.000Z`,
        message: `persisted work complete ${index}`,
      })),
      titles: [],
      equippedTitle: null,
    });

    const harness = createTestHarness(staleState, {
      gameLogicService: {
        toGameState: (rawGameState) => {
          const base = isRecord(rawGameState)
            ? (clone(rawGameState) as unknown as GameState)
            : createBaseGameState();
          const derivedActivityLog: ActivityLogEntry[] = [
            ...base.activityLog,
            ...Array.from(
              { length: 4 },
              (_, index): ActivityLogEntry => ({
                id: `derived-${index}`,
                type: 'work_complete',
                timestamp: `2026-02-10T01:0${index}:00.000Z`,
                message: `derived work complete ${index}`,
              })
            ),
          ];

          return {
            ...base,
            activityLog: derivedActivityLog,
          };
        },
      },
    });

    const response = await request(harness.app).post('/api/equip-title').send({
      titleId: 'foot_captain',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      equippedTitle: 'foot_captain',
    });

    const persisted = harness.getState();
    const persistedTitles = Array.isArray(persisted.titles)
      ? (persisted.titles as Array<{ id?: string; unlockedAt?: string }>)
      : [];
    const equippedTitle = persisted.equippedTitle as string | null;
    const footCaptain = persistedTitles.find((title) => title.id === 'foot_captain');
    expect(footCaptain?.unlockedAt).toEqual(expect.any(String));
    expect(equippedTitle).toBe('foot_captain');
  });

  it('supports decoration collect, place, and move lifecycle', async () => {
    const harness = createTestHarness(
      createBaseGameState({
        decorations: [
          {
            id: 'stone-1',
            type: 'stone_lantern',
            position: { x: 5, y: 5 },
          },
          {
            id: 'market-1',
            type: 'market_stall',
            position: { x: 8, y: 8 },
          },
        ],
      })
    );

    const collectResponse = await request(harness.app)
      .post('/api/collect-decoration')
      .send({ decorationId: 'stone-1' });
    expect(collectResponse.status).toBe(200);
    expect(collectResponse.body).toMatchObject({ success: true });

    const collectedState = harness.getState() as unknown as GameState;
    const collectedDecoration = collectedState.decorations.find((entry) => entry.id === 'stone-1');
    expect(collectedDecoration).toBeDefined();
    expect(collectedDecoration?.position).toBeUndefined();

    const placeResponse = await request(harness.app)
      .post('/api/place-decoration')
      .send({ decorationType: 'stone_lantern', position: { x: 3, y: 4 } });
    expect(placeResponse.status).toBe(200);
    expect(placeResponse.body).toMatchObject({ success: true });
    expect(placeResponse.body.decoration?.position).toMatchObject({ x: 3, y: 4 });

    const moveResponse = await request(harness.app)
      .post('/api/move-decoration')
      .send({ decorationId: 'stone-1', position: { x: 4, y: 4 } });
    expect(moveResponse.status).toBe(200);
    expect(moveResponse.body).toMatchObject({ success: true });
    expect(moveResponse.body.decoration?.position).toMatchObject({ x: 4, y: 4 });

    const movedState = harness.getState() as unknown as GameState;
    const movedDecoration = movedState.decorations.find((entry) => entry.id === 'stone-1');
    expect(movedDecoration?.position).toMatchObject({ x: 4, y: 4 });
    expect(harness.broadcasts.filter((entry) => entry.type === 'game_state_update')).toHaveLength(3);
  });

  it('supports upgrading placed decorations with gold cost', async () => {
    const firstUpgradeCost =
      ITEM_MASTER.find((item) => item.id === 'maneki_neko')?.upgradeCosts?.[0] ?? 0;
    expect(firstUpgradeCost).toBeGreaterThan(0);

    const harness = createTestHarness(
      createBaseGameState({
        town: {
          level: 1,
          xp: 0,
          gold: 500,
        },
        economy: {
          gold: 500,
        },
        decorations: [
          {
            id: 'maneki-1',
            type: 'maneki_neko',
            position: { x: 5, y: 5 },
            level: 1,
          },
        ],
      })
    );

    const response = await request(harness.app)
      .post('/api/upgrade-decoration')
      .send({ decorationId: 'maneki-1' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      decoration: {
        id: 'maneki-1',
        type: 'maneki_neko',
        level: 2,
      },
      cost: firstUpgradeCost,
    });

    const nextState = harness.getState() as unknown as GameState;
    const upgraded = nextState.decorations.find((entry) => entry.id === 'maneki-1');
    expect(upgraded?.level).toBe(2);
    expect(nextState.town.gold).toBe(500 - firstUpgradeCost);
    expect(harness.broadcasts.filter((entry) => entry.type === 'game_state_update')).toHaveLength(1);
  });

  it('supports moving buildings and rejects overlapping placements', async () => {
    const harness = createTestHarness(
      createBaseGameState({
        buildings: [
          { type: 'dojo', level: 1, position: { x: 2, y: 2 } },
          { type: 'smithy', level: 1, position: { x: 6, y: 5 } },
        ],
        decorations: [
          {
            id: 'lantern-1',
            type: 'stone_lantern',
            position: { x: 4, y: 4 },
          },
        ],
      })
    );

    const moveResponse = await request(harness.app)
      .post('/api/move-building')
      .send({ buildingId: 'dojo', position: { x: 3, y: 3 } });
    expect(moveResponse.status).toBe(200);
    expect(moveResponse.body).toMatchObject({
      success: true,
      building: {
        type: 'dojo',
        position: { x: 3, y: 3 },
      },
    });

    const stateAfterMove = harness.getState() as unknown as GameState;
    const movedDojo = stateAfterMove.buildings.find((building) => building.type === 'dojo');
    expect(movedDojo?.position).toMatchObject({ x: 3, y: 3 });

    const overlapBuilding = await request(harness.app)
      .post('/api/move-building')
      .send({ buildingId: 'dojo', position: { x: 6, y: 5 } });
    expect(overlapBuilding.status).toBe(409);

    const overlapDecoration = await request(harness.app)
      .post('/api/move-building')
      .send({ buildingId: 'dojo', position: { x: 4, y: 4 } });
    expect(overlapDecoration.status).toBe(409);

    expect(harness.broadcasts.filter((entry) => entry.type === 'game_state_update')).toHaveLength(1);
  });

  it('supports /api/upgrade-cost and returns affordability diagnostics', async () => {
    const currentGold = TEST_UPGRADE_COST.gold - 10;
    const harness = createEconomyApiHarness(
      createBaseGameState({
        buildings: [{ type: TEST_UPGRADE_BUILDING_ID, level: 1, position: { x: 0, y: 0 } }],
        town: {
          level: 1,
          xp: 0,
          gold: currentGold,
        },
        economy: {
          gold: currentGold,
        },
        inventory: [{ itemId: TEST_UPGRADE_MATERIAL_ID, quantity: 1 }],
      })
    );

    const invalidPayloadResponse = await request(harness.app)
      .get('/api/upgrade-cost')
      .query({ buildingId: TEST_UPGRADE_BUILDING_ID });
    expect(invalidPayloadResponse.status).toBe(400);

    const response = await request(harness.app)
      .get('/api/upgrade-cost')
      .query({ buildingId: TEST_UPGRADE_BUILDING_ID, currentLevel: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      cost: {
        buildingId: TEST_UPGRADE_BUILDING_ID,
        fromLevel: 1,
        toLevel: 2,
        gold: TEST_UPGRADE_COST.gold,
      },
      affordability: {
        requiredGold: TEST_UPGRADE_COST.gold,
        haveGold: currentGold,
        missingGold: 10,
      },
    });
    expect(response.body.affordability.missingMaterials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: TEST_UPGRADE_MATERIAL_ID,
          required: 2,
          have: 1,
        }),
      ])
    );
  });

  it('supports /api/claim-reward success and rejects invalid payloads', async () => {
    const harness = createTestHarness(
      createBaseGameState({
        town: {
          level: 1,
          xp: 0,
          gold: 100,
        },
        economy: {
          gold: 100,
        },
        missions: [
          {
            id: 'mission-ready',
            title: 'Ready mission',
            conditions: ['test'],
            reward: { xp: 35, gold: 25 },
            progress: { current: 1, target: 1 },
            claimed: false,
          },
        ],
      })
    );

    const invalidPayloadResponse = await request(harness.app).post('/api/claim-reward').send({});
    expect(invalidPayloadResponse.status).toBe(400);

    const successResponse = await request(harness.app).post('/api/claim-reward').send({
      missionId: 'mission-ready',
    });
    expect(successResponse.status).toBe(200);
    expect(successResponse.body).toMatchObject({
      success: true,
      missionId: 'mission-ready',
    });

    const nextState = harness.getState() as unknown as GameState;
    const claimedMission = nextState.missions.find((mission) => mission.id === 'mission-ready');
    expect(claimedMission?.claimed).toBe(true);
    expect(nextState.town).toMatchObject({
      xp: 35,
      gold: 125,
    });
    expect(harness.broadcasts.filter((entry) => entry.type === 'game_state_update')).toHaveLength(1);
  });

  it('supports /api/buy-item success path and handles insufficient gold/invalid payload', async () => {
    const purchasableItem = ITEM_MASTER.find(
      (item) => item.itemType !== 'decoration' && item.purchasable !== false && item.shopCost > 0
    );
    expect(purchasableItem).toBeDefined();
    if (!purchasableItem) {
      return;
    }

    const startingGold = purchasableItem.shopCost + 20;
    const successHarness = createEconomyApiHarness(
      createBaseGameState({
        town: {
          level: 1,
          xp: 0,
          gold: startingGold,
        },
        economy: {
          gold: startingGold,
        },
      })
    );

    const invalidPayloadResponse = await request(successHarness.app).post('/api/buy-item').send({});
    expect(invalidPayloadResponse.status).toBe(400);

    const successResponse = await request(successHarness.app).post('/api/buy-item').send({
      itemId: purchasableItem.id,
      quantity: 1,
    });
    expect(successResponse.status).toBe(200);
    expect(successResponse.body).toMatchObject({
      success: true,
      itemId: purchasableItem.id,
      quantity: 1,
    });

    const successState = successHarness.getState() as unknown as GameState;
    expect(successState.town.gold).toBe(startingGold - purchasableItem.shopCost);
    const purchasedEntry = successState.inventory.find((entry) => entry.itemId === purchasableItem.id);
    expect(purchasedEntry?.quantity).toBe(1);

    const insufficientGoldHarness = createEconomyApiHarness(
      createBaseGameState({
        town: {
          level: 1,
          xp: 0,
          gold: Math.max(0, purchasableItem.shopCost - 1),
        },
        economy: {
          gold: Math.max(0, purchasableItem.shopCost - 1),
        },
      })
    );

    const insufficientGoldResponse = await request(insufficientGoldHarness.app).post('/api/buy-item').send({
      itemId: purchasableItem.id,
      quantity: 1,
    });
    expect(insufficientGoldResponse.status).toBe(400);
    expect(insufficientGoldResponse.body.error).toContain('ゴールド不足');
  });

  it('supports /api/upgrade-building success and detects gold/material shortages', async () => {
    const successHarness = createEconomyApiHarness(
      createBaseGameState({
        buildings: [{ type: TEST_UPGRADE_BUILDING_ID, level: 1, position: { x: 0, y: 0 } }],
        town: {
          level: 1,
          xp: 0,
          gold: TEST_UPGRADE_COST.gold + 20,
        },
        economy: {
          gold: TEST_UPGRADE_COST.gold + 20,
        },
        inventory: [{ itemId: TEST_UPGRADE_MATERIAL_ID, quantity: 2 }],
      })
    );

    const invalidPayloadResponse = await request(successHarness.app)
      .post('/api/upgrade-building')
      .send({});
    expect(invalidPayloadResponse.status).toBe(400);

    const successResponse = await request(successHarness.app).post('/api/upgrade-building').send({
      buildingId: TEST_UPGRADE_BUILDING_ID,
    });
    expect(successResponse.status).toBe(200);
    expect(successResponse.body).toMatchObject({
      success: true,
      building: {
        type: TEST_UPGRADE_BUILDING_ID,
        level: 2,
      },
    });

    const successState = successHarness.getState() as unknown as GameState;
    const upgradedBuilding = successState.buildings.find(
      (building) => building.type === TEST_UPGRADE_BUILDING_ID
    );
    expect(upgradedBuilding?.level).toBe(2);
    expect(successState.town.gold).toBe(20);
    expect(successState.inventory.find((entry) => entry.itemId === TEST_UPGRADE_MATERIAL_ID)).toBeUndefined();

    const insufficientGoldHarness = createEconomyApiHarness(
      createBaseGameState({
        buildings: [{ type: TEST_UPGRADE_BUILDING_ID, level: 1, position: { x: 0, y: 0 } }],
        town: {
          level: 1,
          xp: 0,
          gold: TEST_UPGRADE_COST.gold - 1,
        },
        economy: {
          gold: TEST_UPGRADE_COST.gold - 1,
        },
        inventory: [{ itemId: TEST_UPGRADE_MATERIAL_ID, quantity: 2 }],
      })
    );
    const insufficientGoldResponse = await request(insufficientGoldHarness.app)
      .post('/api/upgrade-building')
      .send({ buildingId: TEST_UPGRADE_BUILDING_ID });
    expect(insufficientGoldResponse.status).toBe(400);
    expect(insufficientGoldResponse.body.error).toBe('ゴールド不足');
    expect(insufficientGoldResponse.body.missingGold).toBe(1);

    const insufficientMaterialHarness = createEconomyApiHarness(
      createBaseGameState({
        buildings: [{ type: TEST_UPGRADE_BUILDING_ID, level: 1, position: { x: 0, y: 0 } }],
        town: {
          level: 1,
          xp: 0,
          gold: TEST_UPGRADE_COST.gold + 20,
        },
        economy: {
          gold: TEST_UPGRADE_COST.gold + 20,
        },
        inventory: [{ itemId: TEST_UPGRADE_MATERIAL_ID, quantity: 1 }],
      })
    );
    const insufficientMaterialResponse = await request(insufficientMaterialHarness.app)
      .post('/api/upgrade-building')
      .send({ buildingId: TEST_UPGRADE_BUILDING_ID });
    expect(insufficientMaterialResponse.status).toBe(400);
    expect(insufficientMaterialResponse.body.error).toBe('素材不足');
    expect(insufficientMaterialResponse.body.missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: TEST_UPGRADE_MATERIAL_ID,
          required: 2,
          have: 1,
        }),
      ])
    );
  });

  it('supports /api/purchase-decoration success and handles invalid/funds errors', async () => {
    const purchasableDecoration = ITEM_MASTER.find(
      (item) => item.itemType === 'decoration' && item.purchasable !== false && item.shopCost > 0
    );
    expect(purchasableDecoration).toBeDefined();
    if (!purchasableDecoration) {
      return;
    }

    const successHarness = createEconomyApiHarness(
      createBaseGameState({
        town: {
          level: 1,
          xp: 0,
          gold: purchasableDecoration.shopCost + 25,
        },
        economy: {
          gold: purchasableDecoration.shopCost + 25,
        },
      })
    );

    const invalidPayloadResponse = await request(successHarness.app)
      .post('/api/purchase-decoration')
      .send({});
    expect(invalidPayloadResponse.status).toBe(400);

    const successResponse = await request(successHarness.app).post('/api/purchase-decoration').send({
      decorationId: purchasableDecoration.id,
      position: { x: 10, y: 10 },
    });
    expect(successResponse.status).toBe(200);
    expect(successResponse.body).toMatchObject({
      success: true,
      decoration: {
        type: purchasableDecoration.id,
        position: { x: 10, y: 10 },
      },
      cost: purchasableDecoration.shopCost,
    });

    const successState = successHarness.getState() as unknown as GameState;
    expect(successState.town.gold).toBe(25);
    expect(
      successState.decorations.some((decoration) => decoration.id === successResponse.body.decoration.id)
    ).toBe(true);

    const insufficientGoldHarness = createEconomyApiHarness(
      createBaseGameState({
        town: {
          level: 1,
          xp: 0,
          gold: Math.max(0, purchasableDecoration.shopCost - 1),
        },
        economy: {
          gold: Math.max(0, purchasableDecoration.shopCost - 1),
        },
      })
    );
    const insufficientGoldResponse = await request(insufficientGoldHarness.app)
      .post('/api/purchase-decoration')
      .send({
        decorationId: purchasableDecoration.id,
        position: { x: 11, y: 11 },
      });
    expect(insufficientGoldResponse.status).toBe(403);
    expect(insufficientGoldResponse.body.missingGold).toBe(1);
  });
});
