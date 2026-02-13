import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CommandUpdatePayload,
  ContextStat,
  DashboardUpdatePayload,
  GameState,
  ReportUpdatePayload,
  TaskUpdatePayload,
  WSMessage,
  WSEventType,
} from '@/types';
import { useCommandStore } from '@/store/commandStore';
import { useDashboardStore } from '@/store/dashboardStore';
import { useGameStore } from '@/store/gameStore';
import { useContextStore } from '@/store/contextStore';
import { useReportStore } from '@/store/reportStore';
import { useTaskStore } from '@/store/taskStore';
import { logger } from '@/lib/logger';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

const DEFAULT_WS_PATH = '/ws';
const BASE_RECONNECT_INTERVAL_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;
const LOW_FREQUENCY_RECONNECT_INTERVAL_MS = 60000;
const RECONNECT_COUNTDOWN_INTERVAL_MS = 1000;
const GAME_STATE_SYNC_DEBOUNCE_MS = 300;
const MAX_SYNCED_DONE_REPORT_IDS = 1000;
const WS_AUTH_TOKEN_QUERY_PARAM = 'token';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isTaskPayload = (value: unknown): value is TaskUpdatePayload =>
  isRecord(value) && typeof value.taskId === 'string' && typeof value.assigneeId === 'string';

const isReportPayload = (value: unknown): value is ReportUpdatePayload =>
  isRecord(value) && typeof value.reportId === 'string' && typeof value.workerId === 'string';

const toTimestamp = (value: string): number => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const toLatestReportByWorkerMap = (
  reports: ReportUpdatePayload[]
): Map<string, ReportUpdatePayload> => {
  const latestByWorker = new Map<string, ReportUpdatePayload>();
  reports
    .slice()
    .sort((left, right) => toTimestamp(left.createdAt) - toTimestamp(right.createdAt))
    .forEach((report) => {
      latestByWorker.set(report.workerId, report);
    });

  return latestByWorker;
};

const reconcileTaskWithReport = (
  task: TaskUpdatePayload,
  report: ReportUpdatePayload
): TaskUpdatePayload => {
  if (task.taskId !== report.taskId) {
    return task;
  }

  if (task.status === report.status && task.updatedAt === report.createdAt) {
    return task;
  }

  return {
    ...task,
    status: report.status,
    updatedAt: report.createdAt,
  };
};

const reconcileTasksWithReports = (
  tasks: TaskUpdatePayload[],
  reports: ReportUpdatePayload[]
): TaskUpdatePayload[] => {
  if (tasks.length < 1 || reports.length < 1) {
    return tasks;
  }

  const latestReportByWorker = toLatestReportByWorkerMap(reports);
  return tasks.map((task) => {
    const report = latestReportByWorker.get(task.assigneeId);
    if (!report) {
      return task;
    }

    return reconcileTaskWithReport(task, report);
  });
};

const normalizeCommandPayload = (value: unknown): CommandUpdatePayload | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id =
    typeof value.id === 'string'
      ? value.id
      : typeof value.commandId === 'string'
        ? value.commandId
        : null;
  const command =
    typeof value.command === 'string'
      ? value.command
      : typeof value.message === 'string'
        ? value.message
        : null;
  const timestamp =
    typeof value.timestamp === 'string'
      ? value.timestamp
      : typeof value.createdAt === 'string'
        ? value.createdAt
        : null;

  if (id === null || command === null || timestamp === null) {
    return null;
  }

  const targetWorkerIds = Array.isArray(value.targetWorkerIds)
    ? value.targetWorkerIds.filter((targetId): targetId is string => typeof targetId === 'string')
    : [];

  return {
    ...value,
    id,
    command,
    timestamp,
    status: typeof value.status === 'string' ? value.status : 'in_progress',
    commandId: typeof value.commandId === 'string' ? value.commandId : id,
    issuedBy: typeof value.issuedBy === 'string' ? value.issuedBy : '',
    message: typeof value.message === 'string' ? value.message : command,
    targetWorkerIds,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : timestamp,
  };
};

const normalizeCommandList = (value: unknown): CommandUpdatePayload[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeCommandPayload)
    .filter((payload): payload is CommandUpdatePayload => payload !== null);
};

const isCommandCollectionPayload = (value: unknown): value is { commands: unknown[] } =>
  isRecord(value) && Array.isArray(value.commands);

const isContextStat = (value: unknown): value is ContextStat =>
  isRecord(value) &&
  typeof value.workerId === 'string' &&
  (typeof value.pane === 'string' || value.pane === null) &&
  (typeof value.contextPercent === 'number' || value.contextPercent === null) &&
  typeof value.capturedAt === 'string';

