import express from 'express';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import {
  TASK_TO_BUILDING_MAP,
  TOWN_LEVEL_XP_THRESHOLDS,
  type ActivityLogEntry,
  type ActivityLogItem,
  type ActivityLogType,
  type AshigaruStatus,
  type BuildingLevel,
  type GameState,
  type TaskCategory,
} from '../src/types/game';
import type { InventoryItem, ItemDefinition } from '../src/types/item';
import { INITIAL_INVENTORY, ITEM_MASTER } from '../src/data/item-master';
import {
  DEFAULT_MISSION_DEFINITIONS,
  checkMission,
  toMissionState,
  type MissionDefinition,
  type MissionHistory,
} from '../src/lib/gamification/mission-system';
import { checkAchievements, checkTitles } from '../src/lib/gamification/achievement-system';
import { getNextRankXP, getRank, getRankDefinition } from '../src/lib/gamification/rank-system';
import {
  BUILDING_CONFIGS,
  type BuildingTypeConfig,
} from '../src/game/objects/buildings/BuildingConfig';
import {
  DECORATION_COSTS,
  applyDropRateBonus,
  calculatePassiveEffects,
} from '../src/lib/gamification/economy';
import { createFileWatcher } from './file-watcher';
import {
  ALLOWED_HTTP_ORIGIN,
  API_AUTH_HEADER,
  API_AUTH_TOKEN,
  BASE_DIR,
  COMMAND_ARCHIVE_FILE_PATH,
  COMMAND_FILE_PATH,
  DASHBOARD_FILE_PATH,
  GAME_STATE_FILE_PATH,
  PORT,
  REPORTS_DIR,
  SERVER_HOST,
  SHOGUN_TARGET_PANE,
  TASKS_DIR,
  VITE_DEV_HOST,
  VITE_DEV_PORT,
} from './config/constants';
import { registerApiRoutes } from './routes/api';
import type {
  ServerCommandUpdatePayload,
  ServerReportUpdatePayload,
  ServerTaskUpdatePayload,
  WSEventType,
} from './types';
import { broadcastWsMessage, createWebSocketServer, registerWebSocketHandlers } from './ws/handler';
import { readYamlFile, writeYamlFile } from './yaml-parser';

type LooseRecord = Record<string, unknown>;
const WORKER_IDS = [
  'ashigaru1',
  'ashigaru2',
  'ashigaru3',
  'ashigaru4',
  'ashigaru5',
  'ashigaru6',
  'ashigaru7',
  'ashigaru8',
] as const;
const DEV_LOCAL_API_TOKEN = 'shogun-local-dev-token';
type WorkerId = (typeof WORKER_IDS)[number];
const COMMANDER_SOURCES = [
  {
    workerId: 'shogun',
    role: 'shogun',
    label: '将軍',
    paneTarget: 'shogun:0.0',
  },
  {
    workerId: 'karo',
    role: 'karo',
    label: '家老',
    paneTarget: 'multiagent:0.0',
  },
] as const;
type CommanderSource = (typeof COMMANDER_SOURCES)[number];
type CommanderId = CommanderSource['workerId'];
type AgentId = WorkerId | CommanderId;
type ContextRole = 'ashigaru' | CommanderSource['role'];
type ContextStatus = 'idle' | 'working' | 'unknown';
type ContextActorId = WorkerId | CommanderId;
const TASK_CATEGORIES: TaskCategory[] = [
  'new_implementation',
  'refactoring',
  'skill_creation',
  'analysis',
  'bug_fix',
  'docs',
  'test',
  'idle',
  'other',
];
const USER_FACING_TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  new_implementation: '新設任務',
  refactoring: '改修任務',
  skill_creation: '兵法開発任務',
  analysis: '軍略調査任務',
  bug_fix: '障害討伐任務',
  docs: '記録整備任務',
  test: '検分任務',
  idle: '待機任務',
  other: '雑務任務',
};
const USER_FACING_TEXT_REPLACEMENTS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /API未提供/gi, replacement: '判定中' },
  { pattern: /\bnew_implementation\b/gi, replacement: '新設任務' },
  { pattern: /\brefactoring\b/gi, replacement: '改修任務' },
  { pattern: /新規実装/g, replacement: '新設任務' },
  { pattern: /リファクタリング/g, replacement: '改修任務' },
];
const INTERNAL_MANAGEMENT_ID_PATTERN = /\b(?:cmd_[a-z0-9_-]+|subtask[_-]?[a-z0-9_-]+)\b/gi;
const INTERNAL_MANAGEMENT_ID_EXACT_PATTERN = /^(?:cmd_[a-z0-9_-]+|subtask[_-]?[a-z0-9_-]+)$/i;
const ACTIVITY_LOG_TYPES: ActivityLogType[] = [
  'work_start',
  'work_complete',
  'purchase',
  'item_consume',
  'building_upgrade',
  'mission_complete',
];
const SEED_ACTIVITY_LOG_ID_PATTERN = /^seed\d+-\d+$/i;
const SEED_ACTIVITY_LOG_MESSAGE_PATTERN = /^seed\d+\s+\d+$/i;
const DEBUG_ACTIVITY_LOG_ID_PATTERN = /^_?debug[_:-]/i;
const DEBUG_ACTIVITY_LOG_MESSAGE_PATTERN = /^(?:\[[^\]]*debug[^\]]*\]|_?debug[\s:_-].*)$/i;
const ASHIGARU_STATUSES: AshigaruStatus[] = ['idle', 'working', 'blocked', 'offline'];
const BUILDING_TYPES: GameState['buildings'][number]['type'][] = [
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
const DECORATION_MAP_WIDTH = 16;
const DECORATION_MAP_HEIGHT = 16;
const BUILDING_FOOTPRINTS: Record<
  GameState['buildings'][number]['type'],
  { width: number; height: number }
> = {
  castle: { width: 2, height: 2 },
  mansion: { width: 1, height: 1 },
  inn: { width: 1, height: 1 },
  dojo: { width: 1, height: 1 },
  smithy: { width: 1, height: 1 },
  training: { width: 1, height: 1 },
  study: { width: 1, height: 1 },
  healer: { width: 1, height: 1 },
  watchtower: { width: 1, height: 1 },
  scriptorium: { width: 1, height: 1 },
};
const DEFAULT_BUILDING_POSITIONS: Record<
  GameState['buildings'][number]['type'],
  { x: number; y: number }
> = {
  castle: { x: 7, y: 7 },
  mansion: { x: 0, y: 3 },
  inn: { x: 2, y: 9 },
  dojo: { x: 12, y: 0 },
  smithy: { x: 13, y: 9 },
  training: { x: 15, y: 4 },
  study: { x: 8, y: 12 },
  healer: { x: 5, y: 2 },
  watchtower: { x: 4, y: 15 },
  scriptorium: { x: 12, y: 15 },
};
const BUILDING_NEIGHBOR_OFFSETS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
const DECORATION_NEIGHBOR_OFFSETS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
const GOLD_RATE_PER_MIN = 1;
const XP_RATE_PER_MIN = 2;
const MAX_ACTIVITY_LOG_ENTRIES = 100;
const GAME_STATE_CAS_RETRY_ATTEMPTS = 2;
const GAME_STATE_MTIME_MATCH_EPSILON_MS = 0.5;
const GAME_STATE_HTTP_UNAVAILABLE_STATUS = 503;
const GAME_STATE_HTTP_CONFLICT_STATUS = 409;
const COMPLETION_REWARD_DEDUPE_KEYS_STATE_KEY = '__completionRewardAppliedKeys';
const COMPLETION_REWARD_DEDUPE_KEYS_LIMIT = 2048;
const BUILDING_LABELS: Record<GameState['buildings'][number]['type'], string> = {
  castle: '城',
  mansion: '屋敷',
  inn: '宿',
  dojo: '道場',
  smithy: '鍛冶屋',
  training: '訓練所',
  study: '学問所',
  healer: '薬師',
  watchtower: '物見櫓',
  scriptorium: '写本所',
};
const TASK_CATEGORY_TO_REWARD_BUILDING: Readonly<
  Record<TaskCategory, GameState['buildings'][number]['type']>
> = TASK_TO_BUILDING_MAP;
const MIN_ACTIVE_MISSION_COUNT = 8;
const MAX_ACTIVE_MISSION_COUNT = 10;
const MISSION_CATEGORY_HISTORY_WINDOW = 24;
const REQUIRED_DEPLOYED_MISSION_IDS = [
  'mission_003',
  'mission_005',
  'mission_007',
  'mission_009',
] as const;
const CONTEXT_PATTERNS: RegExp[] = [
  /tkns\.\s*\((\d+)\s*%\)/i,
  /(\d+)\s*%\s*context left/i,
  /context left[^0-9]*(\d+)\s*%/i,
  /\((\d+)\s*%\)\s*t left/i,
];
const CONTEXT_WORKING_PATTERNS: RegExp[] = [
  /thinking/i,
  /esc to interrupt/i,
  /effecting/i,
  /boondoggling/i,
  /puzzling/i,
  /reading/i,
  /writing/i,
  /running/i,
];
const WORKER_LABELS: Record<WorkerId, string> = {
  ashigaru1: '足軽壱',
  ashigaru2: '足軽弐',
  ashigaru3: '足軽参',
  ashigaru4: '足軽四',
  ashigaru5: '足軽五',
  ashigaru6: '足軽六',
  ashigaru7: '足軽七',
  ashigaru8: '足軽八',
};
const DEFAULT_COMMANDER_NAMES: Record<CommanderId, string> = {
  shogun: '将軍',
  karo: '家老',
};
type DecorationPassiveEffect = NonNullable<GameState['decorations'][number]['passiveEffect']>;
const DEFAULT_DECORATION_PASSIVE_BONUS_PER_LEVEL = 0.05;
const DECORATION_PASSIVE_EFFECT_BY_TYPE: Readonly<Record<string, DecorationPassiveEffect>> = {
  maneki_neko: {
    type: 'gold_bonus',
    bonusPerLevel: DEFAULT_DECORATION_PASSIVE_BONUS_PER_LEVEL,
  },
  komainu: {
    type: 'xp_bonus',
    bonusPerLevel: DEFAULT_DECORATION_PASSIVE_BONUS_PER_LEVEL,
  },
  stone_lantern: {
    type: 'drop_rate_bonus',
    bonusPerLevel: DEFAULT_DECORATION_PASSIVE_BONUS_PER_LEVEL,
  },
  ishidoro: {
    type: 'drop_rate_bonus',
    bonusPerLevel: DEFAULT_DECORATION_PASSIVE_BONUS_PER_LEVEL,
  },
};
const MATERIAL_DROP_ITEM_DEFINITIONS: ItemDefinition[] = [
  {
    id: 'cedar_lumber',
    name: '杉材',
    description: '建築・補修の基礎材。城下の建材として幅広く用いられる。',
    itemType: 'material',
    rarity: 'common',
    effect: {
      type: 'passive_bonus',
      value: 0,
      key: 'craft_material',
    },
    usable: false,
    stackable: true,
    shopCost: 24,
  },
  {
    id: 'stone_block',
    name: '石材',
    description: '土台や防備に使う切り石。重量があり備蓄向き。',
    itemType: 'material',
    rarity: 'common',
    effect: {
      type: 'passive_bonus',
      value: 0,
      key: 'craft_material',
    },
    usable: false,
    stackable: true,
    shopCost: 28,
  },
  {
    id: 'tamahagane_ingot',
    name: '玉鋼片',
    description: '武具や工具に使う鍛造素材。鍛冶仕事で重宝される。',
    itemType: 'material',
    rarity: 'uncommon',
    effect: {
      type: 'passive_bonus',
      value: 0,
      key: 'craft_material',
    },
    usable: false,
    stackable: true,
    shopCost: 42,
  },
  {
    id: 'hemp_cloth',
    name: '麻布',
    description: '装具の裏打ちや包帯にも使える汎用布素材。',
    itemType: 'material',
    rarity: 'uncommon',
    effect: {
      type: 'passive_bonus',
      value: 0,
      key: 'craft_material',
    },
    usable: false,
    stackable: true,
    shopCost: 36,
  },
  {
    id: 'sumi_ink',
    name: '松煙墨',
    description: '記録や写本に必要な墨。知識系施設での需要が高い。',
    itemType: 'material',
    rarity: 'rare',
    effect: {
      type: 'passive_bonus',
      value: 0,
      key: 'craft_material',
    },
    usable: false,
    stackable: true,
    shopCost: 58,
  },
  {
    id: 'medicinal_herb',
    name: '薬草束',
    description: '調合の下地となる乾燥薬草。治療・支援用途に使う。',
    itemType: 'material',
    rarity: 'common',
    effect: {
      type: 'passive_bonus',
      value: 0,
      key: 'craft_material',
    },
    usable: false,
    stackable: true,
    shopCost: 30,
  },
];

const mergeItemMasterDefinitions = (definitions: ItemDefinition[]): void => {
  const existingItemIds = new Set(ITEM_MASTER.map((item) => item.id));
  for (const definition of definitions) {
    if (existingItemIds.has(definition.id)) {
      continue;
    }

    ITEM_MASTER.push(definition);
    existingItemIds.add(definition.id);
  }
};

mergeItemMasterDefinitions(MATERIAL_DROP_ITEM_DEFINITIONS);

const ITEM_MASTER_BY_ID = new Map<string, ItemDefinition>(
  ITEM_MASTER.map((item) => [item.id, item])
);
const MATERIAL_ITEM_ID_SET = new Set<string>(
  ITEM_MASTER.filter((item) => item.itemType === 'material').map((item) => item.id)
);

type RewardBuildingType = GameState['buildings'][number]['type'];

const MATERIAL_DROP_TABLE: Partial<Record<RewardBuildingType, readonly string[]>> = {
  dojo: ['tamahagane_ingot', 'hemp_cloth'],
  smithy: ['adamantite_fragment', 'tamahagane_ingot'],
  training: ['cedar_lumber', 'stone_block'],
  study: ['sumi_ink', 'cedar_lumber'],
  healer: ['medicinal_herb', 'hemp_cloth'],
  watchtower: ['stone_block', 'tamahagane_ingot'],
  scriptorium: ['sumi_ink', 'hemp_cloth'],
};

type UpgradeCostBuildingType = GameState['buildings'][number]['type'];
type UpgradeCostLevel = 1 | 2 | 3 | 4;

interface UpgradeMaterialCost {
  itemId: string;
  quantity: number;
}

interface UpgradeCost {
  buildingId: UpgradeCostBuildingType;
  fromLevel: UpgradeCostLevel;
  toLevel: BuildingLevel;
  gold: number;
  materials: UpgradeMaterialCost[];
}

interface BuildingState extends Pick<BuildingTypeConfig, 'type' | 'label' | 'emoji'> {
  level: BuildingLevel;
}

interface UpgradeMaterialMissing {
  id: string;
  required: number;
  have: number;
}

const UPGRADE_COST_LEVEL_PRESETS: Record<
  UpgradeCostLevel,
  {
    gold: number;
    primary: number;
    secondary: number;
  }
> = {
  1: { gold: 50, primary: 1, secondary: 0 },
  2: { gold: 100, primary: 2, secondary: 0 },
  3: { gold: 150, primary: 3, secondary: 1 },
  4: { gold: 250, primary: 5, secondary: 2 },
};

const UPGRADE_MATERIAL_PAIR_BY_BUILDING: Record<
  UpgradeCostBuildingType,
  {
    primary: string;
    secondary: string;
  }
> = {
  castle: {
    primary: 'stone_block',
    secondary: 'adamantite_fragment',
  },
  mansion: {
    primary: 'cedar_lumber',
    secondary: 'hemp_cloth',
  },
  inn: {
    primary: 'hemp_cloth',
    secondary: 'medicinal_herb',
  },
  dojo: {
    primary: 'tamahagane_ingot',
    secondary: 'hemp_cloth',
  },
  smithy: {
    primary: 'tamahagane_ingot',
    secondary: 'stone_block',
  },
  training: {
    primary: 'cedar_lumber',
    secondary: 'stone_block',
  },
  study: {
    primary: 'sumi_ink',
    secondary: 'cedar_lumber',
  },
  healer: {
    primary: 'medicinal_herb',
    secondary: 'hemp_cloth',
  },
  watchtower: {
    primary: 'stone_block',
    secondary: 'tamahagane_ingot',
  },
  scriptorium: {
    primary: 'sumi_ink',
    secondary: 'hemp_cloth',
  },
};

const UPGRADE_COST_TABLE: Record<
  UpgradeCostBuildingType,
  Record<UpgradeCostLevel, { gold: number; materials: UpgradeMaterialCost[] }>
> = (() => {
  const table = {} as Record<
    UpgradeCostBuildingType,
    Record<UpgradeCostLevel, { gold: number; materials: UpgradeMaterialCost[] }>
  >;

  for (const buildingId of Object.keys(
    UPGRADE_MATERIAL_PAIR_BY_BUILDING
  ) as UpgradeCostBuildingType[]) {
    const pair = UPGRADE_MATERIAL_PAIR_BY_BUILDING[buildingId];
    const byLevel = {} as Record<
      UpgradeCostLevel,
      { gold: number; materials: UpgradeMaterialCost[] }
    >;

    for (const fromLevel of Object.keys(UPGRADE_COST_LEVEL_PRESETS).map(
      (value) => Number(value) as UpgradeCostLevel
    )) {
      const preset = UPGRADE_COST_LEVEL_PRESETS[fromLevel];
      const materials: UpgradeMaterialCost[] = [];

      if (preset.primary > 0) {
        materials.push({
          itemId: pair.primary,
          quantity: preset.primary,
        });
      }
      if (preset.secondary > 0) {
        materials.push({
          itemId: pair.secondary,
          quantity: preset.secondary,
        });
      }

      byLevel[fromLevel] = {
        gold: preset.gold,
        materials,
      };
    }

    table[buildingId] = byLevel;
  }

  return table;
})();

const SHOGUN_SEAL_ITEM_ID = 'shogun_seal';
const SHOGUN_SEAL_GOLD_BONUS_RATE = (() => {
  const item = ITEM_MASTER_BY_ID.get(SHOGUN_SEAL_ITEM_ID);
  if (
    item === undefined ||
    item.effect.type !== 'passive_bonus' ||
    item.effect.key !== 'gold_gain_rate'
  ) {
    return 0;
  }

  return Math.max(0, item.effect.value);
})();

type DecorationCostKey = keyof typeof DECORATION_COSTS;
const DECORATION_COST_ALIASES: Readonly<Record<string, DecorationCostKey>> = {
  market: 'market_stall',
};

interface ContextStat {
  [key: string]: unknown;
  workerId: ContextActorId;
  role: ContextRole;
  label: string;
  pane: string | null;
  status: ContextStatus;
  contextPercent: number | null;
  capturedAt: string;
}

interface InitialStatePayload {
  tasks: ServerTaskUpdatePayload[];
  reports: ServerReportUpdatePayload[];
  dashboard: string;
  commands: ServerCommandUpdatePayload[];
  gameState: GameState;
  contextStats: ContextStat[];
}

interface MissionReportSnapshot {
  status: ServerReportUpdatePayload['status'];
  timestampMs: number;
  category: TaskCategory;
  durationMinutes: number;
}

interface GameStateMutationBroadcastResult {
  broadcastState: LooseRecord | null;
}

const isProductionEnvironment = process.env.NODE_ENV === 'production';
const isViteDevelopmentMode = !isProductionEnvironment;

if (API_AUTH_TOKEN === null) {
  if (isProductionEnvironment) {
    throw new Error('[security] SHOGUN_API_TOKEN must be configured in production.');
  }
  console.warn(
    '[security] SHOGUN_API_TOKEN is not configured. Non-local API requests will be rejected.'
  );
}

const contentSecurityPolicy = buildContentSecurityPolicy();
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  if (requestOrigin !== undefined && !isAllowedHttpOrigin(requestOrigin)) {
    res.status(403).json({
      success: false,
      error: `Origin not allowed: ${requestOrigin}`,
    });
    return;
  }

  if (requestOrigin !== undefined) {
    res.header('Access-Control-Allow-Origin', requestOrigin);
  }

  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Headers', `Content-Type, Authorization, ${API_AUTH_HEADER}`);
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Content-Security-Policy', contentSecurityPolicy);
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS') {
    next();
    return;
  }

  if (isDevUiGetRequest(req)) {
    next();
    return;
  }

  if (hasValidApiToken(req)) {
    next();
    return;
  }

  res.status(401).json({
    success: false,
    error: buildUnauthorizedErrorMessage(),
  });
});

const httpServer = createServer(app);
const wss = createWebSocketServer();

let gameStateWriteQueue: Promise<void> = Promise.resolve();
let commandTitleByIdCache = new Map<string, string>();
let commandTitleByIdDirty = true;
let taskSnapshotsCache: LooseRecord[] = [];
let reportSnapshotsCache: LooseRecord[] = [];
let taskSnapshotsDirty = true;
let reportSnapshotsDirty = true;
let initialStateCache: InitialStatePayload | null = null;
let initialStateDirty = true;

