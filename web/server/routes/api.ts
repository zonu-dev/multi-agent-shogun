import express from 'express';
import { promises as fs } from 'node:fs';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import type {
  ActivityLogEntry,
  BuildingLevel,
  BuildingType,
  GameState,
} from '../../src/types/game';
import { BUILDING_CONFIGS } from '../../src/game/objects/buildings/BuildingConfig';
import type { InventoryItem, ItemDefinition } from '../../src/types/item';
import { COMMAND_ARCHIVE_FILE_PATH } from '../config/constants';
import { validate } from '../middleware/validate';
import {
  approveSchema,
  buyItemSchema,
  claimRewardSchema,
  collectDecorationSchema,
  commandSchema,
  equipTitleSchema,
  gameStateMutationSchema,
  moveBuildingSchema,
  moveDecorationSchema,
  placeDecorationSchema,
  purchaseDecorationSchema,
  townPatchSchema,
  updateEconomySchema,
  useItemSchema,
  upgradeBuildingSchema,
  upgradeDecorationSchema,
} from '../schemas/api';
import type { ServerReportUpdatePayload, ServerTaskUpdatePayload } from '../types';
import { checkAchievements, checkTitles } from '../../src/lib/gamification/achievement-system';
import { readYamlFile } from '../yaml-parser';
import { sendTmuxMessage } from '../tmux-bridge';

