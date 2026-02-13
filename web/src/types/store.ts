import type { ReportUpdatePayload, TaskUpdatePayload } from './server';
import type {
  BuildingLevel,
  BuildingType,
  GameState,
  Position,
  TaskCategory,
  TownRank,
} from './game';
import type { ItemDefinition, InventoryItem } from './item';
import type { AlertIssueItem, ParsedLine } from '../components/RightPanel/dashboard/parsers';

export type TaskStoreRecord = Record<string, TaskUpdatePayload | null>;
export type ReportStoreRecord = Record<string, ReportUpdatePayload | null>;

export interface TaskStoreState {
  tasks: TaskStoreRecord;
  setTask: (workerId: string, data: TaskUpdatePayload | null) => void;
  setAllTasks: (data: TaskStoreRecord | TaskUpdatePayload[]) => void;
}

export interface ReportStoreState {
  reports: ReportStoreRecord;
  setReport: (workerId: string, data: ReportUpdatePayload | null) => void;
  setAllReports: (data: ReportStoreRecord | ReportUpdatePayload[]) => void;
}

export interface DashboardStoreState {
  content: string;
  parsedLines: ParsedLine[];
  alertIssueItems: AlertIssueItem[];
  hasAlerts: boolean;
  alertItems: string[];
  visibleAlertItems: string[];
  visibleAlertCount: number;
  setDashboard: (content: string) => void;
}

export interface GameStoreState {
  gameState: GameState | null;
  buildingLevels: Record<BuildingType, BuildingLevel>;
  townRank: TownRank;
  inventory: InventoryItem[];
  itemCatalog: ItemDefinition[];
  updateGameState: (state: GameState) => void;
  addTownXP: (input: {
    category: TaskCategory;
    completionTimeMinutes: number;
    completionStreak: number;
  }) => void;
  addGold: (amount: number) => void;
  upgradeBuilding: (type: BuildingType) => void;
  purchaseDecoration: (type: string, pos: Position) => void;
  loadItems: () => Promise<void>;
  consumeItem: (itemId: string) => Promise<{ success: boolean; message: string }>;
  buyItem: (itemId: string, quantity?: number) => Promise<{ success: boolean; message: string }>;
}

export interface ActivePopupState {
  type: string;
  data?: unknown;
}

export interface UIStoreState {
  selectedAshigaru: string | null;
  activePopup: ActivePopupState | null;
  selectAshigaru: (id: string | null) => void;
  openPopup: (type: string, data?: unknown) => void;
  closePopup: () => void;
}
