import type { GameState, TaskCategory } from '../src/types/game';
export type { WSEventType, WSMessage } from '../src/types/ws';

export interface ServerTaskUpdatePayload {
  taskId: string;
  taskTitle: string | null;
  assigneeId: string;
  category: TaskCategory;
  status: 'assigned' | 'in_progress' | 'done' | 'failed' | 'blocked';
  updatedAt: string;
}

export interface ServerReportUpdatePayload {
  reportId: string;
  taskId: string;
  workerId: string;
  status: 'done' | 'failed' | 'blocked';
  summary: string;
  createdAt: string;
}

export interface ServerDashboardUpdatePayload {
  content: string;
  deleted?: boolean;
  error?: string;
}

export interface ServerCommandUpdatePayload {
  commandId: string;
  issuedBy: string;
  message: string;
  targetWorkerIds: string[];
  createdAt: string;
}

export type ServerGameStateUpdatePayload = GameState;

export interface ServerInitialStatePayload {
  dashboard: string;
  gameState: GameState;
}

export interface APIResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface TaskYamlSnapshot {
  task_id: string;
  parent_cmd: string;
  project?: string;
  description: string;
  target_path: string;
  status: string;
  timestamp: string;
}

export interface ReportYamlSnapshot {
  worker_id: string;
  task_id: string;
  parent_cmd: string;
  timestamp: string;
  status: 'done' | 'failed' | 'blocked';
  result: {
    summary: string;
    files_modified: string[];
    notes: string;
  };
}