const isGameStatePayload = (value: unknown): value is GameState =>
  isRecord(value) &&
  Array.isArray(value.ashigaru) &&
  Array.isArray(value.buildings) &&
  isRecord(value.town) &&
  isRecord(value.economy) &&
  Array.isArray(value.inventory) &&
  Array.isArray(value.decorations) &&
  Array.isArray(value.missions) &&
  Array.isArray(value.activityLog);

const isLegacyGameStateUpdatePayload = (value: unknown): value is { state: GameState } =>
  isRecord(value) && isGameStatePayload(value.state);

const isDashboardPayload = (value: unknown): value is DashboardUpdatePayload =>
  isRecord(value) && typeof value.content === 'string';

const isWSMessage = (value: unknown): value is WSMessage<unknown> & { type: WSEventType } =>
  isRecord(value) && typeof value.type === 'string' && 'payload' in value;

const normalizeDashboardContent = (payload: unknown): string | null => {
  if (typeof payload === 'string') {
    return payload;
  }

  if (isDashboardPayload(payload)) {
    return payload.content;
  }

  return null;
};

const parseNestedGameStatePayload = (payload: unknown): GameState | null => {
  if (isGameStatePayload(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return null;
  }

  if (isGameStatePayload(payload.state)) {
    return payload.state;
  }

  if (isGameStatePayload(payload.gameState)) {
    return payload.gameState;
  }

  return null;
};

const parseGameStateApiPayload = (payload: unknown): GameState | null => {
  if (isGameStatePayload(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return null;
  }

  if ('success' in payload) {
    if (payload.success === false) {
      return null;
    }

    if ('data' in payload) {
      return parseNestedGameStatePayload(payload.data);
    }
  }

  return parseNestedGameStatePayload(payload);
};

const resolveDefaultWebSocketUrl = (): string => {
  const envUrlCandidate =
    typeof import.meta.env.VITE_WS_URL === 'string' ? import.meta.env.VITE_WS_URL.trim() : '';
  if (envUrlCandidate.length > 0) {
    return envUrlCandidate;
  }

  if (typeof window !== 'undefined' && window.location.host.length > 0) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${window.location.host}${DEFAULT_WS_PATH}`;
  }

  return DEFAULT_WS_PATH;
};

const resolveWebSocketAuthToken = (): string => {
  const envTokenCandidate =
    typeof import.meta.env.VITE_SHOGUN_API_TOKEN === 'string'
      ? import.meta.env.VITE_SHOGUN_API_TOKEN.trim()
      : '';
  return envTokenCandidate;
};

const buildAuthenticatedWebSocketUrl = (candidateUrl: string, token: string): string => {
  const normalizedToken = token.trim();
  if (normalizedToken.length < 1) {
    return candidateUrl;
  }

  const fallbackOrigin =
    typeof window !== 'undefined' && window.location.origin.length > 0
      ? window.location.origin
      : 'http://localhost';

  try {
    const parsed = new URL(candidateUrl, fallbackOrigin);
    parsed.searchParams.set(WS_AUTH_TOKEN_QUERY_PARAM, normalizedToken);

    if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
      return parsed.toString();
    }

    parsed.protocol =
      typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return parsed.toString();
  } catch {
    return candidateUrl;
  }
};

const applyDashboardContent = (content: string): void => {
  useDashboardStore.getState().setDashboard(content);
};

const applyCommandUpdate = (payload: CommandUpdatePayload): void => {
  const commandStore = useCommandStore.getState();
  commandStore.setCommands([...commandStore.commands, payload]);
};

const applyContextStats = (payload: unknown): void => {
  if (!Array.isArray(payload)) {
    return;
  }

  useContextStore
    .getState()
    .setContextStats(payload.filter((stat): stat is ContextStat => isContextStat(stat)));
};

const normalizeTaskList = (payload: unknown): TaskUpdatePayload[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.filter((task): task is TaskUpdatePayload => isTaskPayload(task));
};

const normalizeReportList = (payload: unknown): ReportUpdatePayload[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.filter((report): report is ReportUpdatePayload => isReportPayload(report));
};

const applyInitialStatePayload = (payload: unknown): void => {
  if (!isRecord(payload)) {
    return;
  }

  const reports = normalizeReportList(payload.reports);
  const tasks = normalizeTaskList(payload.tasks);
  if (Array.isArray(payload.tasks)) {
    useTaskStore.getState().setAllTasks(reconcileTasksWithReports(tasks, reports));
  }

  if (Array.isArray(payload.reports)) {
    useReportStore.getState().setAllReports(reports);
  }

  if ('commands' in payload) {
    useCommandStore.getState().setCommands(normalizeCommandList(payload.commands));
  }

  const gameState = isGameStatePayload(payload.gameState) ? payload.gameState : null;
  if (gameState !== null) {
    useGameStore.getState().updateGameState(gameState);
  }

  applyContextStats(payload.contextStats);
  const content = normalizeDashboardContent(payload.dashboard);
  if (content !== null) {
    applyDashboardContent(content);
  }
};

export const useWebSocket = (url?: string) => {
  const wsUrl = useMemo(() => {
    const explicitUrl = typeof url === 'string' ? url.trim() : '';
    const resolvedUrl = explicitUrl.length > 0 ? explicitUrl : resolveDefaultWebSocketUrl();
    return buildAuthenticatedWebSocketUrl(resolvedUrl, resolveWebSocketAuthToken());
  }, [url]);

  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [nextReconnectInSeconds, setNextReconnectInSeconds] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectCountdownTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const syncedDoneReportIdsRef = useRef<Set<string>>(new Set());
  const stateSyncDebounceTimerRef = useRef<number | null>(null);

  const syncGameStateFromApi = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/game-state', { method: 'GET' });
      if (!response.ok) {
        return;
      }

      const payload = (await response.json().catch(() => null)) as unknown;
      const nextState = parseGameStateApiPayload(payload);
      if (nextState !== null) {
        useGameStore.getState().updateGameState(nextState);
      }
    } catch {
      // Ignore transient network errors; websocket/next sync will recover.
    }
  }, []);

  const clearGameStateSyncTimer = useCallback(() => {
    if (stateSyncDebounceTimerRef.current !== null) {
      window.clearTimeout(stateSyncDebounceTimerRef.current);
      stateSyncDebounceTimerRef.current = null;
    }
  }, []);

  const scheduleGameStateSync = useCallback((): void => {
    clearGameStateSyncTimer();
    stateSyncDebounceTimerRef.current = window.setTimeout(() => {
      stateSyncDebounceTimerRef.current = null;
      void syncGameStateFromApi();
    }, GAME_STATE_SYNC_DEBOUNCE_MS);
  }, [clearGameStateSyncTimer, syncGameStateFromApi]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearReconnectCountdownTimer = useCallback(() => {
    if (reconnectCountdownTimerRef.current !== null) {
      window.clearInterval(reconnectCountdownTimerRef.current);
      reconnectCountdownTimerRef.current = null;
    }
  }, []);

  const resolveReconnectDelayMs = (attempts: number): number => {
    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      return LOW_FREQUENCY_RECONNECT_INTERVAL_MS;
    }

    return Math.min(
      BASE_RECONNECT_INTERVAL_MS * 2 ** Math.max(0, attempts),
      LOW_FREQUENCY_RECONNECT_INTERVAL_MS
    );
  };

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current) {
      return;
    }

    setStatus('reconnecting');
    clearReconnectTimer();
    clearReconnectCountdownTimer();
    const currentAttempts = reconnectAttemptsRef.current;
    const reconnectDelayMs = resolveReconnectDelayMs(currentAttempts);
    const initialCountdownSeconds = Math.max(
      1,
      Math.ceil(reconnectDelayMs / RECONNECT_COUNTDOWN_INTERVAL_MS)
    );
    setNextReconnectInSeconds(initialCountdownSeconds);
    reconnectCountdownTimerRef.current = window.setInterval(() => {
      setNextReconnectInSeconds((previousSeconds) => {
        if (previousSeconds === null || previousSeconds <= 1) {
          clearReconnectCountdownTimer();
          return 1;
        }

        return previousSeconds - 1;
      });
    }, RECONNECT_COUNTDOWN_INTERVAL_MS);

    reconnectTimerRef.current = window.setTimeout(() => {
      clearReconnectCountdownTimer();
      setNextReconnectInSeconds(null);
      reconnectAttemptsRef.current = currentAttempts + 1;
      setReconnectAttempts(reconnectAttemptsRef.current);
      connectRef.current();
    }, reconnectDelayMs);
  }, [clearReconnectCountdownTimer, clearReconnectTimer]);

  const markDoneReportAsSynced = useCallback((reportId: string): boolean => {
    const syncedDoneReportIds = syncedDoneReportIdsRef.current;
    if (syncedDoneReportIds.has(reportId)) {
      return false;
    }

    syncedDoneReportIds.add(reportId);
    while (syncedDoneReportIds.size > MAX_SYNCED_DONE_REPORT_IDS) {
      const oldestSyncedId = syncedDoneReportIds.values().next().value;
      if (typeof oldestSyncedId !== 'string') {
        break;
      }
      syncedDoneReportIds.delete(oldestSyncedId);
    }

    return true;
  }, []);

  const handleMessage = useCallback(
    (event: MessageEvent<string>) => {
      let parsed: unknown;

      try {
        parsed = JSON.parse(event.data) as unknown;
      } catch {
        return;
      }

      if (!isWSMessage(parsed)) {
        return;
      }

      switch (parsed.type) {
        case 'task_update':
          if (isTaskPayload(parsed.payload)) {
            useTaskStore.getState().setTask(parsed.payload.assigneeId, parsed.payload);
            scheduleGameStateSync();
          }
          break;
        case 'report_update':
          if (isReportPayload(parsed.payload)) {
            useReportStore.getState().setReport(parsed.payload.workerId, parsed.payload);
            const taskStore = useTaskStore.getState();
            const currentTask = taskStore.tasks[parsed.payload.workerId] ?? null;
            if (currentTask) {
              const nextTask = reconcileTaskWithReport(currentTask, parsed.payload);
              if (nextTask !== currentTask) {
                taskStore.setTask(parsed.payload.workerId, nextTask);
              }
            }

            if (
              parsed.payload.status === 'done' &&
              markDoneReportAsSynced(parsed.payload.reportId)
            ) {
              scheduleGameStateSync();
            }
          }
          break;
        case 'dashboard_update': {
          const content = normalizeDashboardContent(parsed.payload);
          if (content !== null) {
            applyDashboardContent(content);
          }
          break;
        }
        case 'command_update':
          if (isCommandCollectionPayload(parsed.payload)) {
            useCommandStore.getState().setCommands(normalizeCommandList(parsed.payload.commands));
          } else {
            const payload = normalizeCommandPayload(parsed.payload);
            if (payload !== null) {
              applyCommandUpdate(payload);
            }
          }
          break;
        case 'game_state_update':
          if (isGameStatePayload(parsed.payload)) {
            useGameStore.getState().updateGameState(parsed.payload);
          } else if (isLegacyGameStateUpdatePayload(parsed.payload)) {
            useGameStore.getState().updateGameState(parsed.payload.state);
          }
          break;
        case 'initial_state':
          applyInitialStatePayload(parsed.payload);
          break;
        case 'ws_error': {
          const code =
            isRecord(parsed.payload) && typeof parsed.payload.code === 'string'
              ? parsed.payload.code
              : 'unknown';
          const message =
            isRecord(parsed.payload) && typeof parsed.payload.message === 'string'
              ? parsed.payload.message
              : 'unknown websocket error';
          logger.error(`[ws] server error (${code}): ${message}`, {
            payload: isRecord(parsed.payload) ? parsed.payload : undefined,
          });
          break;
        }
        default:
          break;
      }
    },
    [markDoneReportAsSynced, scheduleGameStateSync]
  );

  const connect = useCallback(() => {
    const current = wsRef.current;
    if (
      current &&
      (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    clearReconnectTimer();
    clearReconnectCountdownTimer();
    setNextReconnectInSeconds(null);
    setStatus(reconnectAttemptsRef.current > 0 ? 'reconnecting' : 'connecting');
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      reconnectAttemptsRef.current = 0;
      setReconnectAttempts(0);
      setStatus('connected');
    };

    socket.onmessage = handleMessage;

    socket.onerror = (error) => {
      logger.error('[ws] socket error', { error });
      socket.close();
    };

    socket.onclose = () => {
      wsRef.current = null;
      if (!shouldReconnectRef.current) {
        setStatus('disconnected');
        return;
      }
      scheduleReconnect();
    };
  }, [clearReconnectCountdownTimer, clearReconnectTimer, handleMessage, scheduleReconnect, wsUrl]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;
      clearReconnectTimer();
      clearReconnectCountdownTimer();
      clearGameStateSyncTimer();
      syncedDoneReportIdsRef.current.clear();
      const currentSocket = wsRef.current;
      wsRef.current = null;
      currentSocket?.close();
    };
  }, [clearGameStateSyncTimer, clearReconnectCountdownTimer, clearReconnectTimer, connect]);

  const reconnectNow = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    clearReconnectTimer();
    clearReconnectCountdownTimer();
    setNextReconnectInSeconds(null);
    connectRef.current();
  }, [clearReconnectCountdownTimer, clearReconnectTimer]);

  const sendMessage = useCallback((message: unknown): boolean => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return false;
    }

    wsRef.current.send(JSON.stringify(message));
    return true;
  }, []);

  return {
    status,
    reconnectAttempts,
    nextReconnectInSeconds,
    isConnected: status === 'connected',
    reconnectNow,
    sendMessage,
  };
};