interface HttpStatusError extends Error {
  statusCode: number;
  errorCode: string;
}

function createHttpStatusError(
  statusCode: number,
  errorCode: string,
  message: string
): HttpStatusError {
  const error = new Error(message) as HttpStatusError;
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  return error;
}

function createGameStateUnavailableError(parseError: string): HttpStatusError {
  return createHttpStatusError(
    GAME_STATE_HTTP_UNAVAILABLE_STATUS,
    'GAME_STATE_UNAVAILABLE',
    `Game state is unavailable due to YAML parse error: ${parseError}`
  );
}

function createGameStateConflictError(context: string): HttpStatusError {
  return createHttpStatusError(
    GAME_STATE_HTTP_CONFLICT_STATUS,
    'GAME_STATE_CONFLICT',
    context
  );
}

function isGameStateUnavailableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as Partial<HttpStatusError>).errorCode === 'GAME_STATE_UNAVAILABLE'
  );
}

function isRecord(value: unknown): value is LooseRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAllowedHttpOrigin(origin: string | undefined): boolean {
  return origin === ALLOWED_HTTP_ORIGIN;
}

function isAllowedWsOrigin(origin: string | undefined): boolean {
  if (origin === undefined) {
    return true;
  }
  if (origin === ALLOWED_HTTP_ORIGIN) {
    return true;
  }
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function buildContentSecurityPolicy(): string {
  const scriptSrc = isViteDevelopmentMode
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self'";
  const styleSrc = isViteDevelopmentMode
    ? "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
    : "style-src 'self' https://fonts.googleapis.com";
  const connectSrc = isViteDevelopmentMode
    ? "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*"
    : "connect-src 'self'";

  return `default-src 'self'; ${scriptSrc}; ${styleSrc}; font-src 'self' https://fonts.gstatic.com; ${connectSrc}; img-src 'self' data: blob:;`;
}

function isDevUiGetRequest(req: express.Request): boolean {
  if (req.method !== 'GET') {
    return false;
  }

  return isLocalUiRequest(req);
}

function isLocalUiRequest(req: express.Request): boolean {
  const origin = req.header('origin');
  if (isAllowedHttpOrigin(origin)) {
    return true;
  }

  const referer = req.header('referer');
  if (typeof referer !== 'string') {
    return false;
  }

  try {
    const parsedReferer = new URL(referer);
    return isAllowedHttpOrigin(`${parsedReferer.protocol}//${parsedReferer.host}`);
  } catch {
    return false;
  }
}

function extractApiToken(req: express.Request): string | null {
  const tokenHeader = req.header(API_AUTH_HEADER);
  if (typeof tokenHeader === 'string' && tokenHeader.trim().length > 0) {
    return tokenHeader.trim();
  }

  const authorization = req.header('authorization');
  if (typeof authorization === 'string') {
    const matched = authorization.match(/^Bearer\s+(.+)$/i);
    if (matched && matched[1].trim().length > 0) {
      return matched[1].trim();
    }
  }

  return null;
}

function hasValidApiToken(req: express.Request): boolean {
  const token = extractApiToken(req);
  if (API_AUTH_TOKEN === null) {
    if (!isLocalUiRequest(req)) {
      return false;
    }
    return token === null || token === DEV_LOCAL_API_TOKEN;
  }

  return token !== null && token === API_AUTH_TOKEN;
}

function buildUnauthorizedErrorMessage(): string {
  if (API_AUTH_TOKEN === null) {
    return 'Unauthorized. SHOGUN_API_TOKEN is not configured on this server.';
  }

  return `Unauthorized. Provide ${API_AUTH_HEADER} header or Authorization: Bearer <token>.`;
}

function markInitialStateDirty(): void {
  initialStateDirty = true;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeWorkerId(value: unknown): WorkerId | null {
  const normalized = asString(value);
  if (normalized === null) {
    return null;
  }

  const matched = normalized.match(/^ashigaru([1-8])$/);
  if (!matched) {
    return null;
  }

  return `ashigaru${matched[1]}` as WorkerId;
}

function normalizeCommanderId(value: unknown): CommanderId | null {
  const normalized = asString(value);
  if (normalized === null) {
    return null;
  }

  if (normalized === 'shogun' || normalized === 'karo') {
    return normalized;
  }

  return null;
}

function normalizeAgentId(value: unknown): AgentId | null {
  return normalizeWorkerId(value) ?? normalizeCommanderId(value);
}

function normalizeReportWorkerId(value: unknown): WorkerId | null {
  const normalized = asString(value);
  if (normalized === null) {
    return null;
  }

  if (normalized.endsWith('_report')) {
    return normalizeWorkerId(normalized.replace(/_report$/, ''));
  }

  return normalizeWorkerId(normalized);
}

function asTimestamp(value: unknown): string {
  return asString(value) ?? new Date().toISOString();
}

function asTaskCategory(value: unknown): TaskCategory | null {
  const normalized = asString(value);
  if (normalized === null) {
    return null;
  }

  return TASK_CATEGORIES.includes(normalized as TaskCategory) ? (normalized as TaskCategory) : null;
}

function asAshigaruStatus(value: unknown): AshigaruStatus | null {
  const normalized = asString(value);
  if (normalized === null) {
    return null;
  }

  return ASHIGARU_STATUSES.includes(normalized as AshigaruStatus)
    ? (normalized as AshigaruStatus)
    : null;
}

function toUserFacingTaskCategoryLabel(value: unknown): string | null {
  const category = asTaskCategory(value);
  if (category === null) {
    return null;
  }

  return USER_FACING_TASK_CATEGORY_LABELS[category];
}

function sanitizeUserFacingText(value: string): string {
  let sanitized = value;
  for (const replacement of USER_FACING_TEXT_REPLACEMENTS) {
    sanitized = sanitized.replace(replacement.pattern, replacement.replacement);
  }

  sanitized = sanitized.replace(INTERNAL_MANAGEMENT_ID_PATTERN, '任務名');
  const compact = sanitized
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();

  return compact.length > 0 ? compact : '判定中';
}

function extractUserFacingTaskTitle(description: string | null): string | null {
  if (description === null) {
    return null;
  }

  const firstLine = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return null;
  }

  const sanitized = sanitizeUserFacingText(firstLine);
  if (
    sanitized === '判定中' ||
    sanitized === '任務名' ||
    INTERNAL_MANAGEMENT_ID_EXACT_PATTERN.test(sanitized)
  ) {
    return null;
  }

  return sanitized;
}

function toUserFacingTaskLabel(
  rawTaskId: string | null,
  description: string | null,
  categoryLabel: string | null
): string | null {
  if (rawTaskId === null) {
    return extractUserFacingTaskTitle(description) ?? categoryLabel;
  }

  if (!INTERNAL_MANAGEMENT_ID_EXACT_PATTERN.test(rawTaskId)) {
    return sanitizeUserFacingText(rawTaskId);
  }

  return extractUserFacingTaskTitle(description) ?? categoryLabel ?? '集計待ち';
}

function sanitizeOptionalUserFacingText(value: string | null): string | null {
  return value === null ? null : sanitizeUserFacingText(value);
}

function sanitizeInternalCommandId(value: string | null): string | null {
  if (value === null || INTERNAL_MANAGEMENT_ID_EXACT_PATTERN.test(value)) {
    return null;
  }

  const sanitized = sanitizeUserFacingText(value);
  return sanitized === '判定中' || sanitized === '任務名' ? null : sanitized;
}

function asActivityLogType(value: unknown): ActivityLogType | null {
  const normalized = asString(value);
  if (normalized === null) {
    return null;
  }

  return ACTIVITY_LOG_TYPES.includes(normalized as ActivityLogType)
    ? (normalized as ActivityLogType)
    : null;
}

function normalizeActivityLogItems(items: unknown): ActivityLogItem[] | undefined {
  if (!Array.isArray(items)) {
    return undefined;
  }

  const normalized: ActivityLogItem[] = [];
  for (const rawItem of items) {
    if (!isRecord(rawItem)) {
      continue;
    }

    const itemId = asString(rawItem.itemId);
    const name = asString(rawItem.name);
    const quantity = toNumber(rawItem.quantity);
    if (itemId === null || name === null || quantity === null) {
      continue;
    }

    const normalizedQuantity = Math.max(0, Math.floor(quantity));
    if (normalizedQuantity <= 0) {
      continue;
    }

    normalized.push({
      itemId,
      name,
      quantity: normalizedQuantity,
    });
  }

  return normalized.length > 0 ? normalized : undefined;
}

function isSeedOrDebugActivityLogEntry(entry: {
  id?: string | null;
  message?: string | null;
}): boolean {
  const id = entry.id?.trim() ?? '';
  if (
    id.length > 0 &&
    (SEED_ACTIVITY_LOG_ID_PATTERN.test(id) || DEBUG_ACTIVITY_LOG_ID_PATTERN.test(id))
  ) {
    return true;
  }

  const message = entry.message?.trim() ?? '';
  if (
    message.length > 0 &&
    (SEED_ACTIVITY_LOG_MESSAGE_PATTERN.test(message) ||
      DEBUG_ACTIVITY_LOG_MESSAGE_PATTERN.test(message))
  ) {
    return true;
  }

  return false;
}

function normalizeActivityLog(activityLog: unknown): ActivityLogEntry[] {
  if (!Array.isArray(activityLog)) {
    return [];
  }

  const normalized: ActivityLogEntry[] = [];
  for (const rawEntry of activityLog) {
    if (!isRecord(rawEntry)) {
      continue;
    }

    const type = asActivityLogType(rawEntry.type);
    const message = asString(rawEntry.message);
    if (type === null || message === null) {
      continue;
    }

    const timestamp = asString(rawEntry.timestamp) ?? new Date().toISOString();
    const id = asString(rawEntry.id) ?? `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    if (isSeedOrDebugActivityLogEntry({ id, message })) {
      continue;
    }

    const workerId = asString(rawEntry.workerId) ?? undefined;
    const workerName = asString(rawEntry.workerName) ?? undefined;
    const buildingType = asString(rawEntry.buildingType) ?? undefined;
    const taskCategory = asString(rawEntry.taskCategory) ?? undefined;
    const buildingLevelRaw = toNumber(rawEntry.buildingLevel);
    const durationMinutesRaw = toNumber(rawEntry.durationMinutes);
    const goldRaw = toNumber(rawEntry.gold);
    const xpRaw = toNumber(rawEntry.xp);
    const items = normalizeActivityLogItems(rawEntry.items);

    normalized.push({
      id,
      type,
      timestamp,
      ...(workerId !== undefined ? { workerId } : {}),
      ...(workerName !== undefined ? { workerName } : {}),
      ...(buildingType !== undefined ? { buildingType } : {}),
      ...(buildingLevelRaw !== null
        ? { buildingLevel: Math.max(0, Math.floor(buildingLevelRaw)) }
        : {}),
      ...(taskCategory !== undefined ? { taskCategory } : {}),
      ...(durationMinutesRaw !== null
        ? { durationMinutes: Math.max(0, Math.floor(durationMinutesRaw)) }
        : {}),
      ...(goldRaw !== null ? { gold: Math.floor(goldRaw) } : {}),
      ...(xpRaw !== null ? { xp: Math.floor(xpRaw) } : {}),
      ...(items !== undefined ? { items } : {}),
      message,
    });
  }

  if (normalized.length <= MAX_ACTIVITY_LOG_ENTRIES) {
    return normalized;
  }

  return normalized.slice(normalized.length - MAX_ACTIVITY_LOG_ENTRIES);
}

function resolveBuildingLabel(buildingType: unknown): string {
  if (
    typeof buildingType === 'string' &&
    Object.prototype.hasOwnProperty.call(BUILDING_LABELS, buildingType)
  ) {
    return BUILDING_LABELS[buildingType as GameState['buildings'][number]['type']];
  }

  return '建物';
}

function createActivityLogEntryId(timestamp: string): string {
  return `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function createActivityLogEntry(
  entry: Omit<ActivityLogEntry, 'id'> & { id?: string }
): ActivityLogEntry {
  const timestamp = asString(entry.timestamp) ?? new Date().toISOString();
  return {
    ...entry,
    id: asString(entry.id) ?? createActivityLogEntryId(timestamp),
    timestamp,
  };
}

function appendActivityLog(
  activityLog: unknown,
  ...entries: Array<ActivityLogEntry | null>
): ActivityLogEntry[] {
  const current = normalizeActivityLog(activityLog);
  const additions = entries.filter(
    (entry): entry is ActivityLogEntry =>
      entry !== null && !isSeedOrDebugActivityLogEntry({ id: entry.id, message: entry.message })
  );
  if (additions.length === 0) {
    return current;
  }

  const next = [...current, ...additions];
  if (next.length <= MAX_ACTIVITY_LOG_ENTRIES) {
    return next;
  }

  return next.slice(next.length - MAX_ACTIVITY_LOG_ENTRIES);
}

function includesAny(haystack: string, terms: string[]): boolean {
  return terms.some((term) => haystack.includes(term));
}

function hasAnalysisMissionSignal(normalizedText: string): boolean {
  const hasAnalysisWord = includesAny(normalizedText, [
    'analysis',
    'investigat',
    '調査',
    '分析',
    '解析',
    'review',
    'レビュー',
    '検証',
  ]);
  const hasMissionContext = includesAny(normalizedText, ['分析任務', '観点', 'analysis task']);
  return hasAnalysisWord && hasMissionContext;
}

function inferTaskCategory(task: LooseRecord): TaskCategory {
  const normalizedText = [
    asString(task.description) ?? '',
    asString(task.target_path) ?? '',
    asString(task.task_id) ?? '',
    asString(task.parent_cmd) ?? '',
  ]
    .join(' ')
    .toLowerCase();

  if (hasAnalysisMissionSignal(normalizedText)) {
    return 'analysis';
  }

  if (
    includesAny(normalizedText, [
      'docs',
      'document',
      'documentation',
      'doc',
      '文章',
      '文書',
      '文書化',
      'ドキュメント',
    ])
  ) {
    return 'docs';
  }

  if (
    includesAny(normalizedText, [
      'bug',
      'fix',
      'bugfix',
      '不具合',
      '不具合修正',
      '修正',
      '障害',
      'バグ',
      'バグ修正',
    ])
  ) {
    return 'bug_fix';
  }
  if (includesAny(normalizedText, ['test', 'qa', '検証', 'テスト', '試験'])) {
    return 'test';
  }
  if (includesAny(normalizedText, ['refactor', '改修', 'リファクタ', 'リファクタリング', '整理'])) {
    return 'refactoring';
  }
  if (includesAny(normalizedText, ['skill', 'スキル', '技'])) {
    return 'skill_creation';
  }
  if (
    includesAny(normalizedText, [
      'analysis',
      'investigat',
      '調査',
      '分析',
      '解析',
      'review',
      'レビュー',
    ])
  ) {
    return 'analysis';
  }
  if (includesAny(normalizedText, ['idle', '待機'])) {
    return 'idle';
  }
  if (
    includesAny(normalizedText, [
      'implement',
      'feature',
      '新機能',
      '機能追加',
      '新規実装',
      '実装',
      'ui',
      'web',
    ])
  ) {
    return 'new_implementation';
  }

  return 'other';
}

function inferCategoryFromText(sourceText: string): TaskCategory {
  const normalizedText = sourceText.toLowerCase();

  if (hasAnalysisMissionSignal(normalizedText)) {
    return 'analysis';
  }

  if (
    includesAny(normalizedText, [
      'docs',
      'document',
      'documentation',
      'doc',
      '文章',
      '文書',
      '文書化',
      'ドキュメント',
    ])
  ) {
    return 'docs';
  }
  if (
    includesAny(normalizedText, [
      '不具合修正',
      '不具合',
      '修正',
      'バグ修正',
      'バグ',
      'bug',
      'fix',
      'bugfix',
    ])
  ) {
    return 'bug_fix';
  }
  if (
    includesAny(normalizedText, [
      '新機能',
      '機能追加',
      '新規実装',
      '実装',
      'implement',
      'feature',
      'frontend',
      'backend',
      'web',
    ])
  ) {
    return 'new_implementation';
  }
  if (includesAny(normalizedText, ['リファクタ', 'リファクタリング', '改修', 'refactor'])) {
    return 'refactoring';
  }
  if (includesAny(normalizedText, ['テスト', '検証', '試験', 'test', 'qa'])) {
    return 'test';
  }
  if (
    includesAny(normalizedText, [
      '調査',
      '分析',
      '解析',
      'analysis',
      'investigat',
      'review',
      'レビュー',
    ])
  ) {
    return 'analysis';
  }
  if (includesAny(normalizedText, ['スキル', 'skill', '技作成', '技'])) {
    return 'skill_creation';
  }
  if (includesAny(normalizedText, ['待機', 'idle'])) {
    return 'idle';
  }

  return 'other';
}

function getDurationMinutes(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return 0;
}

function getTaskCategoryByTaskId(taskSnapshots: LooseRecord[]): Map<string, TaskCategory> {
  const taskCategoryByTaskId = new Map<string, TaskCategory>();

  for (const snapshot of taskSnapshots) {
    const task = isRecord(snapshot.task) ? snapshot.task : null;
    if (task === null) {
      continue;
    }

    const taskId = asString(task.task_id);
    if (taskId === null) {
      continue;
    }

    const category = asTaskCategory(task.category) ?? inferTaskCategory(task);
    taskCategoryByTaskId.set(taskId, category);
  }

  return taskCategoryByTaskId;
}

interface BackfillTaskRewardContext {
  category: TaskCategory;
  assignedAt: string | null;
}

function getTaskRewardContextByTaskId(
  taskSnapshots: LooseRecord[]
): Map<string, BackfillTaskRewardContext> {
  const contextByTaskId = new Map<string, BackfillTaskRewardContext>();

  for (const snapshot of taskSnapshots) {
    const task = isRecord(snapshot.task) ? snapshot.task : null;
    if (task === null) {
      continue;
    }

    const taskId = asString(task.task_id);
    if (taskId === null) {
      continue;
    }

    const category = asTaskCategory(task.category) ?? inferTaskCategory(task);
    contextByTaskId.set(taskId, {
      category,
      assignedAt: asString(task.timestamp),
    });
  }

  return contextByTaskId;
}

function inferCategoryFromReport(
  report: LooseRecord,
  taskCategoryByTaskId: Map<string, TaskCategory>
): TaskCategory {
  const directCategory = asTaskCategory(report.category);
  if (directCategory !== null) {
    return directCategory;
  }

  const taskId = asString(report.task_id);
  if (taskId !== null) {
    const fromTask = taskCategoryByTaskId.get(taskId);
    if (fromTask !== undefined) {
      return fromTask;
    }
  }

  const result = isRecord(report.result) ? report.result : {};
  const categoryInResult = asTaskCategory(result.category);
  if (categoryInResult !== null) {
    return categoryInResult;
  }

  const text = [
    asString(report.task_id) ?? '',
    asString(report.parent_cmd) ?? '',
    asString(report.summary) ?? '',
    asString(report.description) ?? '',
    asString(result.summary) ?? '',
    asString(result.notes) ?? '',
  ]
    .join(' ')
    .trim();

  return inferCategoryFromText(text);
}

function normalizeMissionReportSnapshot(
  report: LooseRecord,
  taskCategoryByTaskId: Map<string, TaskCategory>
): MissionReportSnapshot | null {
  const status = normalizeReportStatus(report.status);
  if (status === null) {
    return null;
  }

  const result = isRecord(report.result) ? report.result : {};
  const timestampRaw = asString(report.timestamp);
  const parsedTimestamp = timestampRaw !== null ? Date.parse(timestampRaw) : Number.NaN;

  return {
    status,
    timestampMs: Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0,
    category: inferCategoryFromReport(report, taskCategoryByTaskId),
    durationMinutes:
      getDurationMinutes(report.durationMinutes) ||
      getDurationMinutes(report.duration_minutes) ||
      getDurationMinutes(result.durationMinutes) ||
      getDurationMinutes(result.duration_minutes),
  };
}

function buildMissionHistory(
  taskSnapshots: LooseRecord[],
  reportSnapshots: LooseRecord[]
): MissionHistory {
  const taskCategoryByTaskId = getTaskCategoryByTaskId(taskSnapshots);
  const reports = reportSnapshots
    .map((report, index) => {
      const normalized = normalizeMissionReportSnapshot(report, taskCategoryByTaskId);
      if (normalized === null) {
        return null;
      }

      return {
        ...normalized,
        index,
      };
    })
    .filter((report): report is MissionReportSnapshot & { index: number } => report !== null)
    .sort((left, right) => left.timestampMs - right.timestampMs || left.index - right.index);

  let currentStreak = 0;
  let bestStreak = 0;
  const completedTasks: MissionHistory['tasks'] = [];

  for (const report of reports) {
    if (report.status === 'done') {
      completedTasks.push({
        category: report.category,
        durationMinutes: report.durationMinutes,
      });
      currentStreak += 1;
      bestStreak = Math.max(bestStreak, currentStreak);
      continue;
    }

    currentStreak = 0;
  }

  return {
    tasks: completedTasks,
    currentStreak,
    bestStreak,
  };
}

function resolveMissionTaskCategories(definition: MissionDefinition): TaskCategory[] {
  const categories: TaskCategory[] = [];
  for (const condition of definition.conditions) {
    if (condition.type !== 'task_count') {
      continue;
    }
    if (categories.includes(condition.category)) {
      continue;
    }
    categories.push(condition.category);
  }
  return categories;
}

function buildRecentMissionCategoryCounts(history: MissionHistory): Map<TaskCategory, number> {
  const counts = new Map<TaskCategory, number>();
  const recentTasks = history.tasks.slice(-MISSION_CATEGORY_HISTORY_WINDOW);
  for (const task of recentTasks) {
    counts.set(task.category, (counts.get(task.category) ?? 0) + 1);
  }
  return counts;
}

function getMissionSelectionWeight(
  definition: MissionDefinition,
  recentCategoryCounts: ReadonlyMap<TaskCategory, number>
): number {
  const categories = resolveMissionTaskCategories(definition);
  if (categories.length === 0) {
    return 1;
  }

  const scarcityScoreTotal = categories.reduce((total, category) => {
    const recentCount = recentCategoryCounts.get(category) ?? 0;
    return total + 1 / (1 + recentCount);
  }, 0);

  return scarcityScoreTotal / categories.length;
}

function selectActiveMissionDefinitions(
  missions: GameState['missions'],
  recentCategoryCounts: ReadonlyMap<TaskCategory, number>
): MissionDefinition[] {
  const definitionById = new Map(
    DEFAULT_MISSION_DEFINITIONS.map((definition) => [definition.id, definition])
  );
  const targetCount = Math.min(MAX_ACTIVE_MISSION_COUNT, DEFAULT_MISSION_DEFINITIONS.length);
  const minimumCount = Math.min(MIN_ACTIVE_MISSION_COUNT, DEFAULT_MISSION_DEFINITIONS.length);
  const selectedIds = new Set<string>();
  const selected: MissionDefinition[] = [];

  const pushDefinition = (definition: MissionDefinition | undefined): void => {
    if (
      definition === undefined ||
      selectedIds.has(definition.id) ||
      selected.length >= targetCount
    ) {
      return;
    }
    selectedIds.add(definition.id);
    selected.push(definition);
  };

  for (const mission of missions) {
    pushDefinition(definitionById.get(mission.id));
  }

  for (const missionId of REQUIRED_DEPLOYED_MISSION_IDS) {
    pushDefinition(definitionById.get(missionId));
  }

  const weightedCandidates = DEFAULT_MISSION_DEFINITIONS.filter(
    (definition) => !selectedIds.has(definition.id)
  )
    .map((definition) => ({
      definition,
      weight: getMissionSelectionWeight(definition, recentCategoryCounts),
    }))
    .sort(
      (left, right) =>
        right.weight - left.weight || left.definition.id.localeCompare(right.definition.id)
    );

  for (const candidate of weightedCandidates) {
    pushDefinition(candidate.definition);
  }

  if (selected.length < minimumCount) {
    for (const definition of DEFAULT_MISSION_DEFINITIONS) {
      pushDefinition(definition);
      if (selected.length >= minimumCount) {
        break;
      }
    }
  }

  return selected;
}

function withMissionProgress(
  missions: GameState['missions'],
  taskSnapshots: LooseRecord[],
  reportSnapshots: LooseRecord[]
): GameState['missions'] {
  const history = buildMissionHistory(taskSnapshots, reportSnapshots);
  const recentCategoryCounts = buildRecentMissionCategoryCounts(history);
  const activeDefinitions = selectActiveMissionDefinitions(missions, recentCategoryCounts);
  const existingById = new Map<string, GameState['missions'][number]>();

  for (const mission of missions) {
    if (!existingById.has(mission.id)) {
      existingById.set(mission.id, mission);
    }
  }

  const normalizeMissionProgress = (
    progress: GameState['missions'][number]['progress'],
    claimed: boolean
  ): GameState['missions'][number]['progress'] => {
    const target = Math.max(1, toSafeInt(progress.target));
    const current = Math.min(target, toSafeInt(progress.current));
    return {
      current: claimed ? target : current,
      target,
    };
  };

  return activeDefinitions.map((definition) => {
    const { progress } = checkMission(definition, history);
    const normalized = toMissionState(definition, history);
    const existing = existingById.get(definition.id);
    if (existing !== undefined) {
      const claimed = existing.claimed ?? normalized.claimed ?? false;
      return {
        ...normalized,
        claimed,
        resetAt: existing.resetAt ?? normalized.resetAt,
        period: existing.period ?? normalized.period,
        progress: normalizeMissionProgress(progress, claimed === true),
      };
    }

    const claimed = normalized.claimed ?? false;
    return {
      ...normalized,
      claimed,
      progress: normalizeMissionProgress(progress, claimed === true),
    };
  });
}

function normalizeTaskStatus(status: unknown): ServerTaskUpdatePayload['status'] | null {
  const normalized = asString(status);
  if (normalized === null) {
    return null;
  }

  switch (normalized) {
    case 'assigned':
    case 'in_progress':
    case 'done':
    case 'failed':
    case 'blocked':
      return normalized;
    case 'idle':
      // queue/tasks/*.yaml can mark an agent as idle after completion.
      // Normalize this terminal state to done so clients clear "working" UI.
      return 'done';
    default:
      return null;
  }
}

function normalizeReportStatus(status: unknown): ServerReportUpdatePayload['status'] | null {
  const normalized = asString(status);
  if (normalized === null) {
    return null;
  }

  switch (normalized) {
    case 'done':
    case 'failed':
    case 'blocked':
      return normalized;
    default:
      return null;
  }
}

function toTaskPayload(
  entry: LooseRecord,
  commandTitleById: ReadonlyMap<string, string> = commandTitleByIdCache
): ServerTaskUpdatePayload | null {
  const workerId = normalizeWorkerId(entry.workerId);
  if (workerId === null || !isRecord(entry.task)) {
    return null;
  }

  const task = entry.task;
  const taskId = asString(task.task_id);
  const status = normalizeTaskStatus(task.status);
  if (taskId === null || status === null) {
    return null;
  }

  return {
    taskId,
    taskTitle: resolveTaskTitle(task, commandTitleById),
    assigneeId: workerId,
    category: inferTaskCategory(task),
    status,
    updatedAt: asTimestamp(task.timestamp),
  };
}

function toReportPayload(entry: LooseRecord): ServerReportUpdatePayload | null {
  const workerId = normalizeReportWorkerId(entry.worker_id ?? entry.workerId);
  const taskId = asString(entry.task_id);
  const status = normalizeReportStatus(entry.status);
  if (workerId === null || taskId === null || status === null) {
    return null;
  }

  const result = isRecord(entry.result) ? entry.result : {};
  const summary =
    asString(result.summary) ??
    asString(entry.summary) ??
    (status === 'done' ? '任務完了' : status === 'blocked' ? '作業阻害あり' : '作業失敗');
  const createdAt = asTimestamp(entry.timestamp);

  return {
    reportId: `${workerId}:${taskId}:${createdAt}`,
    taskId,
    workerId,
    status,
    summary,
    createdAt,
  };
}

function isTaskTerminalReportStatus(status: ServerReportUpdatePayload['status']): boolean {
  return status === 'done' || status === 'failed';
}

function toWorkerTaskKey(workerId: WorkerId, taskId: string): string {
  return `${workerId}:${taskId}`;
}

function getTerminalReportTaskKeys(
  reports: Iterable<Pick<ServerReportUpdatePayload, 'workerId' | 'taskId' | 'status'>>
): Set<string> {
  const keys = new Set<string>();

  for (const report of reports) {
    if (!isTaskTerminalReportStatus(report.status)) {
      continue;
    }

    const workerId = normalizeWorkerId(report.workerId);
    if (workerId === null) {
      continue;
    }

    keys.add(toWorkerTaskKey(workerId, report.taskId));
  }

  return keys;
}

function getTerminalReportTaskKeysFromSnapshots(reportSnapshots: LooseRecord[]): Set<string> {
  const reports = reportSnapshots
    .map(toReportPayload)
    .filter((report): report is ServerReportUpdatePayload => report !== null);

  return getTerminalReportTaskKeys(reports);
}

function sanitizeTaskByTerminalReport(
  task: ServerTaskUpdatePayload,
  terminalReportTaskKeys: ReadonlySet<string>
): ServerTaskUpdatePayload {
  if (task.status !== 'assigned') {
    return task;
  }

  const workerId = normalizeWorkerId(task.assigneeId);
  if (workerId === null) {
    return task;
  }

  if (!terminalReportTaskKeys.has(toWorkerTaskKey(workerId, task.taskId))) {
    return task;
  }

  return {
    ...task,
    status: 'done',
  };
}

function sanitizeTasksByTerminalReports(
  tasks: ServerTaskUpdatePayload[],
  terminalReportTaskKeys: ReadonlySet<string>
): ServerTaskUpdatePayload[] {
  if (terminalReportTaskKeys.size === 0) {
    return tasks;
  }

  let changed = false;
  const sanitized = tasks.map((task) => {
    const nextTask = sanitizeTaskByTerminalReport(task, terminalReportTaskKeys);
    if (nextTask !== task) {
      changed = true;
    }
    return nextTask;
  });

  return changed ? sanitized : tasks;
}

function toMemberStatus(
  task: ServerTaskUpdatePayload | null,
  fallback: AshigaruStatus | null
): AshigaruStatus {
  if (task === null) {
    return fallback === 'offline' ? 'offline' : 'idle';
  }

  if (task?.status === 'failed' || task?.status === 'blocked') {
    return 'blocked';
  }
  if (task?.status === 'assigned' || task?.status === 'in_progress') {
    return 'working';
  }

  return 'idle';
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolveTownLevel(xp: number): number {
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
}

function isBuildingType(value: unknown): value is GameState['buildings'][number]['type'] {
  return (
    typeof value === 'string' &&
    BUILDING_TYPES.includes(value as GameState['buildings'][number]['type'])
  );
}

function normalizeBuildingLevel(value: unknown): BuildingLevel {
  const numeric = typeof value === 'number' ? Math.floor(value) : 1;
  if (numeric <= 1) {
    return 1;
  }
  if (numeric >= 5) {
    return 5;
  }
  return numeric as BuildingLevel;
}

function clampBuildingPosition(
  position: { x: number; y: number },
  footprint: { width: number; height: number }
): { x: number; y: number } {
  const maxX = Math.max(0, DECORATION_MAP_WIDTH - footprint.width);
  const maxY = Math.max(0, DECORATION_MAP_HEIGHT - footprint.height);

  return {
    x: Math.min(Math.max(Math.floor(position.x), 0), maxX),
    y: Math.min(Math.max(Math.floor(position.y), 0), maxY),
  };
}

function canPlaceBuildingFootprint(
  position: { x: number; y: number },
  footprint: { width: number; height: number },
  occupiedTiles: Set<string>
): boolean {
  for (let offsetY = 0; offsetY < footprint.height; offsetY += 1) {
    for (let offsetX = 0; offsetX < footprint.width; offsetX += 1) {
      const tileX = position.x + offsetX;
      const tileY = position.y + offsetY;
      if (!isDecorationTileInsideMap(tileX, tileY)) {
        return false;
      }

      if (occupiedTiles.has(toDecorationTileKey(tileX, tileY))) {
        return false;
      }
    }
  }

  return true;
}

function reserveBuildingFootprint(
  position: { x: number; y: number },
  footprint: { width: number; height: number },
  occupiedTiles: Set<string>
): void {
  for (let offsetY = 0; offsetY < footprint.height; offsetY += 1) {
    for (let offsetX = 0; offsetX < footprint.width; offsetX += 1) {
      occupiedTiles.add(toDecorationTileKey(position.x + offsetX, position.y + offsetY));
    }
  }
}

function resolveNearestAvailableBuildingPosition(
  requested: { x: number; y: number },
  footprint: { width: number; height: number },
  occupiedTiles: Set<string>
): { x: number; y: number } | null {
  const origin = clampBuildingPosition(requested, footprint);
  const originKey = toDecorationTileKey(origin.x, origin.y);

  if (canPlaceBuildingFootprint(origin, footprint, occupiedTiles)) {
    return origin;
  }

  const queue: Array<{ x: number; y: number }> = [origin];
  const visited = new Set<string>([originKey]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    for (const offset of BUILDING_NEIGHBOR_OFFSETS) {
      const next = clampBuildingPosition(
        { x: current.x + offset.x, y: current.y + offset.y },
        footprint
      );
      const key = toDecorationTileKey(next.x, next.y);
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);

      if (canPlaceBuildingFootprint(next, footprint, occupiedTiles)) {
        return next;
      }

      queue.push(next);
    }
  }

  return null;
}

function normalizeBuildings(rawBuildings: unknown): GameState['buildings'] {
  const requestedByType = new Map<
    GameState['buildings'][number]['type'],
    {
      level: BuildingLevel;
      position: { x: number; y: number };
    }
  >();

  if (Array.isArray(rawBuildings)) {
    for (const rawBuilding of rawBuildings) {
      if (!isRecord(rawBuilding) || !isBuildingType(rawBuilding.type)) {
        continue;
      }

      const type = rawBuilding.type;
      const positionSource = isRecord(rawBuilding.position) ? rawBuilding.position : {};
      const nextLevel = normalizeBuildingLevel(rawBuilding.level);
      const fallback = DEFAULT_BUILDING_POSITIONS[type];
      const nextPosition = {
        x: toNumber(positionSource.x) ?? fallback.x,
        y: toNumber(positionSource.y) ?? fallback.y,
      };

      const existing = requestedByType.get(type);
      if (!existing) {
        requestedByType.set(type, {
          level: nextLevel,
          position: nextPosition,
        });
        continue;
      }

      requestedByType.set(type, {
        level: Math.max(existing.level, nextLevel) as BuildingLevel,
        position: existing.position,
      });
    }
  }

  const occupiedTiles = new Set<string>();
  const normalized: GameState['buildings'] = [];
  for (const type of BUILDING_TYPES) {
    const requested = requestedByType.get(type) ?? {
      level: 1 as BuildingLevel,
      position: DEFAULT_BUILDING_POSITIONS[type],
    };

    const footprint = BUILDING_FOOTPRINTS[type];
    const resolvedPosition =
      resolveNearestAvailableBuildingPosition(requested.position, footprint, occupiedTiles) ??
      resolveNearestAvailableBuildingPosition(
        DEFAULT_BUILDING_POSITIONS[type],
        footprint,
        occupiedTiles
      );

    if (!resolvedPosition) {
      continue;
    }

    reserveBuildingFootprint(resolvedPosition, footprint, occupiedTiles);
    normalized.push({
      type,
      level: requested.level,
      position: resolvedPosition,
    });
  }

  return normalized;
}

function resolveAshigaruAssignmentState(
  existing: LooseRecord,
  task: ServerTaskUpdatePayload | null
): Pick<GameState['ashigaru'][number], 'status' | 'taskId' | 'taskCategory' | 'assignedAt'> {
  const existingTaskId = asString(existing.taskId);
  const existingAssignedAt = asString(existing.assignedAt);
  const fallbackStatus = asAshigaruStatus(existing.status);
  const activeTask = isActiveTask(task);

  return {
    status: toMemberStatus(task, fallbackStatus),
    taskId: activeTask ? task.taskId : null,
    taskCategory: activeTask ? task.category : 'idle',
    assignedAt: activeTask
      ? task.taskId === existingTaskId
        ? (existingAssignedAt ?? task.updatedAt)
        : task.updatedAt
      : null,
  };
}

function getTaskByWorkerFromSnapshots(
  taskSnapshots: LooseRecord[],
  terminalReportTaskKeys: ReadonlySet<string> = new Set<string>()
): ReadonlyMap<WorkerId, ServerTaskUpdatePayload> {
  const taskByWorker = new Map<WorkerId, ServerTaskUpdatePayload>();

  for (const snapshot of taskSnapshots) {
    const task = toTaskPayload(snapshot, commandTitleByIdCache);
    if (task === null) {
      continue;
    }

    const workerId = normalizeWorkerId(task.assigneeId);
    if (workerId === null) {
      continue;
    }

    const existing = taskByWorker.get(workerId);
    const taskUpdatedAtMs = toTimestampMs(task.updatedAt) ?? -1;
    const existingUpdatedAtMs = toTimestampMs(existing?.updatedAt) ?? -1;
    if (existing === undefined || taskUpdatedAtMs >= existingUpdatedAtMs) {
      taskByWorker.set(workerId, sanitizeTaskByTerminalReport(task, terminalReportTaskKeys));
    }
  }

  return taskByWorker;
}

function normalizeAshigaruForPersistence(
  rawAshigaru: unknown,
  taskByWorker: ReadonlyMap<WorkerId, ServerTaskUpdatePayload> = new Map()
): GameState['ashigaru'] {
  const existingMembers = Array.isArray(rawAshigaru) ? rawAshigaru.filter(isRecord) : [];
  const byId = new Map<WorkerId, LooseRecord>();
  for (const member of existingMembers) {
    const workerId = normalizeWorkerId(member.id);
    if (workerId !== null) {
      byId.set(workerId, member);
    }
  }

  return WORKER_IDS.map((workerId, index) => {
    const existing = byId.get(workerId) ?? {};
    const task = taskByWorker.get(workerId) ?? null;
    const positionSource = isRecord(existing.position) ? existing.position : null;
    const defaultPosition = buildDefaultPosition(index);
    const assignment = resolveAshigaruAssignmentState(existing, task);

    return {
      id: workerId,
      name: asString(existing.name) ?? WORKER_LABELS[workerId],
      status: assignment.status,
      taskId: assignment.taskId,
      taskCategory: assignment.taskCategory,
      assignedAt: assignment.assignedAt,
      position: {
        x: toNumber(positionSource?.x) ?? defaultPosition.x,
        y: toNumber(positionSource?.y) ?? defaultPosition.y,
      },
    };
  });
}

async function sanitizeGameStateForPersistence(state: LooseRecord): Promise<LooseRecord> {
  const [taskSnapshots, reportSnapshots] = await Promise.all([
    getTaskSnapshotsCached(),
    getReportSnapshotsCached(),
  ]);
  const terminalReportTaskKeys = getTerminalReportTaskKeysFromSnapshots(reportSnapshots);
  const taskByWorker = getTaskByWorkerFromSnapshots(taskSnapshots, terminalReportTaskKeys);
  const town = normalizeTown(state.town, resolveEconomyGold(state.economy));
  const buildings = normalizeBuildings(state.buildings);
  const decorations = normalizeDecorationsForState(state.decorations, buildings);
  const inventory = normalizeInventory(state.inventory, getDefaultInventory());
  const missions = Array.isArray(state.missions) ? state.missions : [];
  const activityLog = normalizeActivityLog(state.activityLog);
  const titles = normalizeTitles(state.titles);
  const materialCollection = mergeMaterialCollectionFromInventory(
    normalizeMaterialCollection(state.materialCollection),
    inventory
  );
  const baseGameState: GameState = {
    ashigaru: normalizeAshigaruForPersistence(state.ashigaru, taskByWorker),
    buildings,
    town,
    economy: {
      ...(isRecord(state.economy) ? state.economy : {}),
      gold: town.gold,
    },
    inventory,
    decorations,
    missions: missions as GameState['missions'],
    activityLog,
    achievements: normalizeAchievements(state.achievements),
    titles,
    equippedTitle: normalizeEquippedTitle(state.equippedTitle, titles),
    dailyRecords: normalizeDailyRecords(state.dailyRecords),
    materialCollection,
    lastMaterialDrop: normalizeLastMaterialDrop(state.lastMaterialDrop),
  };
  const gamificationState = applyGamificationState(baseGameState);

  return {
    ...state,
    ...baseGameState,
    ...gamificationState,
  };
}

function toDecorationTileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function isDecorationTileInsideMap(x: number, y: number): boolean {
  return x >= 0 && x < DECORATION_MAP_WIDTH && y >= 0 && y < DECORATION_MAP_HEIGHT;
}

function clampDecorationPosition(position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.min(Math.max(Math.floor(position.x), 0), DECORATION_MAP_WIDTH - 1),
    y: Math.min(Math.max(Math.floor(position.y), 0), DECORATION_MAP_HEIGHT - 1),
  };
}

function createBuildingOccupiedTiles(buildings: GameState['buildings']): Set<string> {
  const occupied = new Set<string>();
  for (const building of buildings) {
    const footprint = BUILDING_FOOTPRINTS[building.type];
    const baseX = Math.floor(building.position.x);
    const baseY = Math.floor(building.position.y);

    for (let offsetY = 0; offsetY < footprint.height; offsetY += 1) {
      for (let offsetX = 0; offsetX < footprint.width; offsetX += 1) {
        const tileX = baseX + offsetX;
        const tileY = baseY + offsetY;
        if (!isDecorationTileInsideMap(tileX, tileY)) {
          continue;
        }

        occupied.add(toDecorationTileKey(tileX, tileY));
      }
    }
  }

  return occupied;
}

function resolveNearestAvailableDecorationPosition(
  requested: { x: number; y: number },
  blockedTiles: Set<string>
): { x: number; y: number } | null {
  const origin = clampDecorationPosition(requested);
  const originKey = toDecorationTileKey(origin.x, origin.y);
  if (!blockedTiles.has(originKey)) {
    return origin;
  }

  const queue: Array<{ x: number; y: number }> = [origin];
  const visited = new Set<string>([originKey]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    for (const offset of DECORATION_NEIGHBOR_OFFSETS) {
      const nextX = current.x + offset.x;
      const nextY = current.y + offset.y;
      if (!isDecorationTileInsideMap(nextX, nextY)) {
        continue;
      }

      const nextKey = toDecorationTileKey(nextX, nextY);
      if (visited.has(nextKey)) {
        continue;
      }

      if (!blockedTiles.has(nextKey)) {
        return { x: nextX, y: nextY };
      }

      visited.add(nextKey);
      queue.push({ x: nextX, y: nextY });
    }
  }

  return null;
}

function normalizeDecorationsForState(
  rawDecorations: unknown,
  buildings: GameState['buildings']
): GameState['decorations'] {
  if (!Array.isArray(rawDecorations)) {
    return [];
  }

  const normalized: GameState['decorations'] = [];
  const seenIds = new Set<string>();
  const occupiedTiles = createBuildingOccupiedTiles(buildings);

  for (const rawDecoration of rawDecorations) {
    if (!isRecord(rawDecoration)) {
      continue;
    }

    const id = asString(rawDecoration.id);
    const type = asString(rawDecoration.type);
    const positionSource = isRecord(rawDecoration.position) ? rawDecoration.position : null;
    const rawX = toNumber(positionSource?.x);
    const rawY = toNumber(positionSource?.y);
    if (id === null || id.length === 0 || type === null || type.length === 0 || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);

    const levelSource = toNumber(rawDecoration.level);
    const level =
      levelSource !== null && levelSource >= 1
        ? Math.min(5, Math.floor(levelSource))
        : undefined;
    const fallbackPassiveEffect = DECORATION_PASSIVE_EFFECT_BY_TYPE[type];
    const passiveSource = isRecord(rawDecoration.passiveEffect) ? rawDecoration.passiveEffect : null;
    const passiveType = asString(passiveSource?.type);
    const passiveBonus = toNumber(passiveSource?.bonusPerLevel);
    const normalizedPassiveType =
      passiveType === 'gold_bonus' || passiveType === 'xp_bonus' || passiveType === 'drop_rate_bonus'
        ? passiveType
        : fallbackPassiveEffect?.type;
    const normalizedPassiveBonus =
      passiveBonus !== null && passiveBonus > 0
        ? passiveBonus
        : fallbackPassiveEffect?.bonusPerLevel ?? DEFAULT_DECORATION_PASSIVE_BONUS_PER_LEVEL;
    const passiveEffect =
      normalizedPassiveType === undefined
        ? undefined
        : {
            type: normalizedPassiveType,
            bonusPerLevel: normalizedPassiveBonus,
          };
    const normalizedDecoration: GameState['decorations'][number] = {
      id,
      type,
      ...(level !== undefined ? { level } : {}),
      ...(passiveEffect !== undefined ? { passiveEffect } : {}),
    };

    if (rawX === null || rawY === null) {
      normalized.push(normalizedDecoration);
      continue;
    }

    const nextPosition = resolveNearestAvailableDecorationPosition(
      { x: rawX, y: rawY },
      occupiedTiles
    );
    if (nextPosition === null) {
      continue;
    }

    occupiedTiles.add(toDecorationTileKey(nextPosition.x, nextPosition.y));
    normalized.push({
      ...normalizedDecoration,
      position: nextPosition,
    });
  }

  return normalized;
}

function toTimestampMs(value: unknown): number | null {
  const timestamp = asString(value);
  if (timestamp === null) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function getElapsedMinutes(startedAt: unknown, completedAt: unknown): number {
  const startedAtMs = toTimestampMs(startedAt);
  const completedAtMs = toTimestampMs(completedAt);
  if (startedAtMs === null || completedAtMs === null || completedAtMs < startedAtMs) {
    return 0;
  }

  const elapsedMs = completedAtMs - startedAtMs;
  if (elapsedMs <= 0) {
    return 0;
  }

  return Math.ceil(elapsedMs / 60000);
}

interface CompletionRewardContext {
  assignedAt: string;
  category: TaskCategory;
}

function resolveCompletionRewardContextFromWorkStart(params: {
  activityLog: ActivityLogEntry[];
  workerId: WorkerId;
  completedAt: string;
  fallbackCategory: TaskCategory;
}): CompletionRewardContext | null {
  const completedAtMs = toTimestampMs(params.completedAt);
  if (completedAtMs === null) {
    return null;
  }

  let latestStartedAtMs = Number.NEGATIVE_INFINITY;
  let latestContext: CompletionRewardContext | null = null;

  for (const entry of params.activityLog) {
    if (entry.type !== 'work_start') {
      continue;
    }

    if (normalizeWorkerId(entry.workerId) !== params.workerId) {
      continue;
    }

    const startedAtMs = toTimestampMs(entry.timestamp);
    if (startedAtMs === null || startedAtMs > completedAtMs) {
      continue;
    }

    if (startedAtMs <= latestStartedAtMs) {
      continue;
    }

    latestStartedAtMs = startedAtMs;
    latestContext = {
      assignedAt: entry.timestamp,
      category: asTaskCategory(entry.taskCategory) ?? params.fallbackCategory,
    };
  }

  return latestContext;
}

function calculateTimeBasedReward(
  minutes: number,
  buildingLevel: BuildingLevel
): {
  rewardGold: number;
  rewardXp: number;
} {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  return {
    rewardGold: safeMinutes * buildingLevel * GOLD_RATE_PER_MIN,
    rewardXp: safeMinutes * buildingLevel * XP_RATE_PER_MIN,
  };
}

function resolveRewardBuildingType(category: TaskCategory): RewardBuildingType {
  return TASK_CATEGORY_TO_REWARD_BUILDING[category];
}

function isNonProductiveTaskCategory(category: TaskCategory): boolean {
  return resolveRewardBuildingType(category) === 'inn';
}

function isUpgradeCostBuildingType(value: unknown): value is UpgradeCostBuildingType {
  if (typeof value !== 'string') {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(UPGRADE_COST_TABLE, value)) {
    return false;
  }

  return value !== 'inn';
}

function toUpgradeCostLevel(value: unknown): UpgradeCostLevel | null {
  const numeric =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.floor(value)
      : typeof value === 'string' && value.trim().length > 0
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (numeric === 1 || numeric === 2 || numeric === 3 || numeric === 4) {
    return numeric;
  }

  return null;
}

function findBuildingLevel(
  buildings: GameState['buildings'],
  buildingId: UpgradeCostBuildingType
): BuildingLevel {
  const matched = buildings.find((building) => building.type === buildingId);
  return matched?.level ?? 1;
}

function resolveUpgradeCost(
  buildingId: UpgradeCostBuildingType,
  currentLevel: BuildingLevel
): UpgradeCost | null {
  if (buildingId === 'inn') {
    return null;
  }

  const fromLevel = toUpgradeCostLevel(currentLevel);
  if (fromLevel === null) {
    return null;
  }

  const byLevel = UPGRADE_COST_TABLE[buildingId];
  const levelCost = byLevel[fromLevel];
  if (levelCost === undefined) {
    return null;
  }

  return {
    buildingId,
    fromLevel,
    toLevel: normalizeBuildingLevel(fromLevel + 1),
    gold: levelCost.gold,
    materials: levelCost.materials,
  };
}

function collectMissingUpgradeMaterials(
  inventoryMap: Map<string, InventoryItem>,
  materials: UpgradeMaterialCost[]
): UpgradeMaterialMissing[] {
  const missing: UpgradeMaterialMissing[] = [];
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
}

function applyUpgradeMaterialCost(
  inventoryMap: Map<string, InventoryItem>,
  materials: UpgradeMaterialCost[]
): void {
  for (const material of materials) {
    const required = Math.max(0, Math.floor(material.quantity));
    if (required <= 0) {
      continue;
    }

    const entry = inventoryMap.get(material.itemId);
    if (entry === undefined) {
      continue;
    }

    const nextQuantity = Math.max(0, entry.quantity - required);
    if (nextQuantity <= 0) {
      inventoryMap.delete(material.itemId);
      continue;
    }

    inventoryMap.set(material.itemId, {
      ...entry,
      quantity: nextQuantity,
    });
  }
}

function formatUpgradeCost(cost: UpgradeCost): {
  buildingId: UpgradeCostBuildingType;
  fromLevel: UpgradeCostLevel;
  toLevel: BuildingLevel;
  gold: number;
  materials: Array<{ id: string; name: string; quantity: number }>;
} {
  return {
    buildingId: cost.buildingId,
    fromLevel: cost.fromLevel,
    toLevel: cost.toLevel,
    gold: cost.gold,
    materials: cost.materials.map((material) => ({
      id: material.itemId,
      name: ITEM_MASTER_BY_ID.get(material.itemId)?.name ?? material.itemId,
      quantity: material.quantity,
    })),
  };
}

function toBuildingState(buildingId: UpgradeCostBuildingType, level: BuildingLevel): BuildingState {
  const config = BUILDING_CONFIGS[buildingId];
  return {
    type: config.type,
    label: config.label,
    emoji: config.emoji,
    level,
  };
}

function resolveTaskCategoriesByBuilding(buildingId: UpgradeCostBuildingType): TaskCategory[] {
  if (buildingId === 'inn') {
    return [];
  }

  return TASK_CATEGORIES.filter(
    (category) => TASK_CATEGORY_TO_REWARD_BUILDING[category] === buildingId
  );
}

function resolveBuildingProductionProfile(
  buildingId: UpgradeCostBuildingType,
  buildingLevel: BuildingLevel
): {
  taskCategories: TaskCategory[];
  rewardGoldPerMinute: number;
  rewardXpPerMinute: number;
  materialDropCountPerCompletion: number;
} {
  if (buildingId === 'inn') {
    return {
      taskCategories: [],
      rewardGoldPerMinute: 0,
      rewardXpPerMinute: 0,
      materialDropCountPerCompletion: 0,
    };
  }

  const perMinuteReward = calculateTimeBasedReward(1, buildingLevel);
  return {
    taskCategories: resolveTaskCategoriesByBuilding(buildingId),
    rewardGoldPerMinute: perMinuteReward.rewardGold,
    rewardXpPerMinute: perMinuteReward.rewardXp,
    materialDropCountPerCompletion: resolveMaterialDropCount(buildingLevel),
  };
}

function resolveRewardBuildingLevel(buildings: unknown, category: TaskCategory): BuildingLevel {
  const buildingType = resolveRewardBuildingType(category);
  const normalizedBuildings = normalizeBuildings(buildings);
  const matched = normalizedBuildings.find((building) => building.type === buildingType);
  return matched?.level ?? 1;
}

function calculateTaskCompletionReward(params: {
  assignedAt: string;
  completedAt: string;
  category: TaskCategory;
  buildings: unknown;
}): { minutes: number; buildingLevel: BuildingLevel; rewardGold: number; rewardXp: number } {
  const minutes = getElapsedMinutes(params.assignedAt, params.completedAt);
  const buildingLevel = resolveRewardBuildingLevel(params.buildings, params.category);
  if (isNonProductiveTaskCategory(params.category)) {
    return {
      minutes,
      buildingLevel,
      rewardGold: 0,
      rewardXp: 0,
    };
  }

  const { rewardGold, rewardXp } = calculateTimeBasedReward(minutes, buildingLevel);

  return {
    minutes,
    buildingLevel,
    rewardGold,
    rewardXp,
  };
}

interface MaterialDropEntry {
  itemId: string;
  quantity: number;
}

interface MaterialDropRollResult {
  buildingType: RewardBuildingType;
  buildingLevel: BuildingLevel;
  drops: MaterialDropEntry[];
}

function randomIntInclusive(min: number, max: number): number {
  const normalizedMin = Math.min(min, max);
  const normalizedMax = Math.max(min, max);
  return Math.floor(Math.random() * (normalizedMax - normalizedMin + 1)) + normalizedMin;
}

function resolveMaterialDropCount(buildingLevel: BuildingLevel): number {
  if (buildingLevel <= 1) {
    return 1;
  }
  if (buildingLevel === 2) {
    return randomIntInclusive(1, 2);
  }
  return randomIntInclusive(1, 3);
}

function rollMaterialDrops(params: {
  category: TaskCategory;
  buildings: unknown;
  decorations?: GameState['decorations'];
  passiveEffects?: ReturnType<typeof calculatePassiveEffects>;
}): MaterialDropRollResult | null {
  const buildingType = resolveRewardBuildingType(params.category);
  const candidates = MATERIAL_DROP_TABLE[buildingType];
  if (candidates === undefined || candidates.length === 0) {
    return null;
  }

  const buildingLevel = resolveRewardBuildingLevel(params.buildings, params.category);
  const baseDropCount = resolveMaterialDropCount(buildingLevel);
  const adjustedDropCount =
    params.passiveEffects !== undefined
      ? baseDropCount * params.passiveEffects.materialDropMultiplier
      : applyDropRateBonus(baseDropCount, params.decorations ?? []);
  const guaranteedRolls = Math.max(0, Math.floor(adjustedDropCount));
  const fractionalRollChance = adjustedDropCount - guaranteedRolls;
  const bonusRoll = fractionalRollChance > 0 && Math.random() < fractionalRollChance ? 1 : 0;
  const rolledCount = guaranteedRolls + bonusRoll;
  if (rolledCount <= 0) {
    return null;
  }
  const dropTotals = new Map<string, number>();

  for (let i = 0; i < rolledCount; i += 1) {
    const index = randomIntInclusive(0, candidates.length - 1);
    const itemId = candidates[index];
    const quantity = dropTotals.get(itemId) ?? 0;
    dropTotals.set(itemId, quantity + 1);
  }

  if (dropTotals.size === 0) {
    return null;
  }

  const drops: MaterialDropEntry[] = [];
  for (const item of ITEM_MASTER) {
    const quantity = dropTotals.get(item.id);
    if (quantity === undefined || quantity <= 0) {
      continue;
    }
    drops.push({
      itemId: item.id,
      quantity,
    });
  }

  return drops.length > 0
    ? {
        buildingType,
        buildingLevel,
        drops,
      }
    : null;
}

function hasShogunSealInInventory(rawInventory: unknown): boolean {
  const inventory = normalizeInventory(rawInventory, getDefaultInventory());
  return inventory.some((entry) => entry.itemId === SHOGUN_SEAL_ITEM_ID && entry.quantity > 0);
}

function applyShogunSealGoldBonus(baseGold: number, hasShogunSeal: boolean): number {
  const normalizedBaseGold = Math.max(0, Math.floor(baseGold));
  if (!hasShogunSeal || normalizedBaseGold <= 0 || SHOGUN_SEAL_GOLD_BONUS_RATE <= 0) {
    return normalizedBaseGold;
  }

  return Math.max(0, Math.floor((normalizedBaseGold * (100 + SHOGUN_SEAL_GOLD_BONUS_RATE)) / 100));
}

function cloneInventory(inventory: InventoryItem[]): InventoryItem[] {
  return inventory.map((entry) => ({
    itemId: entry.itemId,
    quantity: entry.quantity,
  }));
}

function normalizeInventory(
  rawInventory: unknown,
  fallback: InventoryItem[] = []
): InventoryItem[] {
  const source = Array.isArray(rawInventory) ? rawInventory : fallback;
  const byItemId = new Map<string, InventoryItem>();

  for (const rawEntry of source) {
    if (!isRecord(rawEntry)) {
      continue;
    }

    const itemId = asString(rawEntry.itemId);
    if (itemId === null) {
      continue;
    }

    const definition = ITEM_MASTER_BY_ID.get(itemId);
    if (definition === undefined) {
      continue;
    }

    const rawQuantity = toNumber(rawEntry.quantity);
    const baseQuantity = rawQuantity === null ? 0 : Math.max(0, Math.floor(rawQuantity));
    const quantity = definition.stackable ? baseQuantity : baseQuantity > 0 ? 1 : 0;
    const existing = byItemId.get(itemId);

    if (existing === undefined) {
      if (quantity <= 0) {
        continue;
      }

      byItemId.set(itemId, {
        itemId,
        quantity,
      });
      continue;
    }

    const mergedQuantity = definition.stackable
      ? existing.quantity + quantity
      : Math.max(existing.quantity, quantity);
    byItemId.set(itemId, {
      itemId,
      quantity: mergedQuantity,
    });
  }

  const normalized: InventoryItem[] = [];
  for (const item of ITEM_MASTER) {
    const entry = byItemId.get(item.id);
    if (entry === undefined) {
      continue;
    }
    normalized.push(entry);
  }

  return normalized;
}

function getDefaultInventory(): InventoryItem[] {
  return cloneInventory(normalizeInventory(INITIAL_INVENTORY, []));
}

function toInventoryMap(inventory: InventoryItem[]): Map<string, InventoryItem> {
  return new Map(
    inventory.map((entry) => [
      entry.itemId,
      {
        itemId: entry.itemId,
        quantity: entry.quantity,
      },
    ])
  );
}

function inventoryFromMap(map: Map<string, InventoryItem>): InventoryItem[] {
  const normalized: InventoryItem[] = [];
  for (const item of ITEM_MASTER) {
    const entry = map.get(item.id);
    if (entry === undefined) {
      continue;
    }
    if (entry.quantity <= 0) {
      continue;
    }
    normalized.push({
      itemId: entry.itemId,
      quantity: Math.max(0, Math.floor(entry.quantity)),
    });
  }
  return normalized;
}

function normalizeAchievementThresholds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => toNumber(entry))
        .filter((entry): entry is number => entry !== null)
        .map((entry) => Math.max(0, Math.floor(entry)))
        .filter((entry) => entry > 0)
        .sort((left, right) => left - right)
    )
  );
}