type LooseRecord = Record<string, unknown>;
type WorkerId = `ashigaru${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
type CommanderId = 'shogun' | 'karo';
type AgentId = WorkerId | CommanderId;

interface ArchivedCommandSummary {
  id: string;
  command: string;
  status: string;
  completed_at: string | null;
  note: string | null;
}

interface AgentCurrentTask {
  taskId: string | null;
  status: string | null;
  category: string | null;
  description: string | null;
  timestamp: string | null;
}

interface AgentHistoryEntry {
  id: string;
  timestamp: string;
  status: string;
  message: string;
  taskId: string | null;
  parentCmd: string | null;
  source: 'report' | 'command' | 'note';
}

interface ContextStat extends LooseRecord {
  capturedAt?: string;
}

interface RenameAgentPayload {
  agentId: AgentId;
  name: string;
}

interface UseItemPayload {
  itemId: string;
}

interface BuyItemPayload {
  itemId: string;
  quantity: number;
}

interface UpgradeBuildingPayload {
  buildingId: BuildingType;
  newLevel?: BuildingLevel;
}

interface UpgradeCostQueryPayload {
  buildingId: BuildingType;
  currentLevel: BuildingLevel;
}

interface PurchaseDecorationPayload {
  decorationId: string;
  position: { x: number; y: number };
}

interface CollectDecorationPayload {
  decorationId: string;
}

interface UpgradeDecorationPayload {
  decorationId: string;
}

interface MoveDecorationPayload {
  decorationId: string;
  position: { x: number; y: number };
}

interface MoveBuildingPayload {
  buildingId: BuildingType;
  position: { x: number; y: number };
}

interface PlaceDecorationPayload {
  decorationType: string;
  position: { x: number; y: number };
}

interface BuildingState {
  type: BuildingType;
  level: BuildingLevel;
}

interface UpgradeMaterialCost {
  itemId: string;
  quantity: number;
}

interface UpgradeMaterialMissing {
  id: string;
  required: number;
  have: number;
}

interface UpgradeCost {
  buildingId: BuildingType;
  fromLevel: 1 | 2 | 3 | 4;
  toLevel: BuildingLevel;
  gold: number;
  materials: UpgradeMaterialCost[];
}

interface FormattedUpgradeCost {
  buildingId: BuildingType;
  fromLevel: number;
  toLevel: BuildingLevel;
  gold: number;
  materials: Array<{ id: string; name: string; quantity: number }>;
}

interface BuildingProductionProfile extends LooseRecord {
  taskCategories: string[];
  rewardGoldPerMinute: number;
  rewardXpPerMinute: number;
  materialDropCountPerCompletion: number;
}

interface PositiveIntegerQueryOptions {
  min?: number;
  max?: number;
}

type GameStateMutationCallback<T> = (
  currentState: LooseRecord
) =>
  | Promise<{ nextState: LooseRecord | null; result: T }>
  | { nextState: LooseRecord | null; result: T };

interface GameStateService {
  readGameState: () => Promise<unknown>;
  getInitialStateCached: () => Promise<unknown>;
  readContextStats: () => Promise<ContextStat[]>;
  getTaskSnapshotsCached: () => Promise<LooseRecord[]>;
  getReportSnapshotsCached: () => Promise<LooseRecord[]>;
  getCommandTitleByIdMapCached: () => Promise<Map<string, string>>;
  toTaskPayload: (
    entry: LooseRecord,
    commandTitleById: ReadonlyMap<string, string>
  ) => ServerTaskUpdatePayload | null;
  toReportPayload: (entry: LooseRecord) => ServerReportUpdatePayload | null;
  persistDerivedGameStateIfNeeded: (
    rawGameState: unknown,
    missions: GameState['missions']
  ) => Promise<void>;
  readArchivedCommands: () => Promise<unknown[]>;
  readCommands: () => Promise<unknown[]>;
  queueGameStateMutation: <T>(mutate: GameStateMutationCallback<T>) => Promise<T>;
}

interface GameLogicService {
  toGameState: (
    rawGameState: unknown,
    tasks: ServerTaskUpdatePayload[],
    reports: ServerReportUpdatePayload[],
    taskSnapshots: LooseRecord[],
    reportSnapshots: LooseRecord[]
  ) => GameState;
  getDefaultGameState: () => GameState;
  normalizeTownFromState: (state: unknown) => { level: number; xp: number; gold: number };
  normalizeTown: (
    state: unknown,
    fallbackGold: number
  ) => { level: number; xp: number; gold: number };
  normalizeInventory: (value: unknown, fallback: InventoryItem[]) => InventoryItem[];
  getDefaultInventory: () => InventoryItem[];
  toInventoryMap: (inventory: InventoryItem[]) => Map<string, InventoryItem>;
  collectMissingUpgradeMaterials: (
    inventoryMap: Map<string, InventoryItem>,
    materials: UpgradeMaterialCost[]
  ) => UpgradeMaterialMissing[];
  formatUpgradeCost: (cost: UpgradeCost) => FormattedUpgradeCost;
  resolveUpgradeCost: (buildingId: BuildingType, currentLevel: BuildingLevel) => UpgradeCost | null;
  resolveGameStateFromBody: (currentState: LooseRecord, body: unknown) => LooseRecord | null;
  asString: (value: unknown) => string | null;
  isRecord: (value: unknown) => value is LooseRecord;
  toSafeInt: (value: unknown) => number;
  applyMissionRewardToTown: (
    currentTown: unknown,
    rewardXp: number,
    rewardGold: number
  ) => { level: number; xp: number; gold: number };
  normalizeEconomyPatch: (payload: unknown) => Partial<{ gold: number }> | null;
  normalizeTownPatch: (payload: unknown) => Partial<{ xp: number; gold: number }> | null;
  normalizeUseItemPayload: (payload: unknown) => UseItemPayload | null;
  inventoryFromMap: (inventoryMap: Map<string, InventoryItem>) => InventoryItem[];
  normalizeBuildings: (value: unknown) => GameState['buildings'];
  normalizeBuildingLevel: (value: number) => BuildingLevel;
  normalizeBuyItemPayload: (payload: unknown) => BuyItemPayload | null;
  normalizeUpgradeBuildingPayload: (payload: unknown) => UpgradeBuildingPayload | null;
  isUpgradeCostBuildingType: (value: unknown) => value is BuildingType;
  findBuildingLevel: (buildings: GameState['buildings'], buildingId: BuildingType) => BuildingLevel;
  applyUpgradeMaterialCost: (
    inventoryMap: Map<string, InventoryItem>,
    materials: UpgradeMaterialCost[]
  ) => void;
  toBuildingState: (buildingId: BuildingType, level: BuildingLevel) => BuildingState;
  resolveBuildingProductionProfile: (
    buildingId: BuildingType,
    level: BuildingLevel
  ) => BuildingProductionProfile;
  normalizePurchaseDecorationPayload: (payload: unknown) => PurchaseDecorationPayload | null;
  clampDecorationPosition: (position: { x: number; y: number }) => { x: number; y: number };
  resolveDecorationCost: (decorationId: string) => number | null;
  normalizeDecorationsForState: (
    value: unknown,
    buildings: GameState['buildings']
  ) => GameState['decorations'];
  createBuildingOccupiedTiles: (buildings: GameState['buildings']) => Set<string>;
  toDecorationTileKey: (x: number, y: number) => string;
  normalizeRenameAgentPayload: (payload: unknown) => RenameAgentPayload | null;
  normalizeUpgradeCostQueryPayload: (query: unknown) => UpgradeCostQueryPayload | null;
  appendActivityLog: (
    activityLog: unknown,
    ...entries: Array<ActivityLogEntry | null>
  ) => ActivityLogEntry[];
  createActivityLogEntry: (
    entry: Omit<ActivityLogEntry, 'id'> & { id?: string }
  ) => ActivityLogEntry;
  resolveBuildingLabel: (buildingType: unknown) => string;
}

export interface ApiRoutesDependencies {
  gameStateService: GameStateService;
  gameLogicService: GameLogicService;
  broadcast: (type: string, payload: unknown) => void;
  normalizeAgentId: (value: unknown) => AgentId | null;
  normalizeCommanderId: (value: unknown) => CommanderId | null;
  resolveAgentDisplayName: (rawState: unknown, agentId: AgentId) => string;
  normalizeWorkerId: (value: unknown) => WorkerId | null;
  parseTaskSnapshot: (snapshot: unknown) => AgentCurrentTask | null;
  parseReportHistoryEntries: (snapshot: unknown, workerId: WorkerId) => AgentHistoryEntry[];
  parseCommanderHistoryEntries: (
    commands: unknown[],
    commanderId: CommanderId
  ) => AgentHistoryEntry[];
  sortHistoryEntries: (entries: AgentHistoryEntry[]) => AgentHistoryEntry[];
  parsePositiveIntegerQuery: (
    value: unknown,
    fallback: number,
    options?: PositiveIntegerQueryOptions
  ) => number;
  toArchivedCommandSummary: (command: unknown) => ArchivedCommandSummary | null;
  sortArchivedCommandsByIdDesc: (
    left: ArchivedCommandSummary,
    right: ArchivedCommandSummary
  ) => number;
  getCommanderNamesFromState: (rawState: unknown) => Record<CommanderId, string>;
  TASKS_DIR: string;
  REPORTS_DIR: string;
  SHOGUN_TARGET_PANE: string;
  VITE_DEV_HOST: string;
  VITE_DEV_PORT: number;
  ITEM_MASTER: ItemDefinition[];
  ITEM_MASTER_BY_ID: Map<string, ItemDefinition>;
  DEFAULT_BUILDING_POSITIONS: Record<BuildingType, { x: number; y: number }>;
}

interface ArchiveCommandsCache {
  sourceMtimeMs: number | null;
  summaries: ArchivedCommandSummary[];
}

const archiveCommandsCache: ArchiveCommandsCache = {
  sourceMtimeMs: null,
  summaries: [],
};

interface ApiMutationResult {
  statusCode: number;
  responseBody: LooseRecord;
  broadcastState: LooseRecord | null;
}

const BUILDING_MAP_WIDTH = 16;
const BUILDING_MAP_HEIGHT = 16;
const UPGRADE_COST_LEVELS: ReadonlyArray<BuildingLevel> = [1, 2, 3, 4];

function asErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  return error instanceof Error ? error.message : fallback;
}

function normalizeEquippedTitle(
  rawEquippedTitle: unknown,
  titles: readonly GameState['titles'][number][]
): string | null {
  const equippedTitle = typeof rawEquippedTitle === 'string' ? rawEquippedTitle.trim() : null;
  if (equippedTitle === null || equippedTitle.length < 1) {
    return null;
  }

  const unlockedTitleIds = new Set(
    titles
      .filter((title) => typeof title.unlockedAt === 'string' && title.unlockedAt.trim().length > 0)
      .map((title) => title.id)
  );

  return unlockedTitleIds.has(equippedTitle) ? equippedTitle : null;
}

function parseNonNegativeIntegerQuery(
  value: unknown,
  fallback: number,
  options?: { max?: number }
): number {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed =
    typeof candidate === 'string'
      ? Number.parseInt(candidate, 10)
      : typeof candidate === 'number'
        ? Math.floor(candidate)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  const max = options?.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(parsed, max);
}

async function readArchiveFileMtimeMs(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(filePath);
    return Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : null;
  } catch (error) {
    const normalizedError = error as NodeJS.ErrnoException;
    if (normalizedError.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function registerApiRoutes(app: express.Express, deps: ApiRoutesDependencies): void {
  const {
    gameStateService,
    gameLogicService,
    broadcast,
    normalizeAgentId,
    normalizeCommanderId,
    resolveAgentDisplayName,
    normalizeWorkerId,
    parseTaskSnapshot,
    parseReportHistoryEntries,
    parseCommanderHistoryEntries,
    sortHistoryEntries,
    parsePositiveIntegerQuery,
    toArchivedCommandSummary,
    sortArchivedCommandsByIdDesc,
    getCommanderNamesFromState,
    TASKS_DIR,
    REPORTS_DIR,
    SHOGUN_TARGET_PANE,
    VITE_DEV_HOST,
    VITE_DEV_PORT,
    ITEM_MASTER,
    ITEM_MASTER_BY_ID,
    DEFAULT_BUILDING_POSITIONS,
  } = deps;

  const {
    readGameState,
    getInitialStateCached,
    readContextStats,
    getTaskSnapshotsCached,
    getReportSnapshotsCached,
    getCommandTitleByIdMapCached,
    toTaskPayload,
    toReportPayload,
    persistDerivedGameStateIfNeeded,
    readArchivedCommands,
    readCommands,
    queueGameStateMutation,
  } = gameStateService;

  const {
    toGameState,
    getDefaultGameState,
    normalizeTownFromState,
    normalizeTown,
    normalizeInventory,
    getDefaultInventory,
    toInventoryMap,
    collectMissingUpgradeMaterials,
    formatUpgradeCost,
    resolveUpgradeCost,
    resolveGameStateFromBody,
    asString,
    isRecord,
    toSafeInt,
    applyMissionRewardToTown,
    normalizeEconomyPatch,
    normalizeTownPatch,
    normalizeUseItemPayload,
    inventoryFromMap,
    normalizeBuildings,
    normalizeBuyItemPayload,
    normalizeUpgradeBuildingPayload,
    isUpgradeCostBuildingType,
    findBuildingLevel,
    applyUpgradeMaterialCost,
    toBuildingState,
    resolveBuildingProductionProfile,
    normalizePurchaseDecorationPayload,
    clampDecorationPosition,
    resolveDecorationCost,
    normalizeDecorationsForState,
    createBuildingOccupiedTiles,
    toDecorationTileKey,
    normalizeRenameAgentPayload,
    normalizeUpgradeCostQueryPayload,
    appendActivityLog,
    createActivityLogEntry,
    resolveBuildingLabel,
  } = gameLogicService;

  const systemRouter = express.Router();
  const agentRouter = express.Router();
  const townRouter = express.Router();
  const itemRouter = express.Router();
  const buildingRouter = express.Router();
  const commandRouter = express.Router();
  const proxyRouter = express.Router();
  const DECORATION_PASSIVE_EFFECT_BY_ITEM_ID: Readonly<
    Record<string, NonNullable<GameState['decorations'][number]['passiveEffect']>>
  > = {
    maneki_neko: {
      type: 'gold_bonus',
      bonusPerLevel: 0.05,
    },
    komainu: {
      type: 'xp_bonus',
      bonusPerLevel: 0.05,
    },
    stone_lantern: {
      type: 'drop_rate_bonus',
      bonusPerLevel: 0.05,
    },
    ishidoro: {
      type: 'drop_rate_bonus',
      bonusPerLevel: 0.05,
    },
  };
  const DECORATION_UPGRADE_COSTS_BY_ITEM_ID = new Map<string, number[]>(
    ITEM_MASTER.filter((item) => item.itemType === 'decoration' && Array.isArray(item.upgradeCosts))
      .map(
        (item): [string, number[]] => [
          item.id,
          (item.upgradeCosts ?? [])
            .map((cost) => (Number.isFinite(cost) ? Math.max(0, Math.floor(cost)) : null))
            .filter((cost): cost is number => cost !== null),
        ]
      )
      .filter((entry) => entry[1].length > 0)
  );

  const buildUpgradeCostCatalog = (): FormattedUpgradeCost[] => {
    const catalog: FormattedUpgradeCost[] = [];
    const buildingTypes = Object.keys(DEFAULT_BUILDING_POSITIONS) as BuildingType[];

    for (const buildingId of buildingTypes) {
      for (const level of UPGRADE_COST_LEVELS) {
        const cost = resolveUpgradeCost(buildingId, level);
        if (cost !== null) {
          catalog.push(formatUpgradeCost(cost));
        }
      }
    }

    return catalog;
  };

  const buildGameStatePayload = async (): Promise<{
    rawGameState: unknown;
    gameState: GameState;
  }> => {
    const rawGameState = await readGameState();
    const gameState = await buildDerivedGameStateFromRawState(rawGameState);
    return {
      rawGameState,
      gameState,
    };
  };

  const buildDerivedGameStateFromRawState = async (rawGameState: unknown): Promise<GameState> => {
    const [taskSnapshots, reportSnapshots, commandTitleById] = await Promise.all([
      getTaskSnapshotsCached(),
      getReportSnapshotsCached(),
      getCommandTitleByIdMapCached(),
    ]);
    const tasks = taskSnapshots
      .map((entry) => toTaskPayload(entry, commandTitleById))
      .filter((task): task is ServerTaskUpdatePayload => task !== null);
    const reports = reportSnapshots
      .map(toReportPayload)
      .filter((report): report is ServerReportUpdatePayload => report !== null);
    return toGameState(rawGameState, tasks, reports, taskSnapshots, reportSnapshots);
  };

  const syncEconomyWithTownInPlace = (state: LooseRecord): void => {
    const town = normalizeTownFromState(state);
    const economy = isRecord(state.economy) ? state.economy : {};
    state.economy = {
      ...economy,
      gold: town.gold,
    };
  };

  const normalizeCollectDecorationPayload = (payload: unknown): CollectDecorationPayload | null => {
    if (!isRecord(payload)) {
      return null;
    }

    const decorationId = asString(payload.decorationId);
    if (decorationId === null) {
      return null;
    }

    return { decorationId };
  };

  const normalizeUpgradeDecorationPayload = (payload: unknown): UpgradeDecorationPayload | null => {
    if (!isRecord(payload)) {
      return null;
    }

    const decorationId = asString(payload.decorationId);
    if (decorationId === null) {
      return null;
    }

    return { decorationId };
  };

  const normalizeMoveDecorationPayload = (payload: unknown): MoveDecorationPayload | null => {
    if (!isRecord(payload)) {
      return null;
    }

    const decorationId = asString(payload.decorationId);
    const position = isRecord(payload.position)
      ? clampDecorationPosition({
          x: toSafeInt(payload.position.x),
          y: toSafeInt(payload.position.y),
        })
      : null;
    if (decorationId === null || position === null) {
      return null;
    }

    return {
      decorationId,
      position,
    };
  };

  const isSupportedBuildingType = (value: string): value is BuildingType =>
    Object.prototype.hasOwnProperty.call(BUILDING_CONFIGS, value);

  const clampBuildingMovePosition = (
    position: { x: number; y: number },
    footprint: { width: number; height: number }
  ): { x: number; y: number } => {
    const maxX = Math.max(0, BUILDING_MAP_WIDTH - footprint.width);
    const maxY = Math.max(0, BUILDING_MAP_HEIGHT - footprint.height);
    return {
      x: Math.min(Math.max(Math.floor(position.x), 0), maxX),
      y: Math.min(Math.max(Math.floor(position.y), 0), maxY),
    };
  };

  const normalizeMoveBuildingPayload = (payload: unknown): MoveBuildingPayload | null => {
    if (!isRecord(payload)) {
      return null;
    }

    const buildingIdRaw = asString(payload.buildingId);
    if (buildingIdRaw === null || !isSupportedBuildingType(buildingIdRaw)) {
      return null;
    }

    const footprint = BUILDING_CONFIGS[buildingIdRaw].footprint;
    const position = isRecord(payload.position)
      ? clampBuildingMovePosition(
          {
            x: toSafeInt(payload.position.x),
            y: toSafeInt(payload.position.y),
          },
          footprint
        )
      : null;
    if (position === null) {
      return null;
    }

    return {
      buildingId: buildingIdRaw,
      position,
    };
  };

  const normalizePlaceDecorationPayload = (payload: unknown): PlaceDecorationPayload | null => {
    if (!isRecord(payload)) {
      return null;
    }

    const decorationType = asString(payload.decorationType);
    const position = isRecord(payload.position)
      ? clampDecorationPosition({
          x: toSafeInt(payload.position.x),
          y: toSafeInt(payload.position.y),
        })
      : null;
    if (decorationType === null || position === null) {
      return null;
    }

    return {
      decorationType,
      position,
    };
  };

  const hasDecorationPosition = (
    decoration: GameState['decorations'][number]
  ): decoration is GameState['decorations'][number] & { position: { x: number; y: number } } =>
    typeof decoration.position?.x === 'number' &&
    Number.isFinite(decoration.position.x) &&
    typeof decoration.position?.y === 'number' &&
    Number.isFinite(decoration.position.y);

  const getArchivedCommandSummariesCached = async (): Promise<ArchivedCommandSummary[]> => {
    const sourceMtimeMs = await readArchiveFileMtimeMs(COMMAND_ARCHIVE_FILE_PATH);

    if (sourceMtimeMs === null) {
      archiveCommandsCache.sourceMtimeMs = null;
      archiveCommandsCache.summaries = [];
      return archiveCommandsCache.summaries;
    }

    if (archiveCommandsCache.sourceMtimeMs === sourceMtimeMs) {
      return archiveCommandsCache.summaries;
    }

    const archivedCommands = await readArchivedCommands();
    archiveCommandsCache.summaries = archivedCommands
      .map(toArchivedCommandSummary)
      .filter((entry): entry is ArchivedCommandSummary => entry !== null)
      .sort(sortArchivedCommandsByIdDesc);
    archiveCommandsCache.sourceMtimeMs = sourceMtimeMs;
    return archiveCommandsCache.summaries;
  };

  const normalizeResponseMeta = (meta: unknown): LooseRecord | null => {
    if (!isRecord(meta)) {
      return null;
    }

    return Object.keys(meta).length > 0 ? meta : null;
  };

  const resolveErrorMessage = (error: unknown, fallback = 'Unknown error'): string => {
    const directError = asString(error);
    if (directError !== null) {
      return directError;
    }

    if (isRecord(error)) {
      const nestedMessage = asString(error.message);
      if (nestedMessage !== null) {
        return nestedMessage;
      }
    }

    return asErrorMessage(error, fallback);
  };

  const sendSuccessEnvelope = (
    res: express.Response,
    data: unknown,
    options?: {
      statusCode?: number;
      meta?: LooseRecord | null;
      legacy?: LooseRecord;
    }
  ): void => {
    const body: LooseRecord = {
      success: true,
      data,
    };

    if (options?.meta !== null && options?.meta !== undefined && Object.keys(options.meta).length > 0) {
      body.meta = options.meta;
    }

    if (options?.legacy !== undefined) {
      for (const [key, value] of Object.entries(options.legacy)) {
        if (key === 'success' || key === 'data' || key === 'meta' || key === 'error') {
          continue;
        }

        body[key] = value;
      }
    }

    res.status(options?.statusCode ?? 200).json(body);
  };

  const sendErrorEnvelope = (
    res: express.Response,
    statusCode: number,
    error: unknown,
    options?: {
      meta?: LooseRecord | null;
      details?: LooseRecord;
      fallback?: string;
    }
  ): void => {
    const body: LooseRecord = {
      success: false,
      error: resolveErrorMessage(error, options?.fallback),
    };

    if (options?.meta !== null && options?.meta !== undefined && Object.keys(options.meta).length > 0) {
      body.meta = options.meta;
    }

    if (options?.details !== undefined) {
      for (const [key, value] of Object.entries(options.details)) {
        if (key === 'success' || key === 'data' || key === 'error' || key === 'meta') {
          continue;
        }

        body[key] = value;
      }
    }

    res.status(statusCode).json(body);
  };

  const sendMutationEnvelope = (
    res: express.Response,
    statusCode: number,
    responseBody: LooseRecord
  ): void => {
    const { success, data, error, meta, ...rest } = responseBody;
    if (success === false) {
      sendErrorEnvelope(res, statusCode, error, {
        meta: normalizeResponseMeta(meta),
        details: rest,
      });
      return;
    }

    const envelopeData = data === undefined ? rest : data;
    sendSuccessEnvelope(res, envelopeData, {
      statusCode,
      meta: normalizeResponseMeta(meta),
      legacy: rest,
    });
  };

  systemRouter.get('/api/health', (_req, res) => {
    sendSuccessEnvelope(res, { ok: true }, { legacy: { ok: true } });
  });

  systemRouter.get('/api/state', async (_req, res) => {
    try {
      const state = await getInitialStateCached();
      sendSuccessEnvelope(res, { state }, { legacy: isRecord(state) ? state : undefined });
    } catch (error) {
      sendErrorEnvelope(res, 500, error, {
        meta: {
          errorCode: 'STATE_FETCH_FAILED',
          i18nKey: 'errors.system.state.fetch_failed',
        },
      });
    }
  });

  systemRouter.get('/api/context-stats', async (_req, res) => {
    try {
      const contextStats = await readContextStats();
      const payload = {
        workers: contextStats,
        updatedAt: contextStats[0]?.capturedAt ?? new Date().toISOString(),
      };
      sendSuccessEnvelope(res, payload, { legacy: payload });
    } catch (error) {
      sendErrorEnvelope(res, 500, error, {
        meta: {
          errorCode: 'CONTEXT_STATS_FETCH_FAILED',
          i18nKey: 'errors.system.context_stats.fetch_failed',
        },
      });
    }
  });

  townRouter.get('/api/game-state', async (_req, res) => {
    try {
      const { rawGameState, gameState } = await buildGameStatePayload();
      await persistDerivedGameStateIfNeeded(rawGameState, gameState.missions);
      sendSuccessEnvelope(
        res,
        {
          gameState,
        },
        {
          legacy: {
            gameState,
          },
        }
      );
    } catch (error) {
      sendErrorEnvelope(res, 500, error, {
        meta: {
          errorCode: 'GAME_STATE_FETCH_FAILED',
          i18nKey: 'errors.game_state.fetch_failed',
        },
      });
    }
  });

  systemRouter.get('/api/archive-commands', async (req, res) => {
    try {
      const limit = parsePositiveIntegerQuery(req.query.limit, 50, { min: 1, max: 100 });
      const page = parsePositiveIntegerQuery(req.query.page, 1, { min: 1 });
      const offset =
        req.query.offset === undefined
          ? (page - 1) * limit
          : parseNonNegativeIntegerQuery(req.query.offset, 0);
      const summaries = await getArchivedCommandSummariesCached();

      const total = summaries.length;
      const commands = offset >= total ? [] : summaries.slice(offset, offset + limit);
      const resolvedPage = Math.floor(offset / limit) + 1;

      const payload = {
        commands,
        total,
        page: resolvedPage,
        limit,
        offset,
      };
      sendSuccessEnvelope(res, payload, { legacy: payload });
    } catch (error) {
      sendErrorEnvelope(res, 500, error, {
        meta: {
          errorCode: 'ARCHIVE_COMMANDS_FETCH_FAILED',
          i18nKey: 'errors.archive_commands.fetch_failed',
        },
      });
    }
  });

  agentRouter.get('/api/agent-history/:agentId', async (req, res) => {
    const agentId = normalizeAgentId(req.params.agentId);
    if (agentId === null) {
      sendErrorEnvelope(res, 400, 'agentId must be one of shogun, karo, ashigaru1..ashigaru8.', {
        meta: {
          errorCode: 'AGENT_ID_INVALID',
          i18nKey: 'errors.agent.invalid_id',
        },
      });
      return;
    }

    try {
      const rawGameState = await readGameState();
      const displayName = resolveAgentDisplayName(rawGameState, agentId);

      let currentTask: AgentCurrentTask | null = null;
      let entries: AgentHistoryEntry[] = [];

      if (normalizeWorkerId(agentId) !== null) {
        const workerId = agentId as WorkerId;
        const [taskSnapshot, reportSnapshot] = await Promise.all([
          readYamlFile<LooseRecord>(path.join(TASKS_DIR, `${workerId}.yaml`)),
          readYamlFile<LooseRecord>(path.join(REPORTS_DIR, `${workerId}_report.yaml`)),
        ]);
        currentTask = parseTaskSnapshot(taskSnapshot.data);
        entries = parseReportHistoryEntries(reportSnapshot.data, workerId);
      } else {
        const commands = await readCommands();
        entries = parseCommanderHistoryEntries(commands, agentId as CommanderId);
      }

      const payload = {
        agentId,
        displayName,
        currentTask,
        entries: sortHistoryEntries(entries),
      };
      sendSuccessEnvelope(res, payload, { legacy: payload });
    } catch (error) {
      sendErrorEnvelope(res, 500, error, {
        meta: {
          errorCode: 'AGENT_HISTORY_FETCH_FAILED',
          i18nKey: 'errors.agent.history.fetch_failed',
        },
      });
    }
  });

  agentRouter.post('/api/rename-agent', async (req, res) => {
    const payload = normalizeRenameAgentPayload(req.body);
    if (payload === null) {
      res.status(400).json({
        success: false,
        error: 'Request body must include valid agentId and name.',
      });
      return;
    }

    try {
      const mutationResult = await queueGameStateMutation<ApiMutationResult>(
        async (currentState) => {
          const workerId = normalizeWorkerId(payload.agentId);
          if (workerId !== null) {
            const ashigaru = Array.isArray(currentState.ashigaru) ? currentState.ashigaru : [];
            let found = false;
            const nextAshigaru = ashigaru.map((entry) => {
              if (!isRecord(entry) || normalizeWorkerId(entry.id) !== workerId) {
                return entry;
              }
              found = true;
              return {
                ...entry,
                name: payload.name,
              };
            });

            if (!found) {
              return {
                nextState: null,
                result: {
                  statusCode: 404,
                  responseBody: {
                    success: false,
                    error: `Agent not found: ${payload.agentId}`,
                  },
                  broadcastState: null,
                },
              };
            }

            const nextState: LooseRecord = {
              ...currentState,
              ashigaru: nextAshigaru,
            };

            return {
              nextState,
              result: {
                statusCode: 200,
                responseBody: {
                  success: true,
                  agentId: payload.agentId,
                  name: payload.name,
                  gameState: nextState,
                },
                broadcastState: nextState,
              },
            };
          }

          const commanderId = normalizeCommanderId(payload.agentId);
          if (commanderId === null) {
            return {
              nextState: null,
              result: {
                statusCode: 400,
                responseBody: {
                  success: false,
                  error: `Unsupported agent: ${payload.agentId}`,
                },
                broadcastState: null,
              },
            };
          }

          const commanderNames = getCommanderNamesFromState(currentState);
          const nextState: LooseRecord = {
            ...currentState,
            commanderNames: {
              ...commanderNames,
              [commanderId]: payload.name,
            },
          };

          return {
            nextState,
            result: {
              statusCode: 200,
              responseBody: {
                success: true,
                agentId: payload.agentId,
                name: payload.name,
                gameState: nextState,
              },
              broadcastState: nextState,
            },
          };
        }
      );

      if (mutationResult.broadcastState !== null) {
        broadcast('game_state_update', mutationResult.broadcastState);
      }

      sendMutationEnvelope(res, mutationResult.statusCode, mutationResult.responseBody);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: asErrorMessage(error),
      });
    }
  });

  itemRouter.get('/api/items', async (_req, res) => {
    try {
      const { rawGameState, gameState } = await buildGameStatePayload();
      await persistDerivedGameStateIfNeeded(rawGameState, gameState.missions);

      const payload = {
        items: ITEM_MASTER,
        upgradeCosts: buildUpgradeCostCatalog(),
        inventory: gameState.inventory,
        gameState,
      };
      sendSuccessEnvelope(res, payload, { legacy: payload });
    } catch (error) {
      sendErrorEnvelope(res, 500, error, {
        meta: {
          errorCode: 'ITEMS_FETCH_FAILED',
          i18nKey: 'errors.items.fetch_failed',
        },
      });
    }
  });

  buildingRouter.get('/api/upgrade-cost', async (req, res) => {
    const payload = normalizeUpgradeCostQueryPayload(req.query);
    if (payload === null) {
      sendErrorEnvelope(res, 400, 'buildingId and currentLevel are required.', {
        meta: {
          errorCode: 'BUILDING_UPGRADE_COST_INVALID_QUERY',
          i18nKey: 'errors.building.upgrade_cost.invalid_query',
        },
      });
      return;
    }

    const cost = resolveUpgradeCost(payload.buildingId, payload.currentLevel);
    if (cost === null) {
      sendErrorEnvelope(res, 404, '指定レベルからの改築コストは定義されておらぬ。', {
        meta: {
          errorCode: 'BUILDING_UPGRADE_COST_NOT_FOUND',
          i18nKey: 'errors.building.upgrade_cost.not_found',
        },
      });
      return;
    }

    try {
      const rawGameState = await readGameState();
      const state: LooseRecord = isRecord(rawGameState) ? rawGameState : { ...getDefaultGameState() };
      const town = normalizeTownFromState(state);
      const inventory = normalizeInventory(state.inventory, getDefaultInventory());
      const inventoryMap = toInventoryMap(inventory);
      const missingMaterials = collectMissingUpgradeMaterials(inventoryMap, cost.materials).map(
        (material) => ({
          ...material,
          name: ITEM_MASTER_BY_ID.get(material.id)?.name ?? material.id,
        })
      );
      const missingGold = Math.max(0, cost.gold - town.gold);

      const payloadBody = {
        cost: formatUpgradeCost(cost),
        affordability: {
          requiredGold: cost.gold,
          haveGold: town.gold,
          missingGold,
          missingMaterials,
        },
      };
      sendSuccessEnvelope(res, payloadBody, { legacy: payloadBody });
    } catch (error) {
      sendErrorEnvelope(res, 500, error, {
        meta: {
          errorCode: 'BUILDING_UPGRADE_COST_FETCH_FAILED',
          i18nKey: 'errors.building.upgrade_cost.fetch_failed',
        },
      });
    }
  });

  townRouter.post('/api/game-state', validate(gameStateMutationSchema), async (req, res) => {
    try {
      const mutationResult = await queueGameStateMutation<ApiMutationResult>(
        async (currentState) => {
          const nextState = resolveGameStateFromBody(currentState, req.body);
          if (nextState === null) {
            return {
              nextState: null,
              result: {
                statusCode: 400,
                responseBody: {
                  success: false,
                  error: 'Request body must be an object or { state: object }.',
                },
                broadcastState: null,
              },
            };
          }

          return {
            nextState,
            result: {
              statusCode: 200,
              responseBody: {
                success: true,
                data: nextState,
              },
              broadcastState: nextState,
            },
          };
        }
      );

      if (mutationResult.broadcastState !== null) {
        broadcast('game_state_update', mutationResult.broadcastState);
      }

      sendMutationEnvelope(res, mutationResult.statusCode, mutationResult.responseBody);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: asErrorMessage(error),
      });
    }
  });

  itemRouter.post('/api/claim-reward', validate(claimRewardSchema), async (req, res) => {
    const missionId = asString(req.body?.missionId);
    if (missionId === null) {
      res.status(400).json({
        success: false,
        error: 'missionId is required.',
      });
      return;
    }

    try {
      const mutationResult = await queueGameStateMutation<ApiMutationResult>(
        async (currentState) => {
          const missions = Array.isArray(currentState.missions) ? currentState.missions : [];
          const missionIndex = missions.findIndex(
            (mission) => isRecord(mission) && asString(mission.id) === missionId
          );

          if (missionIndex < 0) {
            return {
              nextState: null,
              result: {
                statusCode: 404,
                responseBody: {
                  success: false,
                  error: `Mission not found: ${missionId}`,
                },
                broadcastState: null,
              },
            };
          }

          const mission = missions[missionIndex];
          if (!isRecord(mission)) {
            return {
              nextState: null,
              result: {
                statusCode: 500,
                responseBody: {
                  success: false,
                  error: 'Mission payload is invalid.',
                },
                broadcastState: null,
              },
            };
          }

          if (mission.claimed === true) {
            return {
              nextState: null,
              result: {
                statusCode: 409,
                responseBody: {
                  success: false,
                  error: 'Reward already claimed.',
                },
                broadcastState: null,
              },
            };
          }

          const progress = isRecord(mission.progress) ? mission.progress : {};
          const progressCurrent = toSafeInt(progress.current);
          const progressTarget = toSafeInt(progress.target);

          if (progressTarget <= 0 || progressCurrent < progressTarget) {
            return {
              nextState: null,
              result: {
                statusCode: 400,
                responseBody: {
                  success: false,
                  error: 'Mission is not complete yet.',
                },
                broadcastState: null,
              },
            };
          }

          const reward = isRecord(mission.reward) ? mission.reward : {};
          const rewardGold = toSafeInt(reward.gold);
          const rewardXp = toSafeInt(reward.xp);
          const missionTitle = asString(mission.title) ?? missionId;
          const rewardSummaryParts: string[] = [];
          if (rewardGold > 0) {
            rewardSummaryParts.push(`+${rewardGold}G`);
          }
          if (rewardXp > 0) {
            rewardSummaryParts.push(`+${rewardXp}XP`);
          }
          const rewardSummary =
            rewardSummaryParts.length > 0 ? rewardSummaryParts.join(' / ') : '報酬なし';

          const nextMission = {
            ...mission,
            claimed: true,
          };
          const nextMissions = missions.map((current, index) =>
            index === missionIndex ? nextMission : current
          );
          const nextTown = applyMissionRewardToTown(currentState.town, rewardXp, rewardGold);

          const nextState: LooseRecord = {
            ...currentState,
            town: nextTown,
            missions: nextMissions,
            activityLog: appendActivityLog(
              currentState.activityLog,
              createActivityLogEntry({
                type: 'mission_complete',
                timestamp: new Date().toISOString(),
                ...(rewardGold !== 0 ? { gold: rewardGold } : {}),
                ...(rewardXp !== 0 ? { xp: rewardXp } : {}),
                message: `御触書「${missionTitle}」の報酬を受取。${rewardSummary}`,
              })
            ),
          };
          const derivedNextState = await buildDerivedGameStateFromRawState(nextState);
          const achievementCheckResult = checkAchievements(derivedNextState);
          const titleCheckResult = checkTitles({
            ...derivedNextState,
            achievements: achievementCheckResult.achievements,
          });
          const finalizedState: LooseRecord = {
            ...nextState,
            achievements: achievementCheckResult.achievements,
            titles: titleCheckResult.titles,
            equippedTitle: normalizeEquippedTitle(nextState.equippedTitle, titleCheckResult.titles),
          };

          return {
            nextState: finalizedState,
            result: {
              statusCode: 200,
              responseBody: {
                success: true,
                missionId,
                unlockedTitles: titleCheckResult.unlocked,
                gameState: finalizedState,
              },
              broadcastState: finalizedState,
            },
          };
        }
      );

      if (mutationResult.broadcastState !== null) {
        broadcast('game_state_update', mutationResult.broadcastState);
      }

      sendMutationEnvelope(res, mutationResult.statusCode, mutationResult.responseBody);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: asErrorMessage(error),
      });
    }
  });

  itemRouter.post('/api/equip-title', validate(equipTitleSchema), async (req, res) => {
    const hasTitleIdField =
      isRecord(req.body) && Object.prototype.hasOwnProperty.call(req.body, 'titleId');
    const clearRequested = req.body?.titleId === null;
    const titleId = asString(req.body?.titleId);

    if (!hasTitleIdField || (!clearRequested && titleId === null)) {
      res.status(400).json({
        success: false,
        error: 'titleId must be a non-empty string or null.',
      });
      return;
    }

    try {
      const mutationResult = await queueGameStateMutation<ApiMutationResult>(
        async (currentState) => {
          const derivedGameState = await buildDerivedGameStateFromRawState(currentState);
          const achievementCheckResult = checkAchievements(derivedGameState);
          const titleCheckResult = checkTitles({
            ...derivedGameState,
            achievements: achievementCheckResult.achievements,
          });
          const unlockedTitleIds = new Set(
            titleCheckResult.titles
              .filter((title) => typeof title.unlockedAt === 'string')
              .map((title) => title.id)
          );

          if (!clearRequested && titleId !== null && !unlockedTitleIds.has(titleId)) {
            return {
              nextState: null,
              result: {
                statusCode: 403,
                responseBody: {
                  success: false,
                  error: `Title is not unlocked: ${titleId}`,
                },
                broadcastState: null,
              },
            };
          }

          const nextEquippedTitle = clearRequested ? null : titleId;
          const currentEquippedTitle = asString(currentState.equippedTitle);
          const hasAchievementDiff =
            JSON.stringify(currentState.achievements ?? []) !==
            JSON.stringify(achievementCheckResult.achievements);
          const hasTitleDiff =
            JSON.stringify(currentState.titles ?? []) !== JSON.stringify(titleCheckResult.titles);
          const hasEquippedTitleDiff = (currentEquippedTitle ?? null) !== nextEquippedTitle;
          const shouldWrite = hasAchievementDiff || hasTitleDiff || hasEquippedTitleDiff;

          const nextState: LooseRecord = {
            ...currentState,
            achievements: achievementCheckResult.achievements,
            titles: titleCheckResult.titles,
            equippedTitle: nextEquippedTitle,
          };

          return {
            nextState: shouldWrite ? nextState : null,
            result: {
              statusCode: 200,
              responseBody: {
                success: true,
                equippedTitle: nextEquippedTitle,
                gameState: nextState,
              },
              broadcastState: shouldWrite ? nextState : null,
            },
          };
        }
      );

      if (mutationResult.broadcastState !== null) {
        broadcast('game_state_update', mutationResult.broadcastState);
      }

      sendMutationEnvelope(res, mutationResult.statusCode, mutationResult.responseBody);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: asErrorMessage(error),
      });
    }
  });

  townRouter.post('/api/update-economy', validate(updateEconomySchema), async (req, res) => {
    const economyPatch = normalizeEconomyPatch(req.body);
    if (economyPatch === null) {
      res.status(400).json({
        success: false,
        error: 'Request body must include: gold.',
      });
      return;
    }

    try {
      const gameState = await queueGameStateMutation(async (currentState) => {
        const currentTown = normalizeTownFromState(currentState);
        const nextTown = normalizeTown(
          {
            ...currentTown,
            ...economyPatch,
          },
          currentTown.gold
        );
        const nextState: LooseRecord = {
          ...currentState,
          town: nextTown,
        };
        syncEconomyWithTownInPlace(nextState);

        return {
          nextState,
          result: nextState,
        };
      });
      broadcast('game_state_update', gameState);

      const economy = {
        gold: normalizeTownFromState(gameState).gold,
      };

      const payload = {
        economy,
        gameState,
      };
      sendSuccessEnvelope(res, payload, { legacy: payload });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: asErrorMessage(error),
      });
    }
  });

  townRouter.post('/api/update-town', validate(townPatchSchema), async (req, res) => {
    const townPatch = normalizeTownPatch(req.body);
    if (townPatch === null) {
      res.status(400).json({
        success: false,
        error: 'Request body must include at least one of: xp, gold.',
      });
      return;
    }

    try {
      const gameState = await queueGameStateMutation(async (currentState) => {
        const currentTown = normalizeTownFromState(currentState);
        const nextTown = normalizeTown(
          {
            ...currentTown,
            ...townPatch,
          },
          currentTown.gold
        );

        const nextState: LooseRecord = {
          ...currentState,
          town: nextTown,
        };
        syncEconomyWithTownInPlace(nextState);

        return {
          nextState,
          result: nextState,
        };
      });
      broadcast('game_state_update', gameState);

      const town = normalizeTownFromState(gameState);
      const payload = {
        town,
        gameState,
      };
      sendSuccessEnvelope(res, payload, { legacy: payload });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: asErrorMessage(error),
      });
    }
  });

  itemRouter.post('/api/use-item', validate(useItemSchema), async (req, res) => {
    const payload = normalizeUseItemPayload(req.body);
    if (payload === null) {
      res.status(400).json({
        success: false,
        error: 'itemId is required.',
      });
      return;
    }

    try {
      const mutationResult = await queueGameStateMutation<ApiMutationResult>(
        async (currentState) => {
          const item = ITEM_MASTER_BY_ID.get(payload.itemId);
          if (item === undefined) {
            return {
              nextState: null,
              result: {
                statusCode: 404,
                responseBody: {
                  success: false,
                  error: `Item not found: ${payload.itemId}`,
                },
                broadcastState: null,
              },
            };
          }

          if (!item.usable) {
            return {
              nextState: null,
              result: {
                statusCode: 400,
                responseBody: {
                  success: false,
                  error: `${item.name}は使用できぬ。`,
                },
                broadcastState: null,
              },
            };
          }

          const currentTown = normalizeTownFromState(currentState);
          const currentInventory = normalizeInventory(
            currentState.inventory,
            getDefaultInventory()
          );
          const inventoryMap = toInventoryMap(currentInventory);
          const inventoryEntry = inventoryMap.get(item.id);

          if (inventoryEntry === undefined || inventoryEntry.quantity <= 0) {
            return {
              nextState: null,
              result: {
                statusCode: 403,
                responseBody: {
                  success: false,
                  error: `${item.name}の所持数が不足しておる。`,
                  meta: {
                    errorCode: 'ITEM_INVENTORY_INSUFFICIENT',
                    i18nKey: 'errors.item.inventory.insufficient',
                  },
                },
                broadcastState: null,
              },
            };
          }

          const nextState: LooseRecord = {
            ...currentState,
          };
          let message = `${item.name}を使用いたした。`;
          let gainedGold = 0;
          let gainedXp = 0;
          const upgradedBuildingType: BuildingType | null = null;
          const upgradedBuildingLevel: BuildingLevel | null = null;

          switch (item.effect.type) {
            case 'town_xp_boost': {
              const xpGain = Math.max(0, Math.floor(item.effect.value));
              nextState.town = applyMissionRewardToTown(currentTown, xpGain, 0);
              gainedXp = xpGain;
              message = `${item.name}を使用。城下町XP +${xpGain}`;
              break;
            }
            case 'town_gold_boost': {
              const goldGain = Math.max(0, Math.floor(item.effect.value));
              nextState.town = applyMissionRewardToTown(currentTown, 0, goldGain);
              gainedGold = goldGain;
              message = `${item.name}を使用。所持金 +${goldGain}G`;
              break;
            }
            case 'passive_bonus': {
              const bonus = Math.max(0, Math.floor(item.effect.value));
              const key = item.effect.key ?? 'passive_bonus';
              message = `${item.name}の所持効果(${key} +${bonus}%)が有効でござる。`;
              break;
            }
            default:
              break;
          }

          const nextQuantity = Math.max(0, inventoryEntry.quantity - 1);
          if (nextQuantity <= 0) {
            inventoryMap.delete(item.id);
          } else {
            inventoryMap.set(item.id, {
              ...inventoryEntry,
              quantity: nextQuantity,
            });
          }

          const nextInventory = inventoryFromMap(inventoryMap);
          nextState.inventory = nextInventory;
          nextState.activityLog = appendActivityLog(
            currentState.activityLog,
            createActivityLogEntry({
              type: 'item_consume',
              timestamp: new Date().toISOString(),
              ...(upgradedBuildingType !== null ? { buildingType: upgradedBuildingType } : {}),
              ...(upgradedBuildingLevel !== null ? { buildingLevel: upgradedBuildingLevel } : {}),
              ...(gainedGold !== 0 ? { gold: gainedGold } : {}),
              ...(gainedXp !== 0 ? { xp: gainedXp } : {}),
              items: [{ itemId: item.id, name: item.name, quantity: 1 }],
              message,
            })
          );

          return {
            nextState,
            result: {
              statusCode: 200,
              responseBody: {
                success: true,
                itemId: item.id,
                message,
                items: ITEM_MASTER,
                inventory: nextInventory,
                gameState: nextState,
              },
              broadcastState: nextState,
            },
          };
        }
      );

      if (mutationResult.broadcastState !== null) {
        broadcast('game_state_update', mutationResult.broadcastState);
      }

      sendMutationEnvelope(res, mutationResult.statusCode, mutationResult.responseBody);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: asErrorMessage(error),
      });
    }
  });

  itemRouter.post('/api/buy-item', validate(buyItemSchema), async (req, res) => {
    const payload = normalizeBuyItemPayload(req.body);
    if (payload === null) {
      res.status(400).json({
        success: false,
        error: 'itemId is required.',
      });
      return;
    }

    try {
      const mutationResult = await queueGameStateMutation<ApiMutationResult>(
        async (currentState) => {
          const item = ITEM_MASTER_BY_ID.get(payload.itemId);
          if (item === undefined) {
            return {
              nextState: null,
              result: {
                statusCode: 404,
                responseBody: {
                  success: false,
                  error: `Item not found: ${payload.itemId}`,
                },
                broadcastState: null,
              },
            };
          }

          if (item.purchasable === false) {
            return {
              nextState: null,
              result: {
                statusCode: 403,
                responseBody: {
                  success: false,
                  error: 'このアイテムは購入不可でござる',
                },
                broadcastState: null,
              },
            };
          }

          if (!item.stackable && payload.quantity > 1) {
            return {
              nextState: null,
              result: {
                statusCode: 400,
                responseBody: {
                  success: false,
                  error: `${item.name}は一度に1個のみ購入可能でござる。`,
                },
                broadcastState: null,
              },
            };
          }

          const currentTown = normalizeTownFromState(currentState);
          const totalCost = Math.max(0, Math.floor(item.shopCost)) * payload.quantity;

          if (currentTown.gold < totalCost) {
            return {
              nextState: null,
              result: {
                statusCode: 400,
                responseBody: {
                  success: false,
                  error: `ゴールド不足でござる。必要: ${totalCost}G`,
                },
                broadcastState: null,
              },
            };
          }

          const currentInventory = normalizeInventory(
            currentState.inventory,
            getDefaultInventory()
          );
          const inventoryMap = toInventoryMap(currentInventory);
          const existing = inventoryMap.get(item.id);
          const isDecorationPurchase = item.itemType === 'decoration';

          if (
            !isDecorationPurchase &&
            !item.stackable &&
            existing !== undefined &&
            existing.quantity > 0
          ) {
            return {
              nextState: null,
              result: {
                statusCode: 409,
                responseBody: {
                  success: false,
                  error: `${item.name}はすでに所持しておる。`,
                },
                broadcastState: null,
              },
            };
          }

          if (!isDecorationPurchase) {
            const nextQuantity = item.stackable ? (existing?.quantity ?? 0) + payload.quantity : 1;
            inventoryMap.set(item.id, {
              itemId: item.id,
              quantity: nextQuantity,
            });
          }

          const nextInventory = isDecorationPurchase
            ? currentInventory
            : inventoryFromMap(inventoryMap);
          const buildings = normalizeBuildings(currentState.buildings);
          const currentDecorations = normalizeDecorationsForState(
            currentState.decorations,
            buildings
          );
          const decorationPassiveEffect = DECORATION_PASSIVE_EFFECT_BY_ITEM_ID[item.id];
          const purchasedDecoration =
            isDecorationPurchase
              ? {
                  id: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  type: item.id,
                  level: 1,
                  ...(decorationPassiveEffect !== undefined
                    ? { passiveEffect: decorationPassiveEffect }
                    : {}),
                }
              : null;
          const nextDecorations =
            purchasedDecoration === null
              ? currentDecorations
              : [...currentDecorations, purchasedDecoration];
          const nextTown = normalizeTown(
            {
              ...currentTown,
              gold: currentTown.gold - totalCost,
            },
            currentTown.gold - totalCost
          );

          const nextState: LooseRecord = {
            ...currentState,
            town: nextTown,
            inventory: nextInventory,
            ...(purchasedDecoration !== null ? { decorations: nextDecorations } : {}),
            activityLog: appendActivityLog(
              currentState.activityLog,
              createActivityLogEntry({
                type: 'purchase',
                timestamp: new Date().toISOString(),
                gold: -totalCost,
                items: [{ itemId: item.id, name: item.name, quantity: payload.quantity }],
                message:
                  purchasedDecoration === null
                    ? `${item.name}を${payload.quantity}個購入。-${totalCost}G`
                    : `${item.name}を購入し未設置在庫へ追加。-${totalCost}G`,
              })
            ),
          };

          return {
            nextState,
            result: {
              statusCode: 200,
              responseBody: {
                success: true,
                itemId: item.id,
                quantity: payload.quantity,
                message:
                  purchasedDecoration === null
                    ? `${item.name}を購入。-${totalCost}G`
                    : `${item.name}を購入し未設置在庫へ追加。-${totalCost}G`,
                items: ITEM_MASTER,
                inventory: nextInventory,
                ...(purchasedDecoration !== null ? { decoration: purchasedDecoration } : {}),
                gameState: nextState,
              },
              broadcastState: nextState,
            },
          };
        }
      );

      if (mutationResult.broadcastState !== null) {
        broadcast('game_state_update', mutationResult.broadcastState);
      }

      sendMutationEnvelope(res, mutationResult.statusCode, mutationResult.responseBody);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: asErrorMessage(error),
      });
    }
  });

  buildingRouter.post(
    '/api/upgrade-building',
    validate(upgradeBuildingSchema),
    async (req, res) => {
      const payload = normalizeUpgradeBuildingPayload(req.body);
      if (payload === null) {
        res.status(400).json({
          success: false,
          error: 'Request body must include valid buildingId.',
        });
        return;
      }

      const requestedNewLevel =
        typeof req.body?.newLevel === 'number' && Number.isFinite(req.body.newLevel)
          ? (Math.max(1, Math.min(5, Math.floor(req.body.newLevel))) as BuildingLevel)
          : null;

      try {
        const mutationResult = await queueGameStateMutation<ApiMutationResult>(
          async (currentState) => {
            if (!isUpgradeCostBuildingType(payload.buildingId)) {
              return {
                nextState: null,
                result: {
                  statusCode: 400,
                  responseBody: {
                    success: false,
                    error: `${payload.buildingId} は改築対象外でござる。`,
                  },
                  broadcastState: null,
                },
              };
            }

            const buildings = normalizeBuildings(currentState.buildings);
            const currentLevel = findBuildingLevel(buildings, payload.buildingId);
            const cost = resolveUpgradeCost(payload.buildingId, currentLevel);
            if (cost === null) {
              return {
                nextState: null,
                result: {
                  statusCode: 400,
                  responseBody: {
                    success: false,
                    error: 'これ以上改築できぬ（最大Lv）でござる。',
                  },
                  broadcastState: null,
                },
              };
            }

            const currentTown = normalizeTownFromState(currentState);
            const currentInventory = normalizeInventory(
              currentState.inventory,
              getDefaultInventory()
            );
            const inventoryMap = toInventoryMap(currentInventory);
            const missingMaterials = collectMissingUpgradeMaterials(inventoryMap, cost.materials);
            const missingGold = Math.max(0, cost.gold - currentTown.gold);

            if (missingGold > 0 || missingMaterials.length > 0) {
              return {
                nextState: null,
                result: {
                  statusCode: 400,
                  responseBody: {
                    success: false,
                    error: missingMaterials.length > 0 ? '素材不足' : 'ゴールド不足',
                    missingGold,
                    requiredGold: cost.gold,
                    haveGold: currentTown.gold,
                    missing: missingMaterials.map((material) => ({
                      ...material,
                      name: ITEM_MASTER_BY_ID.get(material.id)?.name ?? material.id,
                    })),
                    cost,
                    costDetail: formatUpgradeCost(cost),
                  },
                  broadcastState: null,
                },
              };
            }

            applyUpgradeMaterialCost(inventoryMap, cost.materials);
            const nextInventory = inventoryFromMap(inventoryMap);
            const nextTown = normalizeTown(
              {
                ...currentTown,
                gold: currentTown.gold - cost.gold,
              },
              currentTown.gold - cost.gold
            );
            const targetIndex = buildings.findIndex(
              (building) => building.type === payload.buildingId
            );
            const nextBuildings =
              targetIndex >= 0
                ? buildings.map((building, index) =>
                    index === targetIndex
                      ? {
                          ...building,
                          level: cost.toLevel,
                        }
                      : building
                  )
                : normalizeBuildings([
                    ...buildings,
                    {
                      type: payload.buildingId,
                      level: cost.toLevel,
                      position: DEFAULT_BUILDING_POSITIONS[payload.buildingId],
                    },
                  ]);

            const nextState: LooseRecord = {
              ...currentState,
              town: nextTown,
              inventory: nextInventory,
              buildings: nextBuildings,
              activityLog: appendActivityLog(
                currentState.activityLog,
                createActivityLogEntry({
                  type: 'building_upgrade',
                  timestamp: new Date().toISOString(),
                  buildingType: payload.buildingId,
                  buildingLevel: cost.toLevel,
                  gold: -cost.gold,
                  items: cost.materials.map((material) => ({
                    itemId: material.itemId,
                    name: ITEM_MASTER_BY_ID.get(material.itemId)?.name ?? material.itemId,
                    quantity: material.quantity,
                  })),
                  message: `${resolveBuildingLabel(payload.buildingId)}をLv${cost.toLevel}へ改築。-${cost.gold}G`,
                })
              ),
            };

            return {
              nextState,
              result: {
                statusCode: 200,
                responseBody: {
                  success: true,
                  building: toBuildingState(payload.buildingId, cost.toLevel),
                  ...(requestedNewLevel !== null ? { requestedNewLevel } : {}),
                  cost,
                  costDetail: formatUpgradeCost(cost),
                  production: resolveBuildingProductionProfile(payload.buildingId, cost.toLevel),
                  town: nextTown,
                  inventory: nextInventory,
                  gameState: nextState,
                },
                broadcastState: nextState,
              },
            };
          }
        );

        if (mutationResult.broadcastState !== null) {
          broadcast('game_state_update', mutationResult.broadcastState);
        }

        sendMutationEnvelope(res, mutationResult.statusCode, mutationResult.responseBody);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: asErrorMessage(error),
        });
      }
    }
  );

  const handlePurchaseDecoration: express.RequestHandler = async (req, res) => {
    const payload = normalizePurchaseDecorationPayload(req.body);
    if (payload === null) {
      res.status(400).json({
        success: false,
        error: 'Request body must include valid decorationId and position.',
      });
      return;
    }

    const decorationId = `${payload.decorationId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const requestedPosition = clampDecorationPosition(payload.position);

    try {
      const mutationResult = await queueGameStateMutation<ApiMutationResult>(
        async (currentState) => {
          const decorationCost = resolveDecorationCost(payload.decorationId);
          if (decorationCost === null) {
            return {
              nextState: null,
              result: {
                statusCode: 404,
                responseBody: {
                  success: false,
                  error: `装飾の価格定義が見つからぬ: ${payload.decorationId}`,
                },
                broadcastState: null,
              },
            };
          }

          const currentTown = normalizeTownFromState(currentState);
          if (currentTown.gold < decorationCost) {
            return {
              nextState: null,
              result: {
                statusCode: 403,
                responseBody: {
                  success: false,
                  error: `軍資金不足でござる。必要: ${decorationCost}G`,
                  meta: {
                    errorCode: 'DECORATION_PURCHASE_INSUFFICIENT_GOLD',
                    i18nKey: 'errors.decoration.purchase.insufficient_gold',
                  },
                  requiredGold: decorationCost,
                  haveGold: currentTown.gold,
                  missingGold: decorationCost - currentTown.gold,
                },
                broadcastState: null,
              },
            };
          }

          const buildings = normalizeBuildings(currentState.buildings);
          const decorations = normalizeDecorationsForState(currentState.decorations, buildings);
          const occupiedTiles = createBuildingOccupiedTiles(buildings);
          for (const decoration of decorations) {
            if (!hasDecorationPosition(decoration)) {
              continue;
            }
            occupiedTiles.add(toDecorationTileKey(decoration.position.x, decoration.position.y));
          }

          const requestedKey = toDecorationTileKey(requestedPosition.x, requestedPosition.y);
          if (occupiedTiles.has(requestedKey)) {
            return {
              nextState: null,
              result: {
                statusCode: 409,
                responseBody: {
                  success: false,
                  error: '建物または既存装飾と重なるため配置できぬ。',
                  position: requestedPosition,
                },
                broadcastState: null,
              },
            };
          }

          const nextDecoration = {
            id: decorationId,
            type: payload.decorationId,
            position: requestedPosition,
          };
          const nextTown = normalizeTown(
            {
              ...currentTown,
              gold: currentTown.gold - decorationCost,
            },
            currentTown.gold - decorationCost
          );
          const nextState: LooseRecord = {
            ...currentState,
            town: nextTown,
            decorations: [...decorations, nextDecoration],
          };

          return {
            nextState,
            result: {
              statusCode: 200,
              responseBody: {
                success: true,
                decoration: nextDecoration,
                cost: decorationCost,
                town: nextTown,
                gameState: nextState,
              },
              broadcastState: nextState,
            },
          };
        }
      );
      if (mutationResult.broadcastState !== null) {
        broadcast('game_state_update', mutationResult.broadcastState);
      }

      sendMutationEnvelope(res, mutationResult.statusCode, mutationResult.responseBody);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: asErrorMessage(error),
      });
    }
  };

  const handleCollectDecoration: express.RequestHandler = async (req, res) => {
    const payload = normalizeCollectDecorationPayload(req.body);
    if (payload === null) {
      res.status(400).json({
        success: false,
        error: 'Request body must include valid decorationId.',
      });
      return;
    }

    try {
      const mutationResult = await queueGameStateMutation<ApiMutationResult>(
        async (currentState) => {
          const buildings = normalizeBuildings(currentState.buildings);
          const decorations = normalizeDecorationsForState(currentState.decorations, buildings);
          const targetIndex = decorations.findIndex(
            (decoration) => decoration.id === payload.decorationId
          );
          if (targetIndex < 0) {
            return {
              nextState: null,
              result: {
                statusCode: 404,
                responseBody: {
                  success: false,
                  error: `装飾が見つからぬ: ${payload.decorationId}`,
                },
                broadcastState: null,
              },
            };
          }

          const targetDecoration = decorations[targetIndex];
          if (!targetDecoration || !hasDecorationPosition(targetDecoration)) {
            return {
              nextState: null,
              result: {
                statusCode: 409,
                responseBody: {
                  success: false,
                  error: '既に未設置在庫へ回収済みでござる。',
                },
                broadcastState: null,
              },
            };
          }

          const nextDecorations = decorations.map((decoration, index) =>
            index === targetIndex
              ? (() => {
                  const { position: _position, ...decorationWithoutPosition } = decoration;
                  return decorationWithoutPosition;
                })()
              : decoration
          );
          const nextState: LooseRecord = {
            ...currentState,
            decorations: nextDecorations,
          };

          return {
            nextState,
            result: {
              statusCode: 200,
              responseBody: {
                success: true,
                decoration: {
                  id: targetDecoration.id,
                  type: targetDecoration.type,
                },
                gameState: nextState,
              },
              broadcastState: nextState,
            },
          };
        }
      );

      if (mutationResult.broadcastState !== null) {
        broadcast('game_state_update', mutationResult.broadcastState);
      }

      sendMutationEnvelope(res, mutationResult.statusCode, mutationResult.responseBody);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: asErrorMessage(error),
      });
    }
  };

  const handleUpgradeDecoration: express.RequestHandler = async (req, res) => {
    const payload = normalizeUpgradeDecorationPayload(req.body);
    if (payload === null) {
      res.status(400).json({
        success: false,
        error: 'Request body must include valid decorationId.',
      });
      return;
    }

    try {
      const mutationResult = await queueGameStateMutation<ApiMutationResult>(
        async (currentState) => {
          const buildings = normalizeBuildings(currentState.buildings);
          const decorations = normalizeDecorationsForState(currentState.decorations, buildings);
          const targetIndex = decorations.findIndex(
            (decoration) => decoration.id === payload.decorationId
          );
          if (targetIndex < 0) {
            return {
              nextState: null,
              result: {
                statusCode: 404,
                responseBody: {
                  success: false,
                  error: `装飾が見つからぬ: ${payload.decorationId}`,
                },
                broadcastState: null,
              },
            };
          }

          const targetDecoration = decorations[targetIndex];
          if (!targetDecoration || !hasDecorationPosition(targetDecoration)) {
            return {
              nextState: null,
              result: {
                statusCode: 409,
                responseBody: {
                  success: false,
                  error: '未設置の装飾は強化できぬ。先に設置されよ。',
                },
                broadcastState: null,
              },
            };
          }

          const upgradeCosts = DECORATION_UPGRADE_COSTS_BY_ITEM_ID.get(targetDecoration.type);
          if (!upgradeCosts || upgradeCosts.length === 0) {
            return {
              nextState: null,
              result: {
                statusCode: 400,
                responseBody: {
                  success: false,
                  error: `${targetDecoration.type} は強化対象外でござる。`,
                },
                broadcastState: null,
              },
            };
          }

          const currentLevel =
            typeof targetDecoration.level === 'number' && Number.isFinite(targetDecoration.level)
              ? Math.max(1, Math.min(5, Math.floor(targetDecoration.level)))
              : 1;
          const upgradeCost = upgradeCosts[currentLevel - 1] ?? null;
          if (upgradeCost === null || currentLevel >= 5) {
            return {
              nextState: null,
              result: {
                statusCode: 400,
                responseBody: {
                  success: false,
                  error: 'これ以上は強化できぬ（最大Lv）でござる。',
                },
                broadcastState: null,
              },
            };
          }

          const currentTown = normalizeTownFromState(currentState);
          if (currentTown.gold < upgradeCost) {
            return {
              nextState: null,
              result: {
                statusCode: 403,
                responseBody: {
                  success: false,
                  error: `軍資金不足でござる。必要: ${upgradeCost}G`,
                  meta: {
                    errorCode: 'DECORATION_UPGRADE_INSUFFICIENT_GOLD',
                    i18nKey: 'errors.decoration.upgrade.insufficient_gold',
                  },
                  requiredGold: upgradeCost,
                  haveGold: currentTown.gold,
                  missingGold: upgradeCost - currentTown.gold,
                },
                broadcastState: null,
              },
            };
          }

          const nextLevel = Math.min(5, currentLevel + 1);
          const passiveEffect =
            DECORATION_PASSIVE_EFFECT_BY_ITEM_ID[targetDecoration.type] ?? targetDecoration.passiveEffect;
          const nextDecoration = {
            ...targetDecoration,
            level: nextLevel,
            ...(passiveEffect ? { passiveEffect } : {}),
          };
          const nextDecorations = decorations.map((decoration, index) =>
            index === targetIndex ? nextDecoration : decoration
          );
          const nextTown = normalizeTown(
            {
              ...currentTown,
              gold: currentTown.gold - upgradeCost,
            },
            currentTown.gold - upgradeCost
          );
          const decorationName =
            ITEM_MASTER_BY_ID.get(targetDecoration.type)?.name ?? targetDecoration.type;
          const nextState: LooseRecord = {
            ...currentState,
            town: nextTown,
            decorations: nextDecorations,
            activityLog: appendActivityLog(
              currentState.activityLog,
              createActivityLogEntry({
                type: 'purchase',
                timestamp: new Date().toISOString(),
                gold: -upgradeCost,
                items: [
                  {
                    itemId: targetDecoration.type,
                    name: decorationName,
                    quantity: 1,
                  },
                ],
                message: `${decorationName}をLv${nextLevel}へ強化。-${upgradeCost}G`,
              })
            ),
          };

          return {
            nextState,
            result: {
              statusCode: 200,
              responseBody: {
                success: true,
                decoration: nextDecoration,
                cost: upgradeCost,
                town: nextTown,
                gameState: nextState,
              },
              broadcastState: nextState,
            },
          };
        }
      );

      if (mutationResult.broadcastState !== null) {
        broadcast('game_state_update', mutationResult.broadcastState);
      }

      sendMutationEnvelope(res, mutationResult.statusCode, mutationResult.responseBody);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: asErrorMessage(error),
      });
    }
  };

  const handleMoveDecoration: express.RequestHandler = async (req, res) => {
    const payload = normalizeMoveDecorationPayload(req.body);
    if (payload === null) {
      res.status(400).json({
        success: false,
        error: 'Request body must include valid decorationId and position.',
      });
      return;
    }

    try {
      const mutationResult = await queueGameStateMutation<ApiMutationResult>(
        async (currentState) => {
          const buildings = normalizeBuildings(currentState.buildings);
          const decorations = normalizeDecorationsForState(currentState.decorations, buildings);
          const targetIndex = decorations.findIndex(
            (decoration) => decoration.id === payload.decorationId
          );
          if (targetIndex < 0) {
            return {
              nextState: null,
              result: {
                statusCode: 404,
                responseBody: {
                  success: false,
                  error: `装飾が見つからぬ: ${payload.decorationId}`,
                },
                broadcastState: null,
              },
            };
          }

          const occupiedTiles = createBuildingOccupiedTiles(buildings);
          for (const decoration of decorations) {
            if (decoration.id === payload.decorationId || !hasDecorationPosition(decoration)) {
              continue;
            }
            occupiedTiles.add(toDecorationTileKey(decoration.position.x, decoration.position.y));
          }

          const requestedKey = toDecorationTileKey(payload.position.x, payload.position.y);
          if (occupiedTiles.has(requestedKey)) {
            return {
              nextState: null,
              result: {
                statusCode: 409,
                responseBody: {
                  success: false,
                  error: '建物または既存装飾と重なるため配置できぬ。',
                  position: payload.position,
                },
                broadcastState: null,
              },
            };
          }

          const nextDecorations = decorations.map((decoration, index) =>
            index === targetIndex
              ? {
                  ...decoration,
                  position: payload.position,
                }
              : decoration
          );
          const movedDecoration = nextDecorations[targetIndex];
          const nextState: LooseRecord = {
            ...currentState,
            decorations: nextDecorations,
          };

          return {
            nextState,
            result: {
              statusCode: 200,
              responseBody: {
                success: true,
                decoration: movedDecoration,
                gameState: nextState,
              },
              broadcastState: nextState,
            },
          };
        }
      );

      if (mutationResult.broadcastState !== null) {
        broadcast('game_state_update', mutationResult.broadcastState);
      }

      sendMutationEnvelope(res, mutationResult.statusCode, mutationResult.responseBody);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: asErrorMessage(error),
      });
    }
  };

  const handleMoveBuilding: express.RequestHandler = async (req, res) => {
    const payload = normalizeMoveBuildingPayload(req.body);
    if (payload === null) {
      res.status(400).json({
        success: false,
        error: 'Request body must include valid buildingId and position.',
      });
      return;
    }

    try {
      const mutationResult = await queueGameStateMutation<ApiMutationResult>(
        async (currentState) => {
          const buildings = normalizeBuildings(currentState.buildings);
          const targetIndex = buildings.findIndex((building) => building.type === payload.buildingId);
          if (targetIndex < 0) {
            return {
              nextState: null,
              result: {
                statusCode: 404,
                responseBody: {
                  success: false,
                  error: `建物が見つからぬ: ${payload.buildingId}`,
                },
                broadcastState: null,
              },
            };
          }

          const footprint = BUILDING_CONFIGS[payload.buildingId].footprint;
          const requestedPosition = clampBuildingMovePosition(payload.position, footprint);
          const occupiedTiles = createBuildingOccupiedTiles(
            buildings.filter((building) => building.type !== payload.buildingId)
          );
          const decorations = normalizeDecorationsForState(currentState.decorations, buildings);
          for (const decoration of decorations) {
            if (!hasDecorationPosition(decoration)) {
              continue;
            }

            occupiedTiles.add(toDecorationTileKey(decoration.position.x, decoration.position.y));
          }

          for (let offsetY = 0; offsetY < footprint.height; offsetY += 1) {
            for (let offsetX = 0; offsetX < footprint.width; offsetX += 1) {
              const tileX = requestedPosition.x + offsetX;
              const tileY = requestedPosition.y + offsetY;
              const tileKey = toDecorationTileKey(tileX, tileY);
              if (!occupiedTiles.has(tileKey)) {
                continue;
              }

              return {
                nextState: null,
                result: {
                  statusCode: 409,
                  responseBody: {
                    success: false,
                    error: '建物または既存装飾と重なるため移動できぬ。',
                    position: requestedPosition,
                  },
                  broadcastState: null,
                },
              };
            }
          }

          const nextBuildings = buildings.map((building, index) =>
            index === targetIndex
              ? {
                  ...building,
                  position: requestedPosition,
                }
              : building
          );
          const normalizedBuildings = normalizeBuildings(nextBuildings);
          const movedBuilding = normalizedBuildings.find(
            (building) => building.type === payload.buildingId
          );
          if (!movedBuilding) {
            return {
              nextState: null,
              result: {
                statusCode: 500,
                responseBody: {
                  success: false,
                  error: `建物移動の整形に失敗いたした: ${payload.buildingId}`,
                },
                broadcastState: null,
              },
            };
          }

          const nextState: LooseRecord = {
            ...currentState,
            buildings: normalizedBuildings,
          };

          return {
            nextState,
            result: {
              statusCode: 200,
              responseBody: {
                success: true,
                building: movedBuilding,
                gameState: nextState,
              },
              broadcastState: nextState,
            },
          };
        }
      );

      if (mutationResult.broadcastState !== null) {
        broadcast('game_state_update', mutationResult.broadcastState);
      }

      sendMutationEnvelope(res, mutationResult.statusCode, mutationResult.responseBody);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: asErrorMessage(error),
      });
    }
  };

  const handlePlaceDecoration: express.RequestHandler = async (req, res) => {
    const payload = normalizePlaceDecorationPayload(req.body);
    if (payload === null) {
      res.status(400).json({
        success: false,
        error: 'Request body must include valid decorationType and position.',
      });
      return;
    }

    try {
      const mutationResult = await queueGameStateMutation<ApiMutationResult>(
        async (currentState) => {
          const buildings = normalizeBuildings(currentState.buildings);
          const decorations = normalizeDecorationsForState(currentState.decorations, buildings);
          const targetIndex = decorations.findIndex(
            (decoration) =>
              decoration.type === payload.decorationType && !hasDecorationPosition(decoration)
          );
          if (targetIndex < 0) {
            return {
              nextState: null,
              result: {
                statusCode: 404,
                responseBody: {
                  success: false,
                  error: `未設置在庫が見つからぬ: ${payload.decorationType}`,
                },
                broadcastState: null,
              },
            };
          }

          const occupiedTiles = createBuildingOccupiedTiles(buildings);
          for (const decoration of decorations) {
            if (!hasDecorationPosition(decoration)) {
              continue;
            }
            occupiedTiles.add(toDecorationTileKey(decoration.position.x, decoration.position.y));
          }

          const requestedKey = toDecorationTileKey(payload.position.x, payload.position.y);
          if (occupiedTiles.has(requestedKey)) {
            return {
              nextState: null,
              result: {
                statusCode: 409,
                responseBody: {
                  success: false,
                  error: '建物または既存装飾と重なるため配置できぬ。',
                  position: payload.position,
                },
                broadcastState: null,
              },
            };
          }

          const nextDecorations = decorations.map((decoration, index) =>
            index === targetIndex
              ? {
                  ...decoration,
                  position: payload.position,
                }
              : decoration
          );
          const placedDecoration = nextDecorations[targetIndex];
          const nextState: LooseRecord = {
            ...currentState,
            decorations: nextDecorations,
          };

          return {
            nextState,
            result: {
              statusCode: 200,
              responseBody: {
                success: true,
                decoration: placedDecoration,
                gameState: nextState,
              },
              broadcastState: nextState,
            },
          };
        }
      );

      if (mutationResult.broadcastState !== null) {
        broadcast('game_state_update', mutationResult.broadcastState);
      }

      sendMutationEnvelope(res, mutationResult.statusCode, mutationResult.responseBody);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: asErrorMessage(error),
      });
    }
  };

  buildingRouter.post(
    '/api/purchase-decoration',
    validate(purchaseDecorationSchema),
    handlePurchaseDecoration
  );
  buildingRouter.post(
    '/api/collect-decoration',
    validate(collectDecorationSchema),
    handleCollectDecoration
  );
  buildingRouter.post(
    '/api/upgrade-decoration',
    validate(upgradeDecorationSchema),
    handleUpgradeDecoration
  );
  buildingRouter.post('/api/move-decoration', validate(moveDecorationSchema), handleMoveDecoration);
  buildingRouter.post('/api/move-building', validate(moveBuildingSchema), handleMoveBuilding);
  buildingRouter.post(
    '/api/place-decoration',
    validate(placeDecorationSchema),
    handlePlaceDecoration
  );

  commandRouter.post('/api/command', validate(commandSchema), async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      sendErrorEnvelope(res, 400, 'message is required.', {
        meta: {
          errorCode: 'COMMAND_MESSAGE_REQUIRED',
          i18nKey: 'errors.command.message.required',
        },
      });
      return;
    }

    try {
      await sendTmuxMessage(message, SHOGUN_TARGET_PANE);
      sendSuccessEnvelope(res, { accepted: true }, { statusCode: 201 });
    } catch (error) {
      sendErrorEnvelope(res, 500, error, {
        fallback: 'Failed to send command',
        meta: {
          errorCode: 'COMMAND_SEND_FAILED',
          i18nKey: 'errors.command.send_failed',
        },
      });
    }
  });

  commandRouter.post('/api/approve', validate(approveSchema), async (req, res) => {
    const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId.trim() : '';
    const customMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const approvalMessage = customMessage || (commandId ? `承認: ${commandId}` : '承認いたす');

    try {
      await sendTmuxMessage(approvalMessage, SHOGUN_TARGET_PANE);
      const payload = {
        message: approvalMessage,
      };
      sendSuccessEnvelope(res, payload, { statusCode: 201, legacy: payload });
    } catch (error) {
      sendErrorEnvelope(res, 500, error, {
        fallback: 'Failed to send approval message',
        meta: {
          errorCode: 'APPROVAL_SEND_FAILED',
          i18nKey: 'errors.approval.send_failed',
        },
      });
    }
  });

  proxyRouter.use((req, res) => {
    const proxyReq = httpRequest(
      {
        hostname: VITE_DEV_HOST,
        port: VITE_DEV_PORT,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', () => {
      res.status(502).send('Vite dev server not ready. Access http://localhost:3210 directly.');
    });

    req.on('aborted', () => {
      proxyReq.destroy();
    });

    req.pipe(proxyReq);
  });

  app.use(systemRouter);
  app.use(agentRouter);
  app.use(townRouter);
  app.use(itemRouter);
  app.use(buildingRouter);
  app.use(commandRouter);
  app.use(proxyRouter);
}
