import type { InventoryItem } from './item';

export type BuildingType =
  | 'castle'
  | 'mansion'
  | 'inn'
  | 'dojo'
  | 'smithy'
  | 'training'
  | 'study'
  | 'healer'
  | 'watchtower'
  | 'scriptorium';

export type TaskCategory =
  | 'new_implementation'
  | 'refactoring'
  | 'skill_creation'
  | 'analysis'
  | 'bug_fix'
  | 'docs'
  | 'test'
  | 'idle'
  | 'other';

export const INN_BUILDING_TYPE: BuildingType = 'inn';

export const TASK_TO_BUILDING_MAP: Record<TaskCategory, BuildingType> = {
  new_implementation: 'dojo',
  refactoring: 'smithy',
  skill_creation: 'training',
  analysis: 'study',
  bug_fix: 'healer',
  docs: 'scriptorium',
  test: 'watchtower',
  idle: INN_BUILDING_TYPE,
  other: INN_BUILDING_TYPE,
};

export type BuildingLevel = 1 | 2 | 3 | 4 | 5;

export const TOWN_LEVEL_XP_THRESHOLDS = [0, 150, 450, 1000, 2000, 3500, 5500] as const;

export interface Position {
  x: number;
  y: number;
}

export interface Building {
  type: BuildingType;
  level: BuildingLevel;
  position: Position;
}

export type AshigaruStatus = 'idle' | 'working' | 'blocked' | 'offline';

/**
 * Source of truth for assignment lifecycle is queue/tasks/*.yaml.
 * This state is a synchronized snapshot delivered to clients.
 */
export interface AshigaruState {
  id: string;
  name: string;
  status: AshigaruStatus;
  /**
   * Assignment identifier for active work. Non-working members should be null.
   * When queue/task synchronization is behind, non-null values may be stale hints.
   */
  taskId: string | null;
  taskCategory: TaskCategory;
  assignedAt?: string | null;
  position: Position;
}

export interface TownRank {
  value: number;
  title: string;
  nextRequiredXP: number | null;
}

export interface TownState {
  level: number;
  xp: number;
  gold: number;
  rank?: number | TownRank;
}

export interface Decoration {
  id: string;
  type: string;
  position?: Position;
  level?: number;
  passiveEffect?: {
    type: 'gold_bonus' | 'xp_bonus' | 'drop_rate_bonus';
    bonusPerLevel: number;
  };
}

export interface Mission {
  id: string;
  title: string;
  conditions: string[];
  claimed?: boolean;
  resetAt?: string;
  period?: 'daily';
  reward: {
    xp: number;
    gold: number;
  };
  progress: {
    current: number;
    target: number;
  };
}

export interface Achievement {
  id: string;
  category: string;
  name: string;
  description: string;
  thresholds: number[];
  currentValue: number;
  unlockedAt?: string;
}

export interface Title {
  id: string;
  name: string;
  description: string;
  condition: string;
  category?: 'martial' | 'construction' | 'magistrate' | 'collection';
  unlockedAt?: string;
}

export interface DailyRecord {
  date: string;
  xp: number;
  gold: number;
  tasksCompleted: number;
  consecutiveCompletions: number;
  previousBest: number;
}

export interface MaterialCollection {
  itemId: string;
  firstObtainedAt?: string;
  count: number;
}

export interface MaterialDropNoticeItem {
  itemId: string;
  quantity: number;
  name?: string;
}

export interface MaterialDropNotice {
  workerId: string;
  taskId: string;
  drops: MaterialDropNoticeItem[];
  /**
   * Existing persisted payloads use createdAt.
   * timestamp can be used by new producers as the canonical event field.
   */
  timestamp?: string;
  createdAt: string;
  buildingType?: BuildingType;
  buildingLevel?: BuildingLevel;
  message?: string;
}

export interface EconomyState {
  gold: number;
}

export type ActivityLogType =
  | 'work_start'
  | 'work_complete'
  | 'purchase'
  | 'item_consume'
  | 'building_upgrade'
  | 'mission_complete';

export interface ActivityLogItem {
  itemId: string;
  name: string;
  quantity: number;
}

export interface ActivityLogEntry {
  id: string;
  type: ActivityLogType;
  timestamp: string;
  workerId?: string;
  workerName?: string;
  buildingType?: BuildingType;
  buildingLevel?: number;
  taskCategory?: TaskCategory;
  durationMinutes?: number;
  gold?: number;
  xp?: number;
  items?: ActivityLogItem[];
  message: string;
}

export interface GameState {
  /**
   * Snapshot view derived from queue/tasks and reports.
   */
  ashigaru: AshigaruState[];
  buildings: Building[];
  town: TownState;
  economy: EconomyState;
  inventory: InventoryItem[];
  decorations: Decoration[];
  missions: Mission[];
  activityLog: ActivityLogEntry[];
  achievements: Achievement[];
  titles: Title[];
  equippedTitle: string | null;
  dailyRecords: DailyRecord[];
  materialCollection: MaterialCollection[];
  // null = no notice, undefined = legacy payload before migration.
  lastMaterialDrop?: MaterialDropNotice | null;
}