function normalizeAchievements(rawAchievements: unknown): GameState['achievements'] {
  if (!Array.isArray(rawAchievements)) {
    return [];
  }

  const normalized: GameState['achievements'] = [];
  const seenIds = new Set<string>();

  for (const rawAchievement of rawAchievements) {
    if (!isRecord(rawAchievement)) {
      continue;
    }

    const id = asString(rawAchievement.id);
    if (id === null || seenIds.has(id)) {
      continue;
    }

    const unlockedAt = asString(rawAchievement.unlockedAt);
    seenIds.add(id);
    normalized.push({
      id,
      category: asString(rawAchievement.category) ?? 'general',
      name: asString(rawAchievement.name) ?? id,
      description: asString(rawAchievement.description) ?? '',
      thresholds: normalizeAchievementThresholds(rawAchievement.thresholds),
      currentValue: Math.max(0, Math.floor(toNumber(rawAchievement.currentValue) ?? 0)),
      ...(unlockedAt ? { unlockedAt } : {}),
    });
  }

  return normalized;
}

function normalizeTitles(rawTitles: unknown): GameState['titles'] {
  if (!Array.isArray(rawTitles)) {
    return [];
  }

  const normalized: GameState['titles'] = [];
  const seenIds = new Set<string>();

  for (const rawTitle of rawTitles) {
    if (!isRecord(rawTitle)) {
      continue;
    }

    const id = asString(rawTitle.id);
    if (id === null || seenIds.has(id)) {
      continue;
    }

    const unlockedAt = asString(rawTitle.unlockedAt);
    seenIds.add(id);
    normalized.push({
      id,
      name: asString(rawTitle.name) ?? id,
      description: asString(rawTitle.description) ?? '',
      condition: asString(rawTitle.condition) ?? '',
      ...(unlockedAt ? { unlockedAt } : {}),
    });
  }

  return normalized;
}

