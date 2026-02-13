import type { GameState, TaskCategory } from './game';
export type { WSEventType, WSMessage } from './ws';

export interface TaskUpdatePayload {
  taskId: string;
  taskTitle: string | null;
  assigneeId: string;
  category: TaskCategory;
  status: 'assigned' | 'in_progress' | 'done' | 'failed' | 'blocked';
  updatedAt: string;
}

export interface ReportUpdatePayload {
  reportId: string;
  taskId: string;
  workerId: string;
  status: 'done' | 'failed' | 'blocked';
  summary: string;
  createdAt: string;
}

export interface DashboardUpdatePayload {
  content: string;
  deleted?: boolean;
  error?: string;
}

interface CommandUpdatePayloadCommon {
  status?: string;
  project?: string;
  priority?: string;
  [key: string]: unknown;
}

export interface LegacyCommandUpdatePayload extends CommandUpdatePayloadCommon {
  id: string;
  command: string;
  timestamp: string;
  commandId?: string;
  issuedBy?: string;
  message?: string;
  targetWorkerIds?: string[];
  createdAt?: string;
}

export interface ServerCommandUpdatePayload extends CommandUpdatePayloadCommon {
  commandId: string;
  issuedBy: string;
  message: string;
  targetWorkerIds: string[];
  createdAt: string;
  id?: string;
  command?: string;
  timestamp?: string;
}

export type CommandUpdatePayload = LegacyCommandUpdatePayload | ServerCommandUpdatePayload;

export interface WsErrorPayload {
  code: string;
  message: string;
  recoverable?: boolean;
}

export interface ContextStat {
  workerId: string;
  role?: 'ashigaru' | 'shogun' | 'karo';
  label?: string;
  pane: string | null;
  status?: 'idle' | 'working' | 'unknown';
  contextPercent: number | null;
  capturedAt: string;
}

export type GameStateUpdatePayload = GameState;

export interface InitialStatePayload {
  dashboard: string;
  gameState: GameState;
  tasks?: TaskUpdatePayload[];
  reports?: ReportUpdatePayload[];
  commands?: CommandUpdatePayload[];
  contextStats?: ContextStat[];
}

export type WSPayloadMap = {
  task_update: TaskUpdatePayload;
  report_update: ReportUpdatePayload;
  dashboard_update: DashboardUpdatePayload;
  command_update: CommandUpdatePayload;
  game_state_update: GameStateUpdatePayload;
  initial_state: InitialStatePayload;
  ws_error: WsErrorPayload;
};

export interface APIResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}
