import { create } from 'zustand';
import type {
  ActivityLogEntry,
  BuildingLevel,
  BuildingType,
  GameState,
  InventoryItem,
  ItemDefinition,
  Position,
  TownState,
} from '@/types';
import { getNextRankXP, getRank, getRankDefinition } from '@/lib/gamification/rank-system';
import { calculateTaskXP, type XPCalculationInput } from '@/lib/gamification/xp-calculator';
import { ITEM_MASTER } from '@/data/item-master';
import { TOWN_LEVEL_XP_THRESHOLDS } from '@/types';
import { clampBuildingLevel } from '@/game/objects/buildings/BuildingConfig';
import { logger } from '@/lib/logger';

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
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;
const ITEM_FETCH_CACHE_TTL_MS = 30_000;
let itemListLastLoadedAt = 0;
let itemListLoadInFlight: Promise<void> | null = null;

const postJson = async (url: string, payload: unknown): Promise<void> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status}`);
  }
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
    level: resolveTownLevel(xp),
    xp,
    gold,
  };
};

const toSafeDelta = (value: number): number => (Number.isFinite(value) ? Math.floor(value) : 0);

const applyTownDelta = (currentTown: TownState, delta: { xp?: number; gold?: number }): TownState =>
  normalizeTown({
    ...currentTown,
    xp: currentTown.xp + toSafeDelta(delta.xp ?? 0),
    gold: currentTown.gold + toSafeDelta(delta.gold ?? 0),
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeInventory = (inventory: unknown): InventoryItem[] => {
  if (!Array.isArray(inventory)) {
    return [];
  }

  const byItemId = new Map<string, InventoryItem>();
  for (const entry of inventory) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const rawItemId = (entry as { itemId?: unknown }).itemId;
    const rawQuantity = (entry as { quantity?: unknown }).quantity;

    if (typeof rawItemId !== 'string' || rawItemId.trim().length === 0) {
      continue;
    }

    const quantity =
      typeof rawQuantity === 'number' && Number.isFinite(rawQuantity)
        ? Math.max(0, Math.floor(rawQuantity))
        : 0;

    const existing = byItemId.get(rawItemId);
    if (!existing) {
      if (quantity > 0) {
        byItemId.set(rawItemId, {
          itemId: rawItemId,
          quantity,
        });
      }
      continue;
    }

    byItemId.set(rawItemId, {
      itemId: rawItemId,
      quantity: existing.quantity + quantity,
    });
  }

  return Array.from(byItemId.values());
};

const normalizeActivityLog = (activityLog: unknown): ActivityLogEntry[] =>
  Array.isArray(activityLog) ? (activityLog as ActivityLogEntry[]) : [];

const normalizeAchievements = (value: unknown): GameState['achievements'] =>
  Array.isArray(value) ? (value as GameState['achievements']) : [];

const normalizeTitles = (value: unknown): GameState['titles'] =>
  Array.isArray(value) ? (value as GameState['titles']) : [];

const normalizeDailyRecords = (value: unknown): GameState['dailyRecords'] =>
  Array.isArray(value) ? (value as GameState['dailyRecords']) : [];

const normalizeMaterialCollection = (value: unknown): GameState['materialCollection'] =>
  Array.isArray(value) ? (value as GameState['materialCollection']) : [];

const normalizeEquippedTitle = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const hasOptionalArray = (value: Record<string, unknown>, key: string): boolean =>
  value[key] === undefined || Array.isArray(value[key]);

const hasOptionalNullableString = (value: Record<string, unknown>, key: string): boolean =>
  value[key] === undefined || value[key] === null || typeof value[key] === 'string';

const isItemEffectType = (value: unknown): value is ItemDefinition['effect']['type'] =>
  value === 'town_xp_boost' ||
  value === 'town_gold_boost' ||
  value === 'passive_bonus';

const isItemType = (value: unknown): value is ItemDefinition['itemType'] =>
  value === 'consumable' || value === 'treasure' || value === 'material' || value === 'decoration';

const isItemRarity = (value: unknown): value is ItemDefinition['rarity'] =>
  value === 'common' ||
  value === 'uncommon' ||
  value === 'rare' ||
  value === 'epic' ||
  value === 'legendary';

const normalizeItemCatalog = (catalog: unknown): ItemDefinition[] => {
  if (!Array.isArray(catalog)) {
    return [];
  }

  const normalized: ItemDefinition[] = [];
  for (const item of catalog) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const source = item as Record<string, unknown>;
    const effectSource =
      typeof source.effect === 'object' && source.effect !== null
        ? (source.effect as Record<string, unknown>)
        : null;
    if (!effectSource) {
      continue;
    }

    if (
      typeof source.id !== 'string' ||
      typeof source.name !== 'string' ||
      typeof source.description !== 'string' ||
      !isItemType(source.itemType) ||
      !isItemRarity(source.rarity) ||
      !isItemEffectType(effectSource.type) ||
      typeof effectSource.value !== 'number' ||
      !Number.isFinite(effectSource.value) ||
      typeof source.usable !== 'boolean' ||
      typeof source.stackable !== 'boolean' ||
      typeof source.shopCost !== 'number' ||
      !Number.isFinite(source.shopCost)
    ) {
      continue;
    }

    normalized.push({
      id: source.id,
      name: source.name,
      description: source.description,
      itemType: source.itemType,
      rarity: source.rarity,
      effect: {
        type: effectSource.type,
        value: Math.floor(effectSource.value),
        key: typeof effectSource.key === 'string' ? effectSource.key : undefined,
      },
      usable: source.usable,
      stackable: source.stackable,
      shopCost: Math.max(0, Math.floor(source.shopCost)),
      ...(typeof source.purchasable === 'boolean' ? { purchasable: source.purchasable } : {}),
      ...(Array.isArray(source.upgradeCosts)
        ? {
            upgradeCosts: source.upgradeCosts
              .map((entry) =>
                typeof entry === 'number' && Number.isFinite(entry)
                  ? Math.max(0, Math.floor(entry))
                  : null
              )
              .filter((entry): entry is number => entry !== null),
          }
        : {}),
    });
  }

  return normalized;
};

const isGameStatePayload = (value: unknown): value is GameState =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { ashigaru?: unknown }).ashigaru) &&
  Array.isArray((value as { buildings?: unknown }).buildings) &&
  typeof (value as { town?: unknown }).town === 'object' &&
  (value as { town?: unknown }).town !== null &&
  typeof (value as { economy?: unknown }).economy === 'object' &&
  (value as { economy?: unknown }).economy !== null &&
  Array.isArray((value as { inventory?: unknown }).inventory) &&
  Array.isArray((value as { decorations?: unknown }).decorations) &&
  Array.isArray((value as { missions?: unknown }).missions) &&
  Array.isArray((value as { activityLog?: unknown }).activityLog) &&
  hasOptionalArray(value as Record<string, unknown>, 'achievements') &&
  hasOptionalArray(value as Record<string, unknown>, 'titles') &&
  hasOptionalNullableString(value as Record<string, unknown>, 'equippedTitle') &&
  hasOptionalArray(value as Record<string, unknown>, 'dailyRecords') &&
  hasOptionalArray(value as Record<string, unknown>, 'materialCollection');

const normalizeGameState = (state: GameState): GameState => {
  const town = normalizeTown(state.town);
  return {
    ...state,
    town,
    economy: {
      ...state.economy,
      gold: town.gold,
    },
    buildings: normalizeBuildings(state.buildings),
    inventory: normalizeInventory(state.inventory),
    activityLog: normalizeActivityLog(state.activityLog),
    achievements: normalizeAchievements(state.achievements),
    titles: normalizeTitles(state.titles),
    equippedTitle: normalizeEquippedTitle(state.equippedTitle),
    dailyRecords: normalizeDailyRecords(state.dailyRecords),
    materialCollection: normalizeMaterialCollection(state.materialCollection),
  };
};

let townPersistQueue: Promise<void> = Promise.resolve();

const persistTown = (town: TownState): Promise<void> => {
  const payload: TownState = { ...town };
  const queuedRequest = townPersistQueue.then(() => postJson('/api/update-town', payload));
  townPersistQueue = queuedRequest.catch(() => undefined);
  return queuedRequest;
};

const persistBuildingUpgrade = (buildingId: BuildingType, newLevel: BuildingLevel): Promise<void> =>
  postJson('/api/upgrade-building', {
    buildingId,
    newLevel,
  });

const persistDecorationPurchase = (decorationType: string, position: Position): Promise<void> =>
  postJson('/api/purchase-decoration', {
    decorationId: decorationType,
    position,
  });

const extractGameStateFromPayload = (payload: unknown): GameState | null => {
  if (isGameStatePayload(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return null;
  }

  const directCandidates = [payload.data, payload.state, payload.gameState];
  for (const candidate of directCandidates) {
    if (isGameStatePayload(candidate)) {
      return candidate;
    }

    if (!isRecord(candidate)) {
      continue;
    }

    if (isGameStatePayload(candidate.state)) {
      return candidate.state;
    }
    if (isGameStatePayload(candidate.gameState)) {
      return candidate.gameState;
    }
  }

  return null;
};

const fetchLatestGameState = async (): Promise<GameState> => {
  const response = await fetch('/api/game-state', {
    method: 'GET',
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(`GET /api/game-state failed: ${response.status}`);
  }

  const parsed = extractGameStateFromPayload(payload);
  if (!parsed) {
    throw new Error('game-state payload is missing or invalid.');
  }

  return normalizeGameState(parsed);
};

const resyncGameStateFromServer = async (reason: string): Promise<void> => {
  try {
    const latestGameState = await fetchLatestGameState();
    useGameStore.getState().updateGameState(latestGameState);
  } catch (error) {
    logger.error('[gameStore] failed to resync game state', {
      reason,
      error,
    });
  }
};

const normalizePosition = (position: Position): Position => ({
  x: Number.isFinite(position.x) ? Math.floor(position.x) : 0,
  y: Number.isFinite(position.y) ? Math.floor(position.y) : 0,
});

export interface TownRankInfo {
  value: number;
  title: string;
  nextRequiredXP: number | null;
}

const toTownRankInfo = (town: TownState): TownRankInfo => {
  const rankXP = Math.max(0, Math.floor(town.xp));
  const rankValue = getRank(rankXP);
  const rankDefinition = getRankDefinition(rankValue);

  return {
    value: rankValue,
    title: rankDefinition.title,
    nextRequiredXP: getNextRankXP(rankValue),
  };
};

const normalizeBuildingLevel = (value: unknown): BuildingLevel => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1;
  }

  return clampBuildingLevel(Math.floor(value));
};

const getNextBuildingLevel = (currentLevel: BuildingLevel): BuildingLevel =>
  clampBuildingLevel(currentLevel + 1);

const createDefaultBuildingLevels = (): Record<BuildingType, BuildingLevel> => ({
  castle: 1,
  mansion: 1,
  inn: 1,
  dojo: 1,
  smithy: 1,
  training: 1,
  study: 1,
  healer: 1,
  watchtower: 1,
  scriptorium: 1,
});

const normalizeBuildings = (buildings: GameState['buildings']): GameState['buildings'] =>
  buildings.map((building) => ({
    ...building,
    level: normalizeBuildingLevel(building.level),
  }));

const deriveBuildingLevels = (
  gameState: Pick<GameState, 'buildings'> | null
): Record<BuildingType, BuildingLevel> => {
  const levels = createDefaultBuildingLevels();
  if (!gameState) {
    return levels;
  }

  for (const building of gameState.buildings) {
    if (BUILDING_TYPES.includes(building.type)) {
      levels[building.type] = normalizeBuildingLevel(building.level);
    }
  }

  return levels;
};

interface ItemListResponse {
  success?: boolean;
  error?: string;
  items?: unknown;
  inventory?: unknown;
  gameState?: unknown;
}

interface ItemActionResponse {
  success?: boolean;
  error?: string;
  message?: string;
  items?: unknown;
  inventory?: unknown;
  gameState?: unknown;
}

export interface ItemActionResult {
  success: boolean;
  message: string;
}

const DEFAULT_TOWN_STATE: TownState = { level: 1, xp: 0, gold: 0 };

type DerivedGameStoreSlice = Pick<GameStoreState, 'buildingLevels' | 'townRank' | 'inventory'>;

const deriveGameStoreSlice = (gameState: GameState | null): DerivedGameStoreSlice => ({
  buildingLevels: deriveBuildingLevels(gameState),
  townRank: toTownRankInfo(gameState?.town ?? DEFAULT_TOWN_STATE),
  inventory: gameState?.inventory ?? [],
});

const toGameStorePatch = (
  gameState: GameState | null
): Pick<GameStoreState, 'gameState' | 'buildingLevels' | 'townRank' | 'inventory'> => ({
  gameState,
  ...deriveGameStoreSlice(gameState),
});

const applyItemPayloadToStore = (payload: ItemListResponse | ItemActionResponse | null): void => {
  if (payload === null) {
    return;
  }

  const catalog = normalizeItemCatalog(payload.items);
  if (catalog.length > 0) {
    useGameStore.setState({ itemCatalog: catalog });
  }

  if (isGameStatePayload(payload.gameState)) {
    useGameStore.getState().updateGameState(payload.gameState);
    return;
  }

  if (payload.inventory !== undefined) {
    const inventory = normalizeInventory(payload.inventory);
    useGameStore.setState((current) => {
      if (!current.gameState) {
        return {
          ...current,
          inventory,
        };
      }

      const nextGameState: GameState = {
        ...current.gameState,
        inventory,
      };
      return {
        ...current,
        ...toGameStorePatch(nextGameState),
      };
    });
  }
};

export interface GameStoreState {
  gameState: GameState | null;
  buildingLevels: Record<BuildingType, BuildingLevel>;
  townRank: TownRankInfo;
  inventory: InventoryItem[];
  itemCatalog: ItemDefinition[];
  updateGameState: (state: GameState) => void;
  addTownXP: (input: XPCalculationInput) => void;
  addGold: (amount: number) => void;
  upgradeBuilding: (type: BuildingType) => void;
  purchaseDecoration: (type: string, pos: Position) => void;
  loadItems: () => Promise<void>;
  consumeItem: (itemId: string) => Promise<ItemActionResult>;
  buyItem: (itemId: string, quantity?: number) => Promise<ItemActionResult>;
}

export const selectInventory = (state: GameStoreState): InventoryItem[] =>
  state.gameState?.inventory ?? state.inventory;

export const selectTownRank = (state: GameStoreState): TownRankInfo =>
  toTownRankInfo(state.gameState?.town ?? DEFAULT_TOWN_STATE);

export const selectBuildingLevels = (
  state: GameStoreState
): Record<BuildingType, BuildingLevel> => deriveBuildingLevels(state.gameState);

export const useGameStore = create<GameStoreState>((set) => {
  const updateTownAndPersist = (delta: { xp?: number; gold?: number }): void => {
    let townToPersist: TownState | null = null;

    set((current) => {
      if (!current.gameState) {
        return current;
      }

      const nextTown = applyTownDelta(current.gameState.town, delta);
      townToPersist = nextTown;
      const nextGameState: GameState = {
        ...current.gameState,
        town: nextTown,
        economy: {
          ...current.gameState.economy,
          gold: nextTown.gold,
        },
      };

      return toGameStorePatch(nextGameState);
    });

    if (townToPersist) {
      const townPayload = townToPersist;
      void persistTown(townPayload).catch((error) => {
        logger.error('[gameStore] failed to persist town', {
          error,
          town: townPayload,
        });
        void resyncGameStateFromServer('update-town');
      });
    }
  };

  return {
    gameState: null,
    buildingLevels: createDefaultBuildingLevels(),
    townRank: toTownRankInfo(DEFAULT_TOWN_STATE),
    inventory: [],
    itemCatalog: ITEM_MASTER,
    updateGameState: (state) =>
      set(() => {
        const nextGameState = normalizeGameState(state);
        return toGameStorePatch(nextGameState);
      }),
    addTownXP: (input) => {
      updateTownAndPersist({ xp: calculateTaskXP(input) });
    },
    addGold: (amount) => {
      updateTownAndPersist({ gold: amount });
    },
    upgradeBuilding: (type) => {
      let nextLevel: BuildingLevel | null = null;

      set((current) => {
        if (!current.gameState) {
          return current;
        }

        let found = false;
        const buildings = current.gameState.buildings.map((building) => {
          if (building.type !== type) {
            return building;
          }

          found = true;
          const upgradedLevel = getNextBuildingLevel(building.level);
          if (upgradedLevel === building.level) {
            return building;
          }

          nextLevel = upgradedLevel;
          return {
            ...building,
            level: upgradedLevel,
          };
        });

        if (!found) {
          nextLevel = 1;
          buildings.push({
            type,
            level: 1,
            position: { x: 0, y: 0 },
          });
        }

        const nextGameState: GameState = {
          ...current.gameState,
          buildings: normalizeBuildings(buildings),
        };

        return toGameStorePatch(nextGameState);
      });

      if (nextLevel !== null) {
        const levelToPersist = nextLevel;
        void persistBuildingUpgrade(type, levelToPersist).catch((error) => {
          logger.error('[gameStore] failed to persist building upgrade', {
            buildingId: type,
            newLevel: levelToPersist,
            error,
          });
          void resyncGameStateFromServer('upgrade-building');
        });
      }
    },
    purchaseDecoration: (type, pos) => {
      const decorationId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const normalizedPos = normalizePosition(pos);
      let shouldPersist = false;

      set((current) => {
        if (!current.gameState) {
          return current;
        }

        shouldPersist = true;
        const nextGameState: GameState = {
          ...current.gameState,
          decorations: [
            ...current.gameState.decorations,
            {
              id: decorationId,
              type,
              position: normalizedPos,
            },
          ],
        };
        return toGameStorePatch(nextGameState);
      });

      if (shouldPersist) {
        void persistDecorationPurchase(type, normalizedPos).catch((error) => {
          logger.error('[gameStore] failed to persist decoration purchase', {
            decorationType: type,
            position: normalizedPos,
            error,
          });
          void resyncGameStateFromServer('purchase-decoration');
        });
      }
    },
    loadItems: async () => {
      if (itemListLoadInFlight) {
        return itemListLoadInFlight;
      }

      if (Date.now() - itemListLastLoadedAt < ITEM_FETCH_CACHE_TTL_MS) {
        return;
      }

      itemListLoadInFlight = (async () => {
        try {
          const response = await fetch('/api/items', {
            method: 'GET',
          });
          const payload = (await response.json().catch(() => null)) as ItemListResponse | null;

          if (!response.ok) {
            throw new Error(payload?.error ?? 'アイテム一覧の取得に失敗いたした。');
          }
          if (payload === null) {
            throw new Error('アイテム一覧の応答解析に失敗いたした。');
          }

          applyItemPayloadToStore(payload);
          itemListLastLoadedAt = Date.now();
        } catch (error) {
          logger.error('[gameStore] failed to load items', {
            error,
          });
        } finally {
          itemListLoadInFlight = null;
        }
      })();

      return itemListLoadInFlight;
    },
    consumeItem: async (itemId) => {
      try {
        const response = await fetch('/api/use-item', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ itemId }),
        });
        const payload = (await response.json().catch(() => null)) as ItemActionResponse | null;

        if (payload === null) {
          return {
            success: false,
            message: '応答の解析に失敗いたした。時をおいて再試行されよ。',
          };
        }

        if (!response.ok || payload?.success === false) {
          return {
            success: false,
            message: payload?.error ?? 'アイテム使用に失敗いたした。',
          };
        }

        applyItemPayloadToStore(payload);
        return {
          success: true,
          message: payload?.message ?? 'アイテムを使用いたした。',
        };
      } catch {
        return {
          success: false,
          message: '通信に失敗いたした。時をおいて再試行されよ。',
        };
      }
    },
    buyItem: async (itemId, quantity = 1) => {
      try {
        const response = await fetch('/api/buy-item', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            itemId,
            quantity,
          }),
        });
        const payload = (await response.json().catch(() => null)) as ItemActionResponse | null;

        if (payload === null) {
          return {
            success: false,
            message: '応答の解析に失敗いたした。時をおいて再試行されよ。',
          };
        }

        if (!response.ok || payload?.success === false) {
          return {
            success: false,
            message: payload?.error ?? 'アイテム購入に失敗いたした。',
          };
        }

        applyItemPayloadToStore(payload);
        return {
          success: true,
          message: payload?.message ?? 'アイテムを購入いたした。',
        };
      } catch {
        return {
          success: false,
          message: '通信に失敗いたした。時をおいて再試行されよ。',
        };
      }
    },
  };
});