function normalizeDailyRecords(rawDailyRecords: unknown): GameState['dailyRecords'] {
  if (!Array.isArray(rawDailyRecords)) {
    return [];
  }

  const normalized: GameState['dailyRecords'] = [];
  const seenDates = new Set<string>();

  for (const rawRecord of rawDailyRecords) {
    if (!isRecord(rawRecord)) {
      continue;
    }

    const date = asString(rawRecord.date);
    if (date === null || seenDates.has(date)) {
      continue;
    }

    seenDates.add(date);
    normalized.push({
      date,
      xp: Math.max(0, Math.floor(toNumber(rawRecord.xp) ?? 0)),
      gold: Math.max(0, Math.floor(toNumber(rawRecord.gold) ?? 0)),
      tasksCompleted: Math.max(0, Math.floor(toNumber(rawRecord.tasksCompleted) ?? 0)),
      consecutiveCompletions: Math.max(
        0,
        Math.floor(toNumber(rawRecord.consecutiveCompletions) ?? 0)
      ),
      previousBest: Math.max(0, Math.floor(toNumber(rawRecord.previousBest) ?? 0)),
    });
  }

  return normalized.sort((left, right) => left.date.localeCompare(right.date));
}

function resolveDailyRecordDateKey(timestamp: unknown): string {
  const normalized = asString(timestamp);
  if (normalized !== null) {
    const datePrefix = normalized.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (datePrefix) {
      return datePrefix[1];
    }

    const timestampPrefix = normalized.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (timestampPrefix) {
      return timestampPrefix[1];
    }

    const parsed = new Date(normalized);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  return new Date().toISOString().slice(0, 10);
}

function shiftDailyRecordDate(dateKey: string, days: number): string {
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) {
    return dateKey;
  }

  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

interface DailyRecordCompletionUpdate {
  dailyRecords: GameState['dailyRecords'];
  isNewRecord: boolean;
}

function applyDailyRecordCompletion(
  currentDailyRecords: GameState['dailyRecords'],
  completion: {
    completedAt: string;
    rewardXp: number;
    rewardGold: number;
  }
): DailyRecordCompletionUpdate {
  const date = resolveDailyRecordDateKey(completion.completedAt);
  const rewardXp = Math.max(0, Math.floor(completion.rewardXp));
  const rewardGold = Math.max(0, Math.floor(completion.rewardGold));
  const nextDailyRecords = [...normalizeDailyRecords(currentDailyRecords)];
  const todayIndex = nextDailyRecords.findIndex((record) => record.date === date);
  const yesterdayDate = shiftDailyRecordDate(date, -1);
  const yesterdayRecord = nextDailyRecords.find((record) => record.date === yesterdayDate) ?? null;
  const previousBest = nextDailyRecords.reduce((best, record) => {
    if (record.date < date) {
      return Math.max(best, record.tasksCompleted);
    }
    return best;
  }, 0);
  const fallbackConsecutiveCompletions =
    yesterdayRecord !== null && yesterdayRecord.tasksCompleted > 0
      ? Math.max(1, yesterdayRecord.consecutiveCompletions + 1)
      : 1;

  const nextTodayRecord =
    todayIndex >= 0
      ? (() => {
          const current = nextDailyRecords[todayIndex];
          return {
            ...current,
            xp: current.xp + rewardXp,
            gold: current.gold + rewardGold,
            tasksCompleted: current.tasksCompleted + 1,
            consecutiveCompletions: Math.max(
              1,
              current.consecutiveCompletions || fallbackConsecutiveCompletions
            ),
            previousBest,
          };
        })()
      : {
          date,
          xp: rewardXp,
          gold: rewardGold,
          tasksCompleted: 1,
          consecutiveCompletions: fallbackConsecutiveCompletions,
          previousBest,
        };

  if (todayIndex >= 0) {
    nextDailyRecords[todayIndex] = nextTodayRecord;
  } else {
    nextDailyRecords.push(nextTodayRecord);
  }

  nextDailyRecords.sort((left, right) => left.date.localeCompare(right.date));

  return {
    dailyRecords: nextDailyRecords,
    isNewRecord: nextTodayRecord.tasksCompleted > nextTodayRecord.previousBest,
  };
}

function normalizeMaterialCollection(
  rawMaterialCollection: unknown
): GameState['materialCollection'] {
  if (!Array.isArray(rawMaterialCollection)) {
    return [];
  }

  const byItemId = new Map<string, GameState['materialCollection'][number]>();

  for (const rawEntry of rawMaterialCollection) {
    if (!isRecord(rawEntry)) {
      continue;
    }

    const itemId = asString(rawEntry.itemId);
    if (itemId === null || !MATERIAL_ITEM_ID_SET.has(itemId)) {
      continue;
    }

    const count = Math.max(0, Math.floor(toNumber(rawEntry.count) ?? 0));
    const firstObtainedAt = asString(rawEntry.firstObtainedAt);
    const existing = byItemId.get(itemId);

    if (existing === undefined) {
      byItemId.set(itemId, {
        itemId,
        count,
        ...(firstObtainedAt ? { firstObtainedAt } : {}),
      });
      continue;
    }

    byItemId.set(itemId, {
      itemId,
      count: existing.count + count,
      ...(existing.firstObtainedAt
        ? { firstObtainedAt: existing.firstObtainedAt }
        : firstObtainedAt
          ? { firstObtainedAt }
          : {}),
    });
  }

  return ITEM_MASTER.filter((item) => item.itemType === 'material')
    .map((item) => byItemId.get(item.id))
    .filter((entry): entry is GameState['materialCollection'][number] => entry !== undefined);
}

function mergeMaterialCollectionFromInventory(
  materialCollection: GameState['materialCollection'],
  inventory: InventoryItem[]
): GameState['materialCollection'] {
  const byItemId = new Map(materialCollection.map((entry) => [entry.itemId, { ...entry }]));

  for (const entry of inventory) {
    if (!MATERIAL_ITEM_ID_SET.has(entry.itemId)) {
      continue;
    }

    const quantity = Math.max(0, Math.floor(entry.quantity));
    if (quantity <= 0) {
      continue;
    }

    const existing = byItemId.get(entry.itemId);
    if (existing === undefined) {
      byItemId.set(entry.itemId, {
        itemId: entry.itemId,
        count: quantity,
      });
      continue;
    }

    byItemId.set(entry.itemId, {
      ...existing,
      count: Math.max(existing.count, quantity),
    });
  }

  return ITEM_MASTER.filter((item) => item.itemType === 'material')
    .map((item) => byItemId.get(item.id))
    .filter((entry): entry is GameState['materialCollection'][number] => entry !== undefined);
}

function applyMaterialDropsToCollection(
  materialCollection: GameState['materialCollection'],
  drops: MaterialDropEntry[],
  obtainedAt: string
): GameState['materialCollection'] {
  const byItemId = new Map(materialCollection.map((entry) => [entry.itemId, { ...entry }]));

  for (const drop of drops) {
    if (!MATERIAL_ITEM_ID_SET.has(drop.itemId)) {
      continue;
    }

    const quantityGain = Math.max(0, Math.floor(drop.quantity));
    if (quantityGain <= 0) {
      continue;
    }

    const existing = byItemId.get(drop.itemId);
    if (existing === undefined) {
      byItemId.set(drop.itemId, {
        itemId: drop.itemId,
        count: quantityGain,
        firstObtainedAt: obtainedAt,
      });
      continue;
    }

    byItemId.set(drop.itemId, {
      ...existing,
      count: existing.count + quantityGain,
    });
  }

  return ITEM_MASTER.filter((item) => item.itemType === 'material')
    .map((item) => byItemId.get(item.id))
    .filter((entry): entry is GameState['materialCollection'][number] => entry !== undefined);
}

function hasMaterialCollectionChanged(
  previous: GameState['materialCollection'],
  next: GameState['materialCollection']
): boolean {
  if (previous.length !== next.length) {
    return true;
  }

  for (let index = 0; index < previous.length; index += 1) {
    const previousEntry = previous[index];
    const nextEntry = next[index];
    if (
      previousEntry.itemId !== nextEntry.itemId ||
      previousEntry.count !== nextEntry.count ||
      (previousEntry.firstObtainedAt ?? null) !== (nextEntry.firstObtainedAt ?? null)
    ) {
      return true;
    }
  }

  return false;
}

function normalizeLastMaterialDrop(rawNotice: unknown): GameState['lastMaterialDrop'] {
  if (rawNotice === undefined) {
    return undefined;
  }
  if (rawNotice === null || !isRecord(rawNotice)) {
    return null;
  }

  const workerId = asString(rawNotice.workerId);
  const taskId = asString(rawNotice.taskId);
  const createdAt = asString(rawNotice.createdAt);
  if (workerId === null || taskId === null || createdAt === null) {
    return null;
  }

  const drops = Array.isArray(rawNotice.drops)
    ? rawNotice.drops
        .map((drop) => {
          if (!isRecord(drop)) {
            return null;
          }

          const itemId = asString(drop.itemId);
          const quantityRaw = toNumber(drop.quantity);
          if (itemId === null || quantityRaw === null) {
            return null;
          }

          const quantity = Math.max(0, Math.floor(quantityRaw));
          if (quantity <= 0) {
            return null;
          }

          const name = asString(drop.name);
          return {
            itemId,
            quantity,
            ...(name !== null ? { name } : {}),
          };
        })
        .filter(
          (
            drop
          ): drop is {
            itemId: string;
            quantity: number;
            name?: string;
          } => drop !== null
        )
    : [];

  if (drops.length === 0) {
    return null;
  }

  const timestamp = asString(rawNotice.timestamp) ?? createdAt;
  const buildingTypeRaw = asString(rawNotice.buildingType);
  const buildingType =
    buildingTypeRaw !== null &&
    BUILDING_TYPES.includes(buildingTypeRaw as GameState['buildings'][number]['type'])
      ? (buildingTypeRaw as GameState['buildings'][number]['type'])
      : undefined;
  const buildingLevelRaw = toNumber(rawNotice.buildingLevel);
  const buildingLevel =
    buildingLevelRaw !== null ? normalizeBuildingLevel(Math.floor(buildingLevelRaw)) : undefined;
  const message = asString(rawNotice.message);

  return {
    workerId,
    taskId,
    drops,
    timestamp,
    createdAt,
    ...(buildingType !== undefined ? { buildingType } : {}),
    ...(buildingLevel !== undefined ? { buildingLevel } : {}),
    ...(message !== null ? { message } : {}),
  };
}

function normalizeEquippedTitle(
  rawEquippedTitle: unknown,
  titles: GameState['titles']
): string | null {
  const equippedTitle = asString(rawEquippedTitle);
  if (equippedTitle === null) {
    return null;
  }

  const unlockedTitleIds = new Set(
    titles.filter((title) => asString(title.unlockedAt) !== null).map((title) => title.id)
  );
  return unlockedTitleIds.has(equippedTitle) ? equippedTitle : null;
}

function applyGamificationState(
  gameState: GameState
): Pick<GameState, 'achievements' | 'titles' | 'equippedTitle'> {
  const achievementCheckResult = checkAchievements(gameState);
  const titleCheckResult = checkTitles({
    ...gameState,
    achievements: achievementCheckResult.achievements,
  });

  const normalizedEquippedTitle = normalizeEquippedTitle(
    gameState.equippedTitle,
    titleCheckResult.titles
  );

  return {
    achievements: achievementCheckResult.achievements,
    titles: titleCheckResult.titles,
    equippedTitle: normalizedEquippedTitle,
  };
}

function applyMaterialDropsToInventory(
  inventory: InventoryItem[],
  drops: MaterialDropEntry[]
): InventoryItem[] {
  const inventoryMap = toInventoryMap(inventory);

  for (const drop of drops) {
    const item = ITEM_MASTER_BY_ID.get(drop.itemId);
    const quantityGain = Math.max(0, Math.floor(drop.quantity));
    if (item === undefined || quantityGain <= 0) {
      continue;
    }

    const existing = inventoryMap.get(drop.itemId);
    const nextQuantity = item.stackable ? (existing?.quantity ?? 0) + quantityGain : 1;
    inventoryMap.set(drop.itemId, {
      itemId: drop.itemId,
      quantity: nextQuantity,
    });
  }

  return inventoryFromMap(inventoryMap);
}

function hasInventoryChanged(previous: InventoryItem[], next: InventoryItem[]): boolean {
  if (previous.length !== next.length) {
    return true;
  }

  for (let index = 0; index < previous.length; index += 1) {
    const previousEntry = previous[index];
    const nextEntry = next[index];
    if (
      previousEntry.itemId !== nextEntry.itemId ||
      previousEntry.quantity !== nextEntry.quantity
    ) {
      return true;
    }
  }

  return false;
}

function normalizeTown(
  rawTown: unknown,
  fallbackGold = 0
): {
  level: number;
  xp: number;
  gold: number;
  rank: {
    value: number;
    title: string;
    nextRequiredXP: number | null;
  };
} {
  const source = isRecord(rawTown) ? rawTown : {};
  const xp = Math.max(0, Math.floor(toNumber(source.xp) ?? 0));
  const gold = Math.max(0, Math.floor(toNumber(source.gold) ?? fallbackGold));
  const level = resolveTownLevel(xp);
  const rankValue = getRank(xp);
  const rankDefinition = getRankDefinition(rankValue);

  return {
    level,
    xp,
    gold,
    rank: {
      value: rankValue,
      title: rankDefinition.title,
      nextRequiredXP: getNextRankXP(rankValue),
    },
  };
}

function resolveEconomyGold(rawEconomy: unknown): number {
  const economySource = isRecord(rawEconomy) ? rawEconomy : {};
  return Math.max(0, Math.floor(toNumber(economySource.gold) ?? 0));
}

function normalizeTownFromState(rawState: unknown): ReturnType<typeof normalizeTown> {
  const state = isRecord(rawState) ? rawState : {};
  return normalizeTown(state.town, resolveEconomyGold(state.economy));
}

function syncEconomyWithTownInPlace(state: LooseRecord): void {
  const normalizedTown = normalizeTownFromState(state);
  const economySource = isRecord(state.economy) ? state.economy : {};
  state.town = normalizedTown;
  state.economy = {
    ...economySource,
    gold: normalizedTown.gold,
  };
}

function buildDefaultPosition(index: number): { x: number; y: number } {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: -1 - column,
    y: 2 + row,
  };
}

function isActiveTask(task: ServerTaskUpdatePayload | null): task is ServerTaskUpdatePayload {
  return task?.status === 'assigned' || task?.status === 'in_progress';
}

function resolveBuildingForTask(task: ServerTaskUpdatePayload | null): GameState['buildings'][number]['type'] {
  if (!isActiveTask(task)) {
    return TASK_TO_BUILDING_MAP.idle;
  }

  return TASK_TO_BUILDING_MAP[task.category] ?? TASK_TO_BUILDING_MAP.idle;
}

function buildBackfilledActivityLog(
  source: unknown,
  tasks: ServerTaskUpdatePayload[],
  reports: ServerReportUpdatePayload[],
  taskSnapshots: LooseRecord[],
  ashigaru: GameState['ashigaru'],
  buildings: GameState['buildings']
): ActivityLogEntry[] {
  const normalized = normalizeActivityLog(source);
  const taskCategoryByTaskId = getTaskCategoryByTaskId(taskSnapshots);
  const taskRewardContextByTaskId = getTaskRewardContextByTaskId(taskSnapshots);
  const workerNameById = new Map<WorkerId, string>();
  for (const member of ashigaru) {
    const workerId = normalizeWorkerId(member.id);
    if (workerId === null) {
      continue;
    }
    workerNameById.set(workerId, member.name);
  }

  const reportByWorkCompleteKey = new Map<string, ServerReportUpdatePayload>();
  for (const report of reports) {
    if (report.status !== 'done') {
      continue;
    }

    const workerId = normalizeWorkerId(report.workerId);
    if (workerId === null) {
      continue;
    }

    reportByWorkCompleteKey.set(`${workerId}:${asTimestamp(report.createdAt)}`, report);
  }

  const resolveBackfilledCompletionReward = (
    report: ServerReportUpdatePayload,
    fallbackCategory: TaskCategory,
    activityLogEntries: ActivityLogEntry[] = normalized
  ): { category: TaskCategory; durationMinutes: number; gold: number; xp: number } | null => {
    const context = taskRewardContextByTaskId.get(report.taskId);
    const reportWorkerId = normalizeWorkerId(report.workerId);
    const completionContextFromWorkStart =
      reportWorkerId === null
        ? null
        : resolveCompletionRewardContextFromWorkStart({
            activityLog: activityLogEntries,
            workerId: reportWorkerId,
            completedAt: asTimestamp(report.createdAt),
            fallbackCategory: context?.category ?? fallbackCategory,
          });
    const category = context?.category ?? completionContextFromWorkStart?.category ?? fallbackCategory;
    const assignedAt = context?.assignedAt ?? completionContextFromWorkStart?.assignedAt ?? null;
    if (assignedAt === null) {
      return null;
    }

    const reward = calculateTaskCompletionReward({
      assignedAt,
      completedAt: asTimestamp(report.createdAt),
      category,
      buildings,
    });

    return {
      category,
      durationMinutes: reward.minutes,
      gold: reward.rewardGold,
      xp: reward.rewardXp,
    };
  };

  const normalizedWithCompletionRewards = normalized.map((entry) => {
    if (entry.type !== 'work_complete') {
      return entry;
    }

    const workerId = normalizeWorkerId(entry.workerId);
    if (workerId === null) {
      return entry;
    }

    const existingHasRewards =
      typeof entry.durationMinutes === 'number' ||
      typeof entry.gold === 'number' ||
      typeof entry.xp === 'number' ||
      (Array.isArray(entry.items) && entry.items.length > 0);
    if (existingHasRewards) {
      return entry;
    }

    const report = reportByWorkCompleteKey.get(`${workerId}:${entry.timestamp}`);
    if (report === undefined) {
      return entry;
    }

    const fallbackCategory =
      taskCategoryByTaskId.get(report.taskId) ?? asTaskCategory(entry.taskCategory) ?? 'other';
    const reward = resolveBackfilledCompletionReward(report, fallbackCategory);
    if (reward === null) {
      return entry;
    }

    return {
      ...entry,
      taskCategory: reward.category,
      durationMinutes: reward.durationMinutes,
      ...(reward.gold > 0 ? { gold: reward.gold } : {}),
      ...(reward.xp > 0 ? { xp: reward.xp } : {}),
    };
  });

  const existingWorkStartKeys = new Set(
    normalizedWithCompletionRewards
      .filter(
        (entry): entry is ActivityLogEntry & { workerId: WorkerId } =>
          entry.type === 'work_start' && normalizeWorkerId(entry.workerId) !== null
      )
      .map((entry) => `${entry.workerId}:${entry.timestamp}`)
  );
  const existingWorkCompleteKeys = new Set(
    normalizedWithCompletionRewards
      .filter(
        (entry): entry is ActivityLogEntry & { workerId: WorkerId } =>
          entry.type === 'work_complete' && normalizeWorkerId(entry.workerId) !== null
      )
      .map((entry) => `${entry.workerId}:${entry.timestamp}`)
  );

  const workStartAdditions = tasks
    .filter(isActiveTask)
    .map((task) => {
      const workerId = normalizeWorkerId(task.assigneeId);
      if (workerId === null) {
        return null;
      }

      if (isNonProductiveTaskCategory(task.category)) {
        return null;
      }

      const timestamp = asTimestamp(task.updatedAt);
      const entryKey = `${workerId}:${timestamp}`;
      if (existingWorkStartKeys.has(entryKey)) {
        return null;
      }

      const buildingType = resolveRewardBuildingType(task.category);
      const buildingLevel = resolveRewardBuildingLevel(buildings, task.category);
      const buildingLabel = resolveBuildingLabel(buildingType);
      const workerName = workerNameById.get(workerId) ?? WORKER_LABELS[workerId] ?? task.assigneeId;

      return createActivityLogEntry({
        type: 'work_start',
        timestamp,
        workerId,
        workerName,
        buildingType,
        buildingLevel,
        taskCategory: task.category,
        message: `${workerName}が${buildingLabel}Lv${buildingLevel}で作業を開始`,
      });
    })
    .filter((entry): entry is ActivityLogEntry => entry !== null);

  const workCompleteAdditions = reports
    .filter((report) => report.status === 'done')
    .map((report) => {
      const workerId = normalizeWorkerId(report.workerId);
      if (workerId === null) {
        return null;
      }

      const timestamp = asTimestamp(report.createdAt);
      const entryKey = `${workerId}:${timestamp}`;
      if (existingWorkCompleteKeys.has(entryKey)) {
        return null;
      }

      const category = taskCategoryByTaskId.get(report.taskId) ?? 'other';
      if (isNonProductiveTaskCategory(category)) {
        return null;
      }
      const buildingType = resolveRewardBuildingType(category);
      const buildingLevel = resolveRewardBuildingLevel(buildings, category);
      const buildingLabel = resolveBuildingLabel(buildingType);
      const workerName = workerNameById.get(workerId) ?? WORKER_LABELS[workerId] ?? report.workerId;
      const reward = resolveBackfilledCompletionReward(report, category, normalizedWithCompletionRewards);

      return createActivityLogEntry({
        type: 'work_complete',
        timestamp,
        workerId,
        workerName,
        buildingType,
        buildingLevel,
        taskCategory: reward?.category ?? category,
        ...(reward !== null ? { durationMinutes: reward.durationMinutes } : {}),
        ...(reward !== null && reward.gold > 0 ? { gold: reward.gold } : {}),
        ...(reward !== null && reward.xp > 0 ? { xp: reward.xp } : {}),
        message: `${workerName}が${buildingLabel}Lv${buildingLevel}で作業完了`,
      });
    })
    .filter((entry): entry is ActivityLogEntry => entry !== null);

  const additions = [...workStartAdditions, ...workCompleteAdditions].sort((left, right) => {
    const leftTimestamp = Date.parse(left.timestamp);
    const rightTimestamp = Date.parse(right.timestamp);
    const leftMs = Number.isFinite(leftTimestamp) ? leftTimestamp : 0;
    const rightMs = Number.isFinite(rightTimestamp) ? rightTimestamp : 0;
    if (leftMs !== rightMs) {
      return leftMs - rightMs;
    }

    const leftWorkerId = left.workerId ?? '';
    const rightWorkerId = right.workerId ?? '';
    return leftWorkerId.localeCompare(rightWorkerId);
  });

  if (additions.length === 0) {
    return normalizedWithCompletionRewards;
  }

  const merged = [...normalizedWithCompletionRewards, ...additions].sort((left, right) => {
    const leftTimestamp = Date.parse(left.timestamp);
    const rightTimestamp = Date.parse(right.timestamp);
    const leftMs = Number.isFinite(leftTimestamp) ? leftTimestamp : 0;
    const rightMs = Number.isFinite(rightTimestamp) ? rightTimestamp : 0;
    if (leftMs !== rightMs) {
      return leftMs - rightMs;
    }

    const leftWorkerId = left.workerId ?? '';
    const rightWorkerId = right.workerId ?? '';
    return leftWorkerId.localeCompare(rightWorkerId);
  });

  if (merged.length <= MAX_ACTIVITY_LOG_ENTRIES) {
    return merged;
  }

  return merged.slice(merged.length - MAX_ACTIVITY_LOG_ENTRIES);
}

function toGameState(
  raw: unknown,
  tasks: ServerTaskUpdatePayload[],
  reports: ServerReportUpdatePayload[],
  taskSnapshots: LooseRecord[],
  reportSnapshots: LooseRecord[]
): GameState {
  const base = isRecord(raw) ? raw : {};
  const terminalReportTaskKeys = getTerminalReportTaskKeys(reports);
  const sanitizedTasks = sanitizeTasksByTerminalReports(tasks, terminalReportTaskKeys);
  const existingMembers = Array.isArray(base.ashigaru) ? base.ashigaru.filter(isRecord) : [];
  const membersById = new Map<WorkerId, LooseRecord>();
  for (const member of existingMembers) {
    const workerId = normalizeWorkerId(member.id);
    if (workerId !== null) {
      membersById.set(workerId, member);
    }
  }

  const taskByWorker = new Map<WorkerId, ServerTaskUpdatePayload>();
  for (const task of sanitizedTasks) {
    taskByWorker.set(task.assigneeId as WorkerId, task);
  }

  const ashigaru = WORKER_IDS.map((workerId, index) => {
    const existing = membersById.get(workerId) ?? {};
    const task = taskByWorker.get(workerId) ?? null;
    const positionSource = isRecord(existing.position) ? existing.position : null;
    const defaultPosition = buildDefaultPosition(index);
    const assignment = resolveAshigaruAssignmentState(existing, task);
    const resolvedBuilding = resolveBuildingForTask(task);
    return {
      id: workerId,
      name: asString(existing.name) ?? `Ashigaru ${index + 1}`,
      status: assignment.status,
      taskId: assignment.taskId,
      taskCategory: assignment.taskCategory,
      assignedAt: assignment.assignedAt,
      position: {
        x: toNumber(positionSource?.x) ?? defaultPosition.x,
        y: toNumber(positionSource?.y) ?? defaultPosition.y,
      },
    };
  });
  const missions = Array.isArray(base.missions) ? (base.missions as GameState['missions']) : [];
  const town = normalizeTown(base.town, resolveEconomyGold(base.economy));
  const buildings = normalizeBuildings(base.buildings);
  const decorations = normalizeDecorationsForState(base.decorations, buildings);
  const inventory = normalizeInventory(base.inventory, getDefaultInventory());
  const missionProgress = withMissionProgress(missions, taskSnapshots, reportSnapshots);
  const activityLog = buildBackfilledActivityLog(
    base.activityLog,
    sanitizedTasks,
    reports,
    taskSnapshots,
    ashigaru,
    buildings
  );
  const normalizedTitles = normalizeTitles(base.titles);
  const materialCollection = mergeMaterialCollectionFromInventory(
    normalizeMaterialCollection(base.materialCollection),
    inventory
  );
  const preGamificationState: GameState = {
    ashigaru,
    buildings,
    town,
    economy: {
      gold: town.gold,
    },
    inventory,
    decorations,
    missions: missionProgress,
    activityLog,
    achievements: normalizeAchievements(base.achievements),
    titles: normalizedTitles,
    equippedTitle: normalizeEquippedTitle(base.equippedTitle, normalizedTitles),
    dailyRecords: normalizeDailyRecords(base.dailyRecords),
    materialCollection,
    lastMaterialDrop: normalizeLastMaterialDrop(base.lastMaterialDrop),
  };
  const gamificationState = applyGamificationState(preGamificationState);

  return {
    ...preGamificationState,
    ...gamificationState,
  };
}

function buildMissionProgressSignature(missions: GameState['missions']): string {
  return missions
    .map((mission) => {
      const current = toSafeInt(mission.progress.current);
      const target = Math.max(1, toSafeInt(mission.progress.target));
      return `${mission.id}:${current}/${target}`;
    })
    .join('|');
}

function shouldPersistMissionProgress(
  rawGameState: unknown,
  latestMissions: GameState['missions']
): boolean {
  if (!isRecord(rawGameState)) {
    return latestMissions.length > 0;
  }

  const rawMissions = Array.isArray(rawGameState.missions)
    ? (rawGameState.missions as GameState['missions'])
    : [];

  return (
    buildMissionProgressSignature(rawMissions) !== buildMissionProgressSignature(latestMissions)
  );
}

async function persistDerivedGameStateIfNeeded(
  rawGameState: unknown,
  latestMissions: GameState['missions']
): Promise<void> {
  const missionChanged = shouldPersistMissionProgress(rawGameState, latestMissions);

  let normalizedBuildings: GameState['buildings'] = [];
  let normalizedDecorations: GameState['decorations'] = [];
  let buildingChanged = false;
  let decorationChanged = false;

  if (isRecord(rawGameState)) {
    const rawBuildings = Array.isArray(rawGameState.buildings) ? rawGameState.buildings : [];
    const rawDecorations = Array.isArray(rawGameState.decorations) ? rawGameState.decorations : [];
    normalizedBuildings = normalizeBuildings(rawBuildings);
    normalizedDecorations = normalizeDecorationsForState(rawDecorations, normalizedBuildings);
    buildingChanged = JSON.stringify(rawBuildings) !== JSON.stringify(normalizedBuildings);
    decorationChanged = JSON.stringify(rawDecorations) !== JSON.stringify(normalizedDecorations);
  }

  if (!missionChanged && !buildingChanged && !decorationChanged) {
    return;
  }

  const nextState = isRecord(rawGameState)
    ? ({ ...rawGameState } as LooseRecord)
    : ({ ...(getDefaultGameState() as unknown as LooseRecord) } as LooseRecord);

  if (missionChanged) {
    nextState.missions = latestMissions;
  }

  if (buildingChanged) {
    nextState.buildings = normalizedBuildings;
  }

  if (decorationChanged) {
    nextState.decorations = normalizedDecorations;
  }

  await queueGameStateWrite(nextState, { onReadOnly: 'skip' });
}

function execTmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('tmux', args, { encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function parseContextPercent(content: string): number | null {
  for (const pattern of CONTEXT_PATTERNS) {
    const matched = content.match(pattern);
    if (!matched) {
      continue;
    }
    const value = Number.parseInt(matched[1] ?? '', 10);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function parsePaneStatus(content: string): ContextStatus {
  if (content.trim().length === 0) {
    return 'unknown';
  }

  if (CONTEXT_WORKING_PATTERNS.some((pattern) => pattern.test(content))) {
    return 'working';
  }

  if (/❯\s*$/m.test(content) || />\s*$/.test(content.trimEnd())) {
    return 'idle';
  }

  return 'working';
}

async function readContextStats(): Promise<ContextStat[]> {
  const capturedAt = new Date().toISOString();
  const byWorker = new Map<WorkerId, string>();

  try {
    const paneList = await execTmux([
      'list-panes',
      '-t',
      'multiagent:0',
      '-F',
      '#{pane_id} #{@agent_id}',
    ]);
    for (const line of paneList.split('\n')) {
      const [paneId, rawWorkerId] = line.trim().split(/\s+/, 2);
      const workerId = normalizeWorkerId(rawWorkerId);
      if (paneId && workerId !== null) {
        byWorker.set(workerId, paneId);
      }
    }
  } catch {
    // Ignore and keep worker panes as unknown.
  }

  const workerStats = await Promise.all(
    WORKER_IDS.map(async (workerId) => {
      const pane = byWorker.get(workerId) ?? null;
      if (pane === null) {
        return {
          workerId,
          role: 'ashigaru' as const,
          label: WORKER_LABELS[workerId],
          pane: null,
          status: 'unknown' as const,
          contextPercent: null,
          capturedAt,
        };
      }

      try {
        const content = await execTmux(['capture-pane', '-t', pane, '-p']);
        return {
          workerId,
          role: 'ashigaru' as const,
          label: WORKER_LABELS[workerId],
          pane,
          status: parsePaneStatus(content),
          contextPercent: parseContextPercent(content),
          capturedAt,
        };
      } catch {
        return {
          workerId,
          role: 'ashigaru' as const,
          label: WORKER_LABELS[workerId],
          pane,
          status: 'unknown' as const,
          contextPercent: null,
          capturedAt,
        };
      }
    })
  );

  const commanderStats = await Promise.all(
    COMMANDER_SOURCES.map(async (commander) => {
      try {
        const content = await execTmux(['capture-pane', '-t', commander.paneTarget, '-p']);
        return {
          workerId: commander.workerId,
          role: commander.role,
          label: commander.label,
          pane: commander.paneTarget,
          status: parsePaneStatus(content),
          contextPercent: parseContextPercent(content),
          capturedAt,
        };
      } catch {
        return {
          workerId: commander.workerId,
          role: commander.role,
          label: commander.label,
          pane: null,
          status: 'unknown' as const,
          contextPercent: null,
          capturedAt,
        };
      }
    })
  );

  return [...commanderStats, ...workerStats];
}

function normalizeWatcherPayload(type: WSEventType, payload: unknown): unknown | null {
  if (!isRecord(payload)) {
    return payload;
  }

  switch (type) {
    case 'task_update':
      return toTaskPayload(payload, commandTitleByIdCache);
    case 'report_update':
      return toReportPayload(payload);
    case 'command_update':
      return toLatestCommandUpdatePayload(payload);
    default:
      return payload;
  }
}

function getDefaultGameState(): GameState & LooseRecord {
  return {
    ashigaru: normalizeAshigaruForPersistence([]),
    buildings: normalizeBuildings([]),
    town: {
      level: 1,
      xp: 0,
      gold: 40,
    },
    economy: {
      gold: 40,
    },
    inventory: getDefaultInventory(),
    decorations: [],
    missions: [],
    activityLog: [],
    achievements: [],
    titles: [],
    equippedTitle: null,
    dailyRecords: [],
    materialCollection: [],
    lastMaterialDrop: null,
  };
}

function broadcast(type: string, payload: unknown): void {
  broadcastWsMessage(wss, type as WSEventType, payload);
}

async function persistTaskAssignedAt(task: ServerTaskUpdatePayload): Promise<void> {
  const reportSnapshots = await getReportSnapshotsCached();
  const terminalReportTaskKeys = getTerminalReportTaskKeysFromSnapshots(reportSnapshots);
  const effectiveTask = sanitizeTaskByTerminalReport(task, terminalReportTaskKeys);

  const mutationResult = await queueGameStateMutation<GameStateMutationBroadcastResult>(
    async (currentState) => {
      const ashigaru = Array.isArray(currentState.ashigaru) ? currentState.ashigaru : [];
      const targetWorkerId = normalizeWorkerId(effectiveTask.assigneeId);
      const isActiveTask =
        effectiveTask.status === 'assigned' || effectiveTask.status === 'in_progress';
      let changed = false;
      let hasTargetMember = false;
      let activityLogEntry: ActivityLogEntry | null = null;

      const nextAshigaru = ashigaru.map((entry) => {
        if (!isRecord(entry) || normalizeWorkerId(entry.id) !== targetWorkerId) {
          return entry;
        }
        hasTargetMember = true;

        const currentTaskId = asString(entry.taskId);
        const currentAssignedAt = asString(entry.assignedAt);
        const currentStatus = asAshigaruStatus(entry.status);

        if (isActiveTask) {
          const nextAssignedAt =
            currentTaskId === effectiveTask.taskId
              ? (currentAssignedAt ?? effectiveTask.updatedAt)
              : effectiveTask.updatedAt;
          const nextStatus = toMemberStatus(effectiveTask, currentStatus);
          const currentTaskCategory = asTaskCategory(entry.taskCategory) ?? 'idle';
          const isAssignmentUnchanged =
            currentAssignedAt === nextAssignedAt &&
            currentTaskId === effectiveTask.taskId &&
            currentTaskCategory === effectiveTask.category &&
            currentStatus === nextStatus;
          if (isAssignmentUnchanged) {
            return entry;
          }

          const shouldLogWorkStart =
            !isNonProductiveTaskCategory(effectiveTask.category) &&
            (currentTaskId !== effectiveTask.taskId || currentAssignedAt === null);
          if (shouldLogWorkStart) {
            const buildingType = resolveRewardBuildingType(effectiveTask.category);
            const buildingLevel = resolveRewardBuildingLevel(
              currentState.buildings,
              effectiveTask.category
            );
            const buildingLabel = resolveBuildingLabel(buildingType);
            const workerId = normalizeWorkerId(effectiveTask.assigneeId);
            const workerName =
              asString(entry.name) ??
              (workerId !== null ? WORKER_LABELS[workerId] : null) ??
              effectiveTask.assigneeId;

            activityLogEntry = createActivityLogEntry({
              type: 'work_start',
              timestamp: nextAssignedAt,
              workerId: effectiveTask.assigneeId,
              workerName,
              buildingType,
              buildingLevel,
              taskCategory: effectiveTask.category,
              message: `${workerName}が${buildingLabel}Lv${buildingLevel}で作業を開始`,
            });
          }

          changed = true;
          return {
            ...entry,
            status: nextStatus,
            assignedAt: nextAssignedAt,
            taskId: effectiveTask.taskId,
            taskCategory: effectiveTask.category,
          };
        }

        const isTerminalTask =
          effectiveTask.status === 'done' ||
          effectiveTask.status === 'failed' ||
          effectiveTask.status === 'blocked';
        if (isTerminalTask && currentTaskId === effectiveTask.taskId) {
          const currentTaskCategory = asTaskCategory(entry.taskCategory) ?? 'idle';
          const nextStatus = toMemberStatus(effectiveTask, currentStatus);
          if (
            currentAssignedAt === null &&
            currentTaskCategory === 'idle' &&
            currentStatus === nextStatus
          ) {
            return entry;
          }

          changed = true;
          return {
            ...entry,
            status: nextStatus,
            assignedAt: null,
            taskId: null,
            taskCategory: 'idle',
          };
        }

        return entry;
      });

      if (!hasTargetMember && targetWorkerId !== null && isActiveTask) {
        const targetIndex = WORKER_IDS.indexOf(targetWorkerId);
        const position = buildDefaultPosition(targetIndex >= 0 ? targetIndex : 0);
        const workerName = WORKER_LABELS[targetWorkerId];
        const assignedAt = effectiveTask.updatedAt;

        nextAshigaru.push({
          id: targetWorkerId,
          name: workerName,
          status: toMemberStatus(effectiveTask, null),
          taskId: effectiveTask.taskId,
          taskCategory: effectiveTask.category,
          assignedAt,
          position,
        });
        if (!isNonProductiveTaskCategory(effectiveTask.category)) {
          const buildingType = resolveRewardBuildingType(effectiveTask.category);
          const buildingLevel = resolveRewardBuildingLevel(
            currentState.buildings,
            effectiveTask.category
          );
          const buildingLabel = resolveBuildingLabel(buildingType);
          activityLogEntry = createActivityLogEntry({
            type: 'work_start',
            timestamp: assignedAt,
            workerId: targetWorkerId,
            workerName,
            buildingType,
            buildingLevel,
            taskCategory: effectiveTask.category,
            message: `${workerName}が${buildingLabel}Lv${buildingLevel}で作業を開始`,
          });
        }
        changed = true;
      }

      const nextActivityLog = appendActivityLog(currentState.activityLog, activityLogEntry);
      const shouldUpdateActivityLog = activityLogEntry !== null;

      if (!changed && !shouldUpdateActivityLog) {
        return {
          nextState: null,
          result: {
            broadcastState: null,
          },
        };
      }

      const nextState: LooseRecord = {
        ...currentState,
        ashigaru: nextAshigaru,
        ...(shouldUpdateActivityLog ? { activityLog: nextActivityLog } : {}),
      };

      return {
        nextState,
        result: {
          broadcastState: nextState,
        },
      };
    }
  );

  if (mutationResult.broadcastState !== null) {
    broadcast('game_state_update', mutationResult.broadcastState);
  }
}

function normalizeCompletionRewardAppliedKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of raw) {
    const key = asString(entry);
    if (key === null || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }

  if (normalized.length <= COMPLETION_REWARD_DEDUPE_KEYS_LIMIT) {
    return normalized;
  }

  return normalized.slice(normalized.length - COMPLETION_REWARD_DEDUPE_KEYS_LIMIT);
}

function resolveCompletionRewardDedupeKey(report: ServerReportUpdatePayload): string {
  const reportId = asString(report.reportId);
  if (reportId !== null) {
    return `report:${reportId}`;
  }

  return `task:${report.workerId}:${report.taskId}`;
}

function appendCompletionRewardAppliedKey(keys: string[], key: string): string[] {
  const filtered = keys.filter((entry) => entry !== key);
  filtered.push(key);
  if (filtered.length <= COMPLETION_REWARD_DEDUPE_KEYS_LIMIT) {
    return filtered;
  }

  return filtered.slice(filtered.length - COMPLETION_REWARD_DEDUPE_KEYS_LIMIT);
}

async function applyTaskCompletionReward(report: ServerReportUpdatePayload): Promise<void> {
  const taskRewardContext = await resolveTaskRewardContext(report.taskId, report.workerId);
  const mutationResult = await queueGameStateMutation<GameStateMutationBroadcastResult>(
    async (currentState) => {
      const ashigaru = Array.isArray(currentState.ashigaru) ? currentState.ashigaru : [];
      const hasShogunSeal = hasShogunSealInInventory(currentState.inventory);
      const reportWorkerId = normalizeWorkerId(report.workerId);
      const completionRewardAppliedKeys = normalizeCompletionRewardAppliedKeys(
        currentState[COMPLETION_REWARD_DEDUPE_KEYS_STATE_KEY]
      );
      const completionRewardDedupeKey = resolveCompletionRewardDedupeKey(report);
      const hasAppliedCompletionReward =
        report.status === 'done' &&
        completionRewardAppliedKeys.includes(completionRewardDedupeKey);
      const shouldPersistCompletionRewardKey =
        report.status === 'done' && !hasAppliedCompletionReward;
      const nextCompletionRewardAppliedKeys = shouldPersistCompletionRewardKey
        ? appendCompletionRewardAppliedKey(completionRewardAppliedKeys, completionRewardDedupeKey)
        : completionRewardAppliedKeys;
      const normalizedActivityLog = normalizeActivityLog(currentState.activityLog);
      const existingCompletionLog = findCompletionLogForReport(normalizedActivityLog, report);
      const hasExistingCompletionLog =
        existingCompletionLog !== null && hasCompletionLogRewardDetails(existingCompletionLog.entry);
      const shouldReplaceIncompleteCompletionLog =
        !hasAppliedCompletionReward && existingCompletionLog !== null && !hasExistingCompletionLog;
      const fallbackCategoryFromTaskContext =
        taskRewardContext?.category ?? inferCategoryFromText(`${report.taskId} ${report.summary}`);
      const completionContextFromWorkStart =
        report.status === 'done' && reportWorkerId !== null
          ? resolveCompletionRewardContextFromWorkStart({
              activityLog: normalizedActivityLog,
              workerId: reportWorkerId,
              completedAt: report.createdAt,
              fallbackCategory: fallbackCategoryFromTaskContext,
            })
          : null;
      const fallbackAssignedAt =
        taskRewardContext?.assignedAt ?? completionContextFromWorkStart?.assignedAt ?? null;
      const fallbackCategory =
        taskRewardContext?.category ??
        completionContextFromWorkStart?.category ??
        fallbackCategoryFromTaskContext;
      const normalizedBuildings = normalizeBuildings(currentState.buildings);
      const decorations = normalizeDecorationsForState(currentState.decorations, normalizedBuildings);
      const passiveEffects = calculatePassiveEffects(decorations);
      let rewardGold = 0;
      let rewardXp = 0;
      let materialDrops: MaterialDropRollResult | null = null;
      let completionCategory: TaskCategory = fallbackCategory;
      let completionDurationMinutes = 0;
      let completionBuildingType: RewardBuildingType | null =
        resolveRewardBuildingType(fallbackCategory);
      let completionBuildingLevel: BuildingLevel | null = resolveRewardBuildingLevel(
        normalizedBuildings,
        fallbackCategory
      );
      let completionWorkerName: string | null =
        reportWorkerId !== null ? WORKER_LABELS[reportWorkerId] : report.workerId;
      let hasComputedCompletionReward = false;
      let shouldRecordDailyCompletion =
        report.status === 'done' &&
        !hasAppliedCompletionReward &&
        !hasExistingCompletionLog &&
        !isNonProductiveTaskCategory(fallbackCategory);
      let changed = false;
      if (shouldPersistCompletionRewardKey) {
        changed = true;
      }

      const nextAshigaru: unknown[] = [];
      for (const entry of ashigaru) {
        if (!isRecord(entry) || normalizeWorkerId(entry.id) !== report.workerId) {
          nextAshigaru.push(entry);
          continue;
        }

        const currentTaskId = asString(entry.taskId);
        const currentAssignedAt = asString(entry.assignedAt);
        const rewardAssignedAt =
          currentTaskId === report.taskId
            ? (currentAssignedAt ?? fallbackAssignedAt)
            : fallbackAssignedAt;
        const rewardCategory =
          currentTaskId === report.taskId
            ? (asTaskCategory(entry.taskCategory) ?? fallbackCategory)
            : fallbackCategory;

        if (
          report.status === 'done' &&
          !hasAppliedCompletionReward &&
          !hasExistingCompletionLog &&
          !hasComputedCompletionReward &&
          rewardAssignedAt !== null
        ) {
          const reward = calculateTaskCompletionReward({
            assignedAt: rewardAssignedAt,
            completedAt: report.createdAt,
            category: rewardCategory,
            buildings: normalizedBuildings,
          });
          const rewardGoldWithSeal = applyShogunSealGoldBonus(reward.rewardGold, hasShogunSeal);
          rewardGold = Math.floor(
            (rewardGoldWithSeal * Math.round((100 + passiveEffects.goldBonus) * 100)) / 10000
          );
          rewardXp = Math.floor(
            (reward.rewardXp * Math.round((100 + passiveEffects.xpBonus) * 100)) / 10000
          );
          completionCategory = rewardCategory;
          completionDurationMinutes = reward.minutes;
          completionBuildingType = resolveRewardBuildingType(rewardCategory);
          completionBuildingLevel = reward.buildingLevel;
          completionWorkerName = asString(entry.name) ?? completionWorkerName ?? report.workerId;
          if (isNonProductiveTaskCategory(rewardCategory)) {
            shouldRecordDailyCompletion = false;
            materialDrops = null;
          } else {
            shouldRecordDailyCompletion = true;
            materialDrops = rollMaterialDrops({
              category: rewardCategory,
              buildings: normalizedBuildings,
              decorations,
              passiveEffects,
            });
          }
          hasComputedCompletionReward = true;
        }

        if (currentTaskId !== report.taskId || currentAssignedAt === null) {
          nextAshigaru.push(entry);
          continue;
        }

        changed = true;
        nextAshigaru.push({
          ...entry,
          status: report.status === 'failed' || report.status === 'blocked' ? 'blocked' : 'idle',
          assignedAt: null,
          taskId: null,
          taskCategory: 'idle',
        });
      }

      if (
        report.status === 'done' &&
        !hasAppliedCompletionReward &&
        !hasExistingCompletionLog &&
        !hasComputedCompletionReward &&
        fallbackAssignedAt !== null
      ) {
        const reward = calculateTaskCompletionReward({
          assignedAt: fallbackAssignedAt,
          completedAt: report.createdAt,
          category: fallbackCategory,
          buildings: normalizedBuildings,
        });
        const rewardGoldWithSeal = applyShogunSealGoldBonus(reward.rewardGold, hasShogunSeal);
        rewardGold = Math.floor(
          (rewardGoldWithSeal * Math.round((100 + passiveEffects.goldBonus) * 100)) / 10000
        );
        rewardXp = Math.floor(
          (reward.rewardXp * Math.round((100 + passiveEffects.xpBonus) * 100)) / 10000
        );
        completionCategory = fallbackCategory;
        completionDurationMinutes = reward.minutes;
        completionBuildingType = resolveRewardBuildingType(fallbackCategory);
        completionBuildingLevel = reward.buildingLevel;
        if (isNonProductiveTaskCategory(fallbackCategory)) {
          shouldRecordDailyCompletion = false;
          materialDrops = null;
        } else {
          shouldRecordDailyCompletion = true;
          materialDrops = rollMaterialDrops({
            category: fallbackCategory,
            buildings: normalizedBuildings,
            decorations,
            passiveEffects,
          });
        }
        hasComputedCompletionReward = true;
      }

      const shouldApplyReward = rewardGold > 0 || rewardXp > 0;
      const nextTown = shouldApplyReward
        ? applyMissionRewardToTown(currentState.town, rewardXp, rewardGold)
        : currentState.town;
      if (shouldApplyReward) {
        changed = true;
      }

      const currentInventory = normalizeInventory(currentState.inventory, getDefaultInventory());
      const nextInventory =
        materialDrops === null
          ? currentInventory
          : applyMaterialDropsToInventory(currentInventory, materialDrops.drops);
      const shouldApplyInventory =
        materialDrops !== null && hasInventoryChanged(currentInventory, nextInventory);
      if (shouldApplyInventory) {
        changed = true;
      }
      const currentMaterialCollection = mergeMaterialCollectionFromInventory(
        normalizeMaterialCollection(currentState.materialCollection),
        currentInventory
      );
      const nextMaterialCollection =
        materialDrops === null
          ? currentMaterialCollection
          : applyMaterialDropsToCollection(
              currentMaterialCollection,
              materialDrops.drops,
              report.createdAt
            );
      const shouldApplyMaterialCollection =
        materialDrops !== null &&
        hasMaterialCollectionChanged(currentMaterialCollection, nextMaterialCollection);
      if (shouldApplyMaterialCollection) {
        changed = true;
      }

      const materialDropNotice =
        materialDrops !== null
          ? (() => {
              const drops = materialDrops.drops
                .map((drop) => {
                  const item = ITEM_MASTER_BY_ID.get(drop.itemId);
                  if (item === undefined) {
                    return null;
                  }
                  return {
                    itemId: drop.itemId,
                    name: item.name,
                    quantity: drop.quantity,
                  };
                })
                .filter(
                  (drop): drop is { itemId: string; name: string; quantity: number } =>
                    drop !== null
                );

              if (drops.length === 0) {
                return null;
              }

              const message = drops.map((drop) => `${drop.name}×${drop.quantity}`).join('、');

              return {
                workerId: report.workerId,
                taskId: report.taskId,
                buildingType: materialDrops.buildingType,
                buildingLevel: materialDrops.buildingLevel,
                drops,
                message: `${message}を獲得！`,
                createdAt: report.createdAt,
              };
            })()
          : null;
      if (materialDropNotice !== null) {
        changed = true;
      }

      const dailyRecordCompletion =
        shouldRecordDailyCompletion && report.status === 'done'
          ? applyDailyRecordCompletion(normalizeDailyRecords(currentState.dailyRecords), {
              completedAt: report.createdAt,
              rewardXp,
              rewardGold,
            })
          : null;
      console.log('[daily-record-debug]', {
        reportId: report.reportId,
        reportStatus: report.status,
        fallbackCategory,
        completionCategory,
        hasExistingCompletionLog,
        shouldRecordDailyCompletion,
        hasComputedCompletionReward,
        rewardXp,
        rewardGold,
        dailyRecordApplied: dailyRecordCompletion !== null,
      });
      const shouldApplyDailyRecords = dailyRecordCompletion !== null;
      if (shouldApplyDailyRecords) {
        changed = true;
      }

      const completionItems =
        materialDrops?.drops
          .map((drop) => {
            const item = ITEM_MASTER_BY_ID.get(drop.itemId);
            if (item === undefined) {
              return null;
            }

            return {
              itemId: drop.itemId,
              name: item.name,
              quantity: drop.quantity,
            };
          })
          .filter(
            (drop): drop is { itemId: string; name: string; quantity: number } => drop !== null
          ) ?? [];

      const completionLogEntry =
        report.status === 'done' &&
        !hasAppliedCompletionReward &&
        completionWorkerName !== null &&
        completionBuildingType !== null &&
        completionBuildingLevel !== null &&
        !isNonProductiveTaskCategory(completionCategory) &&
        !hasExistingCompletionLog
          ? createActivityLogEntry({
              ...(shouldReplaceIncompleteCompletionLog && existingCompletionLog !== null
                ? { id: existingCompletionLog.entry.id }
                : {}),
              type: 'work_complete',
              timestamp: report.createdAt,
              workerId: report.workerId,
              workerName: completionWorkerName,
              buildingType: completionBuildingType,
              buildingLevel: completionBuildingLevel,
              taskCategory: completionCategory,
              durationMinutes: completionDurationMinutes,
              ...(rewardGold > 0 ? { gold: rewardGold } : {}),
              ...(rewardXp > 0 ? { xp: rewardXp } : {}),
              ...(completionItems.length > 0 ? { items: completionItems } : {}),
              message: `${completionWorkerName}が${resolveBuildingLabel(completionBuildingType)}Lv${completionBuildingLevel}で作業完了${dailyRecordCompletion?.isNewRecord ? '（新記録！）' : ''}`,
            })
          : null;

      const nextActivityLog =
        shouldReplaceIncompleteCompletionLog && completionLogEntry !== null && existingCompletionLog !== null
          ? normalizedActivityLog.map((entry, index) =>
              index === existingCompletionLog.index ? completionLogEntry : entry
            )
          : appendActivityLog(currentState.activityLog, completionLogEntry);
      const shouldUpdateActivityLog = completionLogEntry !== null;

      if (!changed && !shouldUpdateActivityLog) {
        return {
          nextState: null,
          result: {
            broadcastState: null,
          },
        };
      }

      const nextStateBase: LooseRecord = {
        ...currentState,
        ashigaru: nextAshigaru,
        ...(shouldPersistCompletionRewardKey
          ? {
              [COMPLETION_REWARD_DEDUPE_KEYS_STATE_KEY]: nextCompletionRewardAppliedKeys,
            }
          : {}),
        ...(shouldApplyReward ? { town: nextTown } : {}),
        ...(shouldApplyInventory ? { inventory: nextInventory } : {}),
        ...(shouldApplyMaterialCollection ? { materialCollection: nextMaterialCollection } : {}),
        ...(shouldApplyDailyRecords ? { dailyRecords: dailyRecordCompletion.dailyRecords } : {}),
        ...(materialDropNotice !== null ? { lastMaterialDrop: materialDropNotice } : {}),
        ...(shouldUpdateActivityLog ? { activityLog: nextActivityLog } : {}),
      };
      const nextState = await sanitizeGameStateForPersistence(nextStateBase);

      return {
        nextState,
        result: {
          broadcastState: nextState,
        },
      };
    }
  );

  if (mutationResult.broadcastState !== null) {
    broadcast('game_state_update', mutationResult.broadcastState);
  }
}

interface TaskRewardContext {
  assignedAt: string | null;
  category: TaskCategory;
}

async function resolveTaskRewardContext(
  taskId: string,
  workerId: string
): Promise<TaskRewardContext | null> {
  const taskSnapshots = await getTaskSnapshotsCached(true);
  for (const snapshot of taskSnapshots) {
    if (!isRecord(snapshot) || !isRecord(snapshot.task)) {
      continue;
    }

    const task = snapshot.task;
    if (asString(task.task_id) !== taskId) {
      continue;
    }

    const snapshotWorkerId = normalizeWorkerId(snapshot.workerId);
    if (snapshotWorkerId !== null && snapshotWorkerId !== workerId) {
      continue;
    }

    return {
      assignedAt: asString(task.timestamp),
      category: asTaskCategory(task.category) ?? inferTaskCategory(task),
    };
  }

  return null;
}

function findCompletionLogForReport(
  activityLog: unknown,
  report: ServerReportUpdatePayload
): { index: number; entry: ActivityLogEntry } | null {
  const normalizedLog = normalizeActivityLog(activityLog);
  const index = normalizedLog.findIndex(
    (entry) =>
      entry.type === 'work_complete' &&
      entry.workerId === report.workerId &&
      entry.timestamp === report.createdAt
  );
  if (index < 0) {
    return null;
  }

  return {
    index,
    entry: normalizedLog[index],
  };
}

function hasCompletionLogRewardDetails(entry: ActivityLogEntry): boolean {
  return (
    typeof entry.durationMinutes === 'number' ||
    typeof entry.gold === 'number' ||
    typeof entry.xp === 'number' ||
    (Array.isArray(entry.items) && entry.items.length > 0)
  );
}

async function readYamlDirectory(dirPath: string): Promise<LooseRecord[]> {
  let entries: Dirent[] = [];

  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const yamlEntries = entries
    .filter(
      (entry) => entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const parsed = await Promise.all(
    yamlEntries.map(async (entry) => {
      const filePath = path.join(dirPath, entry.name);
      const workerId = path.basename(entry.name, path.extname(entry.name));
      const result = await readYamlFile<LooseRecord>(filePath);

      if (result.error !== null) {
        return {
          workerId,
          error: result.error,
          raw: result.raw,
        };
      }

      if (!isRecord(result.data)) {
        return {
          workerId,
          content: result.data,
        };
      }

      return {
        workerId,
        ...result.data,
      };
    })
  );

  return parsed;
}

async function getTaskSnapshotsCached(forceRefresh = false): Promise<LooseRecord[]> {
  if (!forceRefresh && !taskSnapshotsDirty) {
    return taskSnapshotsCache;
  }

  taskSnapshotsCache = await readYamlDirectory(TASKS_DIR);
  taskSnapshotsDirty = false;
  return taskSnapshotsCache;
}

async function getReportSnapshotsCached(forceRefresh = false): Promise<LooseRecord[]> {
  if (!forceRefresh && !reportSnapshotsDirty) {
    return reportSnapshotsCache;
  }

  reportSnapshotsCache = await readYamlDirectory(REPORTS_DIR);
  reportSnapshotsDirty = false;
  return reportSnapshotsCache;
}

async function readDashboardMarkdown(): Promise<string> {
  try {
    return await fs.readFile(DASHBOARD_FILE_PATH, 'utf8');
  } catch {
    return '';
  }
}

async function readCommandQueueFile(filePath: string): Promise<unknown[]> {
  const result = await readYamlFile<unknown>(filePath);
  if (result.error !== null) {
    console.error(`[command-queue] YAML parse error at ${filePath}: ${result.error}`);
    return [];
  }

  const source = result.data;
  if (Array.isArray(source)) {
    return source;
  }

  if (!isRecord(source)) {
    return [];
  }

  const queue = source.queue;
  if (Array.isArray(queue)) {
    return queue;
  }

  const commands = source.commands;
  if (Array.isArray(commands)) {
    return commands;
  }

  const nestedData = isRecord(source.data) ? source.data : null;
  const nestedQueue = nestedData?.queue;
  return Array.isArray(nestedQueue) ? nestedQueue : [];
}

async function readCommands(): Promise<unknown[]> {
  return readCommandQueueFile(COMMAND_FILE_PATH);
}

async function readArchivedCommands(): Promise<unknown[]> {
  return readCommandQueueFile(COMMAND_ARCHIVE_FILE_PATH);
}

function toCommandUpdatePayload(entry: unknown): ServerCommandUpdatePayload | null {
  if (!isRecord(entry)) {
    return null;
  }

  const commandId = asString(entry.id);
  const message = asString(entry.command) ?? asString(entry.message);
  if (commandId === null || message === null) {
    return null;
  }

  return {
    commandId,
    issuedBy: 'shogun',
    message,
    targetWorkerIds: [],
    createdAt: asTimestamp(entry.timestamp ?? entry.createdAt),
  };
}

function toCommandUpdatePayloadList(entries: unknown[]): ServerCommandUpdatePayload[] {
  return entries
    .map(toCommandUpdatePayload)
    .filter((entry): entry is ServerCommandUpdatePayload => entry !== null);
}

function toLatestCommandUpdatePayload(payload: unknown): ServerCommandUpdatePayload | null {
  const direct = toCommandUpdatePayload(payload);
  if (direct !== null) {
    return direct;
  }

  if (!isRecord(payload) || !Array.isArray(payload.commands)) {
    return null;
  }

  for (let index = payload.commands.length - 1; index >= 0; index -= 1) {
    const normalized = toCommandUpdatePayload(payload.commands[index]);
    if (normalized !== null) {
      return normalized;
    }
  }

  return null;
}

function extractCommandTitle(commandText: string): string | null {
  const lines = commandText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines[0] ?? null;
}

function truncateText(text: string, maxLength: number): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const safeLength = Math.max(1, maxLength - 1);
  return `${normalized.slice(0, safeLength)}…`;
}

interface ArchivedCommandSummary {
  id: string;
  command: string;
  status: string;
  completed_at: string | null;
  note: string | null;
}

function toArchivedCommandSummary(command: unknown): ArchivedCommandSummary | null {
  if (!isRecord(command)) {
    return null;
  }

  const id = asString(command.id);
  if (id === null) {
    return null;
  }

  const commandText =
    asString(command.title) ?? asString(command.command) ?? asString(command.message) ?? '';
  const commandTitle =
    commandText.length > 0
      ? truncateText(extractCommandTitle(commandText) ?? commandText, 80)
      : '（概要なし）';
  const status = asString(command.status) ?? 'unknown';
  const completedAt = asString(command.completed_at) ?? asString(command.created_at);
  const result = isRecord(command.result) ? command.result : null;
  const noteSource = asString(command.note) ?? (result ? asString(result.note) : null);
  const note = noteSource ? truncateText(noteSource, 120) : null;

  return {
    id,
    command: commandTitle,
    status,
    completed_at: completedAt,
    note,
  };
}

function resolveCommandIdSortWeight(commandId: string): number | null {
  const matched = commandId.match(/(\d+)(?!.*\d)/);
  if (!matched) {
    return null;
  }

  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function sortArchivedCommandsByIdDesc(
  left: ArchivedCommandSummary,
  right: ArchivedCommandSummary
): number {
  const leftWeight = resolveCommandIdSortWeight(left.id);
  const rightWeight = resolveCommandIdSortWeight(right.id);

  if (leftWeight !== null && rightWeight !== null && leftWeight !== rightWeight) {
    return rightWeight - leftWeight;
  }

  if (leftWeight !== null && rightWeight === null) {
    return -1;
  }

  if (leftWeight === null && rightWeight !== null) {
    return 1;
  }

  return right.id.localeCompare(left.id, 'ja');
}

function buildCommandTitleById(commands: unknown[]): Map<string, string> {
  const commandTitleById = new Map<string, string>();

  for (const command of commands) {
    if (!isRecord(command)) {
      continue;
    }

    const commandId = asString(command.id);
    const commandText = asString(command.command) ?? asString(command.message);
    if (commandId === null || commandText === null) {
      continue;
    }

    const commandTitle = extractCommandTitle(commandText);
    if (commandTitle !== null) {
      commandTitleById.set(commandId, commandTitle);
    }
  }

  return commandTitleById;
}

function buildCommandTitleMap(
  activeCommands: unknown[],
  archivedCommands: unknown[]
): Map<string, string> {
  const commandTitleById = buildCommandTitleById(archivedCommands);

  for (const [commandId, commandTitle] of buildCommandTitleById(activeCommands).entries()) {
    commandTitleById.set(commandId, commandTitle);
  }

  return commandTitleById;
}

async function readCommandTitleByIdMap(): Promise<Map<string, string>> {
  const [activeCommands, archivedCommands] = await Promise.all([
    readCommands(),
    readArchivedCommands(),
  ]);
  return buildCommandTitleMap(activeCommands, archivedCommands);
}

async function getCommandTitleByIdMapCached(forceRefresh = false): Promise<Map<string, string>> {
  if (!forceRefresh && !commandTitleByIdDirty && commandTitleByIdCache.size > 0) {
    return commandTitleByIdCache;
  }

  commandTitleByIdCache = await readCommandTitleByIdMap();
  commandTitleByIdDirty = false;
  return commandTitleByIdCache;
}

function resolveTaskTitle(
  task: LooseRecord,
  commandTitleById: ReadonlyMap<string, string>
): string | null {
  const parentCmd = asString(task.parent_cmd);
  if (parentCmd === null) {
    return null;
  }

  return commandTitleById.get(parentCmd) ?? null;
}

function getCommanderNamesFromState(rawState: unknown): Record<CommanderId, string> {
  const state = isRecord(rawState) ? rawState : {};
  const source = isRecord(state.commanderNames) ? state.commanderNames : {};

  const next: Record<CommanderId, string> = {
    ...DEFAULT_COMMANDER_NAMES,
  };

  for (const commanderId of Object.keys(DEFAULT_COMMANDER_NAMES) as CommanderId[]) {
    const candidate = asString(source[commanderId]);
    if (candidate !== null) {
      next[commanderId] = candidate;
    }
  }

  return next;
}

function resolveAgentDisplayName(rawState: unknown, agentId: AgentId): string {
  if (agentId === 'shogun' || agentId === 'karo') {
    return getCommanderNamesFromState(rawState)[agentId];
  }

  const state = isRecord(rawState) ? rawState : {};
  const ashigaru = Array.isArray(state.ashigaru) ? state.ashigaru : [];
  for (const member of ashigaru) {
    if (!isRecord(member) || normalizeWorkerId(member.id) !== agentId) {
      continue;
    }

    const name = asString(member.name);
    if (name !== null) {
      return name;
    }
  }

  return WORKER_LABELS[agentId];
}

function normalizeAgentName(value: unknown): string | null {
  const name = asString(value);
  if (name === null) {
    return null;
  }

  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 1 || trimmed.length > 40) {
    return null;
  }

  return trimmed;
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

interface AgentCurrentTask {
  taskId: string | null;
  status: string | null;
  category: string | null;
  description: string | null;
  timestamp: string | null;
}

function parseTaskSnapshot(snapshot: unknown): AgentCurrentTask | null {
  if (!isRecord(snapshot) || !isRecord(snapshot.task)) {
    return null;
  }

  const task = snapshot.task;
  const description = sanitizeOptionalUserFacingText(asString(task.description));
  const categoryLabel = toUserFacingTaskCategoryLabel(task.category);
  return {
    taskId: toUserFacingTaskLabel(asString(task.task_id), description, categoryLabel),
    status: asString(task.status),
    category: categoryLabel,
    description,
    timestamp: asString(task.timestamp),
  };
}

function parseReportHistoryEntries(snapshot: unknown, workerId: WorkerId): AgentHistoryEntry[] {
  if (!isRecord(snapshot)) {
    return [];
  }

  const result = isRecord(snapshot.result) ? snapshot.result : {};
  const timestamp = asString(snapshot.timestamp) ?? new Date(0).toISOString();
  const status = asString(snapshot.status) ?? 'unknown';
  const rawSummary = asString(result.summary) ?? asString(snapshot.summary);
  const summary = sanitizeOptionalUserFacingText(rawSummary);
  const notes = sanitizeOptionalUserFacingText(asString(result.notes));
  const taskCategoryLabel = toUserFacingTaskCategoryLabel(
    inferCategoryFromText(`${asString(snapshot.task_id) ?? ''} ${rawSummary ?? ''} ${notes ?? ''}`)
  );
  const taskId = toUserFacingTaskLabel(asString(snapshot.task_id), summary, taskCategoryLabel);
  const parentCmd = sanitizeInternalCommandId(asString(snapshot.parent_cmd));
  const entries: AgentHistoryEntry[] = [];

  if (summary !== null) {
    entries.push({
      id: `${workerId}-summary-${timestamp}`,
      timestamp,
      status,
      message: summary,
      taskId,
      parentCmd,
      source: 'report',
    });
  }

  if (notes !== null) {
    for (const [index, line] of notes
      .split('\n')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .entries()) {
      entries.push({
        id: `${workerId}-note-${timestamp}-${index + 1}`,
        timestamp,
        status,
        message: line,
        taskId,
        parentCmd,
        source: 'note',
      });
    }
  }

  return entries;
}

function parseCommanderHistoryEntries(
  commands: unknown[],
  commanderId: CommanderId
): AgentHistoryEntry[] {
  const entries: AgentHistoryEntry[] = [];
  for (const [index, command] of commands.entries()) {
    if (!isRecord(command)) {
      continue;
    }

    const id = asString(command.id);
    const timestamp = asString(command.timestamp);
    const message = asString(command.message) ?? asString(command.command);
    if (id === null || timestamp === null || message === null) {
      continue;
    }

    const firstLine = message
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!firstLine) {
      continue;
    }

    const userFacingMessage = sanitizeUserFacingText(firstLine);
    const parentCmd = sanitizeInternalCommandId(id);

    entries.push({
      id: `${commanderId}-command-${timestamp}-${index + 1}`,
      timestamp,
      status: asString(command.status) ?? 'in_progress',
      message: userFacingMessage,
      taskId: null,
      parentCmd,
      source: 'command',
    });
  }

  return entries;
}

function sortHistoryEntries(entries: AgentHistoryEntry[]): AgentHistoryEntry[] {
  return [...entries].sort((left, right) => {
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return right.id.localeCompare(left.id);
  });
}

interface GameStateReadResult {
  state: unknown;
  mtimeMs: number | null;
}

async function readGameStateFileMtimeMs(): Promise<number | null> {
  try {
    const stat = await fs.stat(GAME_STATE_FILE_PATH);
    return Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function hasSameMtimeMs(left: number | null, right: number | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  return Math.abs(left - right) <= GAME_STATE_MTIME_MATCH_EPSILON_MS;
}

async function isCurrentGameStateSnapshot(expectedMtimeMs: number | null): Promise<boolean> {
  const currentMtimeMs = await readGameStateFileMtimeMs();
  return hasSameMtimeMs(currentMtimeMs, expectedMtimeMs);
}

async function readGameStateSnapshot(): Promise<GameStateReadResult> {
  const result = await readYamlFile<LooseRecord>(GAME_STATE_FILE_PATH);
  const mtimeMs = await readGameStateFileMtimeMs();
  if (result.error !== null) {
    console.warn(`[game-state] YAML parse error at ${GAME_STATE_FILE_PATH}: ${result.error}`);
    throw createGameStateUnavailableError(result.error);
  }

  if (!isRecord(result.data)) {
    return {
      state: getDefaultGameState(),
      mtimeMs,
    };
  }

  return {
    state: await sanitizeGameStateForPersistence(result.data as LooseRecord),
    mtimeMs,
  };
}

async function readGameState(): Promise<unknown> {
  const snapshot = await readGameStateSnapshot();
  return snapshot.state;
}

async function buildInitialState(): Promise<InitialStatePayload> {
  const [
    taskSnapshots,
    reportSnapshots,
    dashboard,
    commands,
    archivedCommands,
    rawGameState,
    contextStats,
  ] = await Promise.all([
    getTaskSnapshotsCached(),
    getReportSnapshotsCached(),
    readDashboardMarkdown(),
    readCommands(),
    readArchivedCommands(),
    readGameState(),
    readContextStats(),
  ]);

  const commandTitleById =
    commandTitleByIdDirty || commandTitleByIdCache.size === 0
      ? buildCommandTitleMap(commands, archivedCommands)
      : commandTitleByIdCache;
  commandTitleByIdCache = commandTitleById;
  commandTitleByIdDirty = false;

  const tasks = taskSnapshots
    .map((entry) => toTaskPayload(entry, commandTitleById))
    .filter((task): task is ServerTaskUpdatePayload => task !== null);
  const allReports = reportSnapshots
    .map(toReportPayload)
    .filter((report): report is ServerReportUpdatePayload => report !== null);

  const currentTaskByWorker = new Map<WorkerId, string>(
    tasks.map((task) => [task.assigneeId as WorkerId, task.taskId])
  );
  const reports = allReports.filter((report) => {
    const currentTaskId = currentTaskByWorker.get(report.workerId as WorkerId);
    return currentTaskId !== undefined && report.taskId === currentTaskId;
  });
  const gameState = toGameState(rawGameState, tasks, allReports, taskSnapshots, reportSnapshots);
  const normalizedCommands = toCommandUpdatePayloadList(commands);

  return {
    tasks,
    reports,
    dashboard,
    commands: normalizedCommands,
    gameState,
    contextStats,
  };
}

async function getInitialStateCached(forceRefresh: boolean = false): Promise<InitialStatePayload> {
  if (!forceRefresh && initialStateCache !== null && !initialStateDirty) {
    return initialStateCache;
  }

  const nextState = await buildInitialState();
  initialStateCache = nextState;
  initialStateDirty = false;
  return nextState;
}

async function buildBroadcastGameState(rawState: LooseRecord): Promise<GameState> {
  const [taskSnapshots, reportSnapshots] = await Promise.all([
    getTaskSnapshotsCached(),
    getReportSnapshotsCached(),
  ]);
  const tasks = taskSnapshots
    .map((entry) => toTaskPayload(entry))
    .filter((task): task is ServerTaskUpdatePayload => task !== null);
  const reports = reportSnapshots
    .map(toReportPayload)
    .filter((report): report is ServerReportUpdatePayload => report !== null);

  return toGameState(rawState, tasks, reports, taskSnapshots, reportSnapshots);
}

interface QueueGameStateWriteOptions {
  onReadOnly?: 'throw' | 'skip';
}

async function queueGameStateWrite(
  nextState: LooseRecord,
  options: QueueGameStateWriteOptions = {}
): Promise<void> {
  const onReadOnly = options.onReadOnly ?? 'throw';
  gameStateWriteQueue = gameStateWriteQueue
    .catch(() => undefined)
    .then(async () => {
      for (let attempt = 0; attempt <= GAME_STATE_CAS_RETRY_ATTEMPTS; attempt += 1) {
        let snapshot: GameStateReadResult;
        try {
          snapshot = await readGameStateSnapshot();
        } catch (error) {
          if (onReadOnly === 'skip' && isGameStateUnavailableError(error)) {
            const message = error instanceof Error ? error.message : 'Game state unavailable.';
            console.warn(`[game-state] Persist skipped: ${message}`);
            return;
          }
          throw error;
        }

        const normalizedState = await sanitizeGameStateForPersistence(nextState);
        syncEconomyWithTownInPlace(normalizedState);

        const isLatestSnapshot = await isCurrentGameStateSnapshot(snapshot.mtimeMs);
        if (!isLatestSnapshot) {
          if (attempt < GAME_STATE_CAS_RETRY_ATTEMPTS) {
            continue;
          }
          throw createGameStateConflictError(
            'Persist rejected due to concurrent game-state update.'
          );
        }

        await writeYamlFile(GAME_STATE_FILE_PATH, normalizedState);
        markInitialStateDirty();
        return;
      }
    });

  await gameStateWriteQueue;
}

interface QueuedGameStateMutationResult<T> {
  nextState: LooseRecord | null;
  result: T;
}

async function queueGameStateMutation<T>(
  mutate: (
    currentState: LooseRecord
  ) => Promise<QueuedGameStateMutationResult<T>> | QueuedGameStateMutationResult<T>
): Promise<T> {
  let resolved = false;
  let mutationResult: T | null = null;

  gameStateWriteQueue = gameStateWriteQueue
    .catch(() => undefined)
    .then(async () => {
      for (let attempt = 0; attempt <= GAME_STATE_CAS_RETRY_ATTEMPTS; attempt += 1) {
        const snapshot = await readGameStateSnapshot();
        const rawState = snapshot.state;
        const currentState = await sanitizeGameStateForPersistence(
          isRecord(rawState)
            ? ({ ...rawState } as LooseRecord)
            : (getDefaultGameState() as unknown as LooseRecord)
        );
        const { nextState, result } = await mutate(currentState);
        if (nextState !== null) {
          const normalizedState = await sanitizeGameStateForPersistence(nextState);
          syncEconomyWithTownInPlace(normalizedState);

          const isLatestSnapshot = await isCurrentGameStateSnapshot(snapshot.mtimeMs);
          if (!isLatestSnapshot) {
            if (attempt < GAME_STATE_CAS_RETRY_ATTEMPTS) {
              continue;
            }
            throw createGameStateConflictError(
              'Mutation rejected due to concurrent game-state update.'
            );
          }

          await writeYamlFile(GAME_STATE_FILE_PATH, normalizedState);
          if (isRecord(result) && Object.prototype.hasOwnProperty.call(result, 'broadcastState')) {
            (result as LooseRecord).broadcastState = await buildBroadcastGameState(normalizedState);
          }
          markInitialStateDirty();
        }

        mutationResult = result;
        resolved = true;
        return;
      }

      throw createGameStateConflictError(
        'Mutation retry limit exceeded due to concurrent game-state updates.'
      );
    });

  await gameStateWriteQueue;

  if (!resolved || mutationResult === null) {
    throw new Error('Failed to mutate game-state.');
  }

  return mutationResult;
}

function toSafeInt(value: unknown): number {
  const num = toNumber(value);
  if (num === null) {
    return 0;
  }

  return Math.max(0, Math.floor(num));
}

function applyMissionRewardToTown(
  currentTown: unknown,
  rewardXp: number,
  rewardGold: number
): { level: number; xp: number; gold: number } {
  const normalized = normalizeTown(currentTown, 0);
  const xp = normalized.xp + Math.max(0, Math.floor(rewardXp));
  const gold = normalized.gold + Math.max(0, Math.floor(rewardGold));

  return normalizeTown(
    {
      ...normalized,
      xp,
      gold,
    },
    gold
  );
}

function deepMergeState(base: LooseRecord, patch: LooseRecord): LooseRecord {
  const merged: LooseRecord = {
    ...base,
  };

  for (const [key, value] of Object.entries(patch)) {
    const currentValue = merged[key];
    if (isRecord(currentValue) && isRecord(value)) {
      merged[key] = deepMergeState(currentValue, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function resolveGameStateFromBody(currentState: LooseRecord, body: unknown): LooseRecord | null {
  if (!isRecord(body)) {
    return null;
  }

  const patch = isRecord(body.state) ? body.state : body;
  return deepMergeState(currentState, patch);
}

function normalizeNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, value);
}

function normalizeEconomyPatch(payload: unknown): Partial<{ gold: number }> | null {
  if (!isRecord(payload)) {
    return null;
  }

  const patch: Partial<{ gold: number }> = {};
  const gold = normalizeNonNegativeNumber(payload.gold);

  if (gold !== null) {
    patch.gold = Math.floor(gold);
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function normalizeTownPatch(payload: unknown): Partial<{ xp: number; gold: number }> | null {
  if (!isRecord(payload)) {
    return null;
  }

  const xp = normalizeNonNegativeNumber(payload.xp);
  const gold = normalizeNonNegativeNumber(payload.gold);
  const patch: Partial<{ xp: number; gold: number }> = {};

  if (xp !== null) {
    patch.xp = Math.floor(xp);
  }
  if (gold !== null) {
    patch.gold = Math.floor(gold);
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

interface UpgradeBuildingPayload {
  buildingId: GameState['buildings'][number]['type'];
}

interface UpgradeCostQueryPayload {
  buildingId: UpgradeCostBuildingType;
  currentLevel: BuildingLevel;
}

interface PurchaseDecorationPayload {
  decorationId: string;
  position: { x: number; y: number };
}

function normalizeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null;
}

function normalizePositionPayload(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) {
    return null;
  }

  const x = normalizeInteger(value.x);
  const y = normalizeInteger(value.y);
  if (x === null || y === null) {
    return null;
  }

  return { x, y };
}

function normalizeUpgradeBuildingPayload(payload: unknown): UpgradeBuildingPayload | null {
  if (!isRecord(payload) || !isBuildingType(payload.buildingId)) {
    return null;
  }

  return {
    buildingId: payload.buildingId,
  };
}

function normalizeUpgradeCostQueryPayload(query: unknown): UpgradeCostQueryPayload | null {
  if (!isRecord(query)) {
    return null;
  }

  const buildingId = asString(query.buildingId);
  const currentLevel = toUpgradeCostLevel(query.currentLevel);
  if (buildingId === null || currentLevel === null || !isUpgradeCostBuildingType(buildingId)) {
    return null;
  }

  return {
    buildingId,
    currentLevel,
  };
}

function normalizePurchaseDecorationPayload(payload: unknown): PurchaseDecorationPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const decorationId = asString(payload.decorationId);
  const position = normalizePositionPayload(payload.position);
  if (decorationId === null || position === null) {
    return null;
  }

  return {
    decorationId,
    position,
  };
}

function resolveDecorationCost(decorationId: string): number | null {
  const fromItemMaster = ITEM_MASTER_BY_ID.get(decorationId);
  if (
    fromItemMaster !== undefined &&
    typeof fromItemMaster.shopCost === 'number' &&
    Number.isFinite(fromItemMaster.shopCost)
  ) {
    return Math.max(0, Math.floor(fromItemMaster.shopCost));
  }

  const normalizedDecorationId = decorationId.trim().toLowerCase();
  const mappedKey =
    DECORATION_COST_ALIASES[normalizedDecorationId] ??
    (normalizedDecorationId as DecorationCostKey);
  const fromEconomy = DECORATION_COSTS[mappedKey];
  if (typeof fromEconomy !== 'number' || !Number.isFinite(fromEconomy)) {
    return null;
  }

  return Math.max(0, Math.floor(fromEconomy));
}

function parsePositiveIntegerQuery(
  value: unknown,
  fallback: number,
  options?: {
    min?: number;
    max?: number;
  }
): number {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed =
    typeof candidate === 'string'
      ? Number.parseInt(candidate, 10)
      : typeof candidate === 'number'
        ? Math.floor(candidate)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  const min = options?.min ?? 1;
  const max = options?.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(Math.max(parsed, min), max);
}

interface UseItemPayload {
  itemId: string;
}

interface BuyItemPayload {
  itemId: string;
  quantity: number;
}

interface RenameAgentPayload {
  agentId: AgentId;
  name: string;
}

function normalizeUseItemPayload(payload: unknown): UseItemPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const itemId = asString(payload.itemId);
  if (itemId === null) {
    return null;
  }

  return { itemId };
}

function normalizeBuyItemPayload(payload: unknown): BuyItemPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const itemId = asString(payload.itemId);
  if (itemId === null) {
    return null;
  }

  const quantityRaw = normalizeInteger(payload.quantity);
  const quantity = quantityRaw === null ? 1 : Math.max(1, Math.min(99, quantityRaw));

  return {
    itemId,
    quantity,
  };
}

function normalizeRenameAgentPayload(payload: unknown): RenameAgentPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const agentId = normalizeAgentId(payload.agentId);
  const name = normalizeAgentName(payload.name);
  if (agentId === null || name === null) {
    return null;
  }

  return {
    agentId,
    name,
  };
}

const gameStateService = {
  readGameState,
  buildInitialState,
  getInitialStateCached,
  readContextStats,
  getTaskSnapshotsCached,
  getReportSnapshotsCached,
  getCommandTitleByIdMapCached,
  readArchivedCommands,
  readCommands,
  queueGameStateWrite,
  queueGameStateMutation,
  persistDerivedGameStateIfNeeded,
  toTaskPayload,
  toReportPayload,
};

const gameLogicService = {
  toGameState,
  getDefaultGameState,
  normalizeTownFromState,
  normalizeTown,
  normalizeInventory,
  getDefaultInventory,
  toInventoryMap,
  inventoryFromMap,
  collectMissingUpgradeMaterials,
  formatUpgradeCost,
  resolveUpgradeCost,
  applyMissionRewardToTown,
  normalizeBuildings,
  normalizeBuildingLevel,
  findBuildingLevel,
  applyUpgradeMaterialCost,
  toBuildingState,
  resolveBuildingProductionProfile,
  isUpgradeCostBuildingType,
  clampDecorationPosition,
  resolveDecorationCost,
  normalizeDecorationsForState,
  createBuildingOccupiedTiles,
  toDecorationTileKey,
  normalizeUpgradeBuildingPayload,
  normalizeUpgradeCostQueryPayload,
  normalizePurchaseDecorationPayload,
  normalizeEconomyPatch,
  normalizeTownPatch,
  normalizeUseItemPayload,
  normalizeBuyItemPayload,
  normalizeRenameAgentPayload,
  appendActivityLog,
  createActivityLogEntry,
  resolveBuildingLabel,
  resolveGameStateFromBody,
  asString,
  isRecord,
  toSafeInt,
};

registerApiRoutes(app, {
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
});

registerWebSocketHandlers({
  httpServer,
  wss,
  getInitialStateCached,
  isAllowedWsOrigin,
  viteDevHost: VITE_DEV_HOST,
  viteDevPort: VITE_DEV_PORT,
});
const watcher = createFileWatcher({
  rootDir: BASE_DIR,
  onMessage: (type, payload) => {
    void (async () => {
      console.log('[watcher-debug]', type, payload);
      markInitialStateDirty();

      if (type === 'task_update') {
        taskSnapshotsDirty = true;
      }
      if (type === 'report_update') {
        reportSnapshotsDirty = true;
      }
      if (type === 'command_update') {
        commandTitleByIdDirty = true;
      }

      if (type === 'command_update') {
        try {
          await getCommandTitleByIdMapCached(true);
        } catch (error) {
          console.error('[watcher] command title cache refresh error:', error);
        }
      }

      const normalized = normalizeWatcherPayload(type, payload);
      if (normalized !== null) {
        broadcast(type, normalized);
      }

      if (type === 'task_update' || type === 'report_update') {
        try {
          if (type === 'task_update' && normalized !== null) {
            await persistTaskAssignedAt(normalized as ServerTaskUpdatePayload);
          }
          if (type === 'report_update' && normalized !== null) {
            await applyTaskCompletionReward(normalized as ServerReportUpdatePayload);
          }
        } catch (error) {
          console.error('[watcher] task/report side-effect error:', error);
        }
      }
    })();
  },
  onError: (error) => {
    console.error('[watcher] error:', error);
  },
});

httpServer.listen(PORT, SERVER_HOST, () => {
  console.log(`Server listening on http://${SERVER_HOST}:${PORT}`);
});

async function shutdown(): Promise<void> {
  await watcher.close();
  wss.close();
  httpServer.close();
}

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});
