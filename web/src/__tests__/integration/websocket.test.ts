import { renderHook, act } from '@testing-library/react';
import type { WebSocketServer } from 'ws';
import { describe, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useCommandStore } from '@/store/commandStore';
import { useContextStore } from '@/store/contextStore';
import { useDashboardStore } from '@/store/dashboardStore';
import { useGameStore } from '@/store/gameStore';
import { useReportStore } from '@/store/reportStore';
import { useTaskStore } from '@/store/taskStore';
import { broadcastWsMessage } from '@server/ws/handler';
import type { GameState } from '@/types';

class MockBrowserWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockBrowserWebSocket[] = [];

  readonly url: string;
  readyState = MockBrowserWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockBrowserWebSocket.instances.push(this);
  }

  static reset(): void {
    MockBrowserWebSocket.instances = [];
  }

  send(_data: string): void {
    // No-op in test stub.
  }

  close(): void {
    this.triggerClose();
  }

  triggerOpen(): void {
    this.readyState = MockBrowserWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  triggerMessage(message: unknown): void {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    this.onmessage?.({ data } as MessageEvent<string>);
  }

  triggerClose(): void {
    if (this.readyState === MockBrowserWebSocket.CLOSED) {
      return;
    }

    this.readyState = MockBrowserWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }
}

interface MockWsClient {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
}

const createBaseGameState = (): GameState => ({
  ashigaru: [],
  buildings: [{ type: 'castle', level: 1, position: { x: 0, y: 0 } }],
  town: { level: 1, xp: 0, gold: 120 },
  economy: { gold: 120 },
  inventory: [],
  decorations: [],
  missions: [],
  activityLog: [],
  achievements: [],
  titles: [],
  equippedTitle: null,
  dailyRecords: [],
  materialCollection: [],
});

const resetStores = (): void => {
  useCommandStore.getState().setCommands([]);
  useContextStore.getState().setContextStats([]);
  useDashboardStore.getState().setDashboard('');
  useGameStore.getState().updateGameState(createBaseGameState());
  useReportStore.getState().setAllReports([]);
  useTaskStore.getState().setAllTasks([]);
};

const getFetchMock = (): ReturnType<typeof vi.fn> =>
  globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

const getLatestSocket = (): MockBrowserWebSocket => {
  const latest = MockBrowserWebSocket.instances[MockBrowserWebSocket.instances.length - 1];
  if (latest === undefined) {
    throw new Error('WebSocket instance not found.');
  }

  return latest;
};

const createMockWsClient = (): MockWsClient => ({
  readyState: 1,
  send: vi.fn((_body: string, callback?: (error?: Error) => void) => {
    callback?.(undefined);
  }),
});

beforeEach(() => {
  vi.useFakeTimers();
  MockBrowserWebSocket.reset();
  vi.stubGlobal('WebSocket', MockBrowserWebSocket as unknown as typeof WebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => createBaseGameState(),
    }) as unknown as typeof fetch
  );
  resetStores();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('WebSocket integration', () => {
  it('does not append a default auth token when none is configured', () => {
    const { unmount } = renderHook(() => useWebSocket('ws://localhost:3200/ws'));

    expect(getLatestSocket().url).toBe('ws://localhost:3200/ws');
    unmount();
  });

  it('transitions through connect, disconnect, and reconnect states', () => {
    const { result, unmount } = renderHook(() => useWebSocket('ws://localhost:3200/ws'));

    expect(MockBrowserWebSocket.instances).toHaveLength(1);

    const firstSocket = getLatestSocket();
    act(() => {
      firstSocket.triggerOpen();
    });
    expect(result.current.status).toBe('connected');

    act(() => {
      firstSocket.triggerClose();
    });
    expect(result.current.status).toBe('reconnecting');

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(MockBrowserWebSocket.instances).toHaveLength(2);
    const secondSocket = getLatestSocket();

    act(() => {
      secondSocket.triggerOpen();
    });

    expect(result.current.status).toBe('connected');
    unmount();
  });

  it('debounces and deduplicates report_update(done) game-state syncs', async () => {
    const { unmount } = renderHook(() => useWebSocket('ws://localhost:3200/ws'));
    const socket = getLatestSocket();

    act(() => {
      socket.triggerOpen();
    });

    useTaskStore.getState().setTask('ashigaru3', {
      taskId: 'task-1',
      taskTitle: 'phase2',
      assigneeId: 'ashigaru3',
      category: 'analysis',
      status: 'in_progress',
      updatedAt: '2026-02-08T23:49:00',
    });

    const doneReport = {
      type: 'report_update',
      payload: {
        reportId: 'report-1',
        taskId: 'task-1',
        workerId: 'ashigaru3',
        status: 'done',
        summary: 'phase2 complete',
        createdAt: '2026-02-08T23:50:00',
      },
    } as const;

    act(() => {
      socket.triggerMessage(doneReport);
      vi.advanceTimersByTime(299);
    });
    expect(getFetchMock()).toHaveBeenCalledTimes(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    await vi.waitFor(() => {
      expect(getFetchMock()).toHaveBeenCalledTimes(1);
    });

    act(() => {
      socket.triggerMessage(doneReport);
      vi.advanceTimersByTime(300);
    });

    expect(getFetchMock()).toHaveBeenCalledTimes(1);

    act(() => {
      socket.triggerMessage({
        ...doneReport,
        payload: {
          ...doneReport.payload,
          reportId: 'report-2',
        },
      });
      vi.advanceTimersByTime(300);
    });

    await vi.waitFor(() => {
      expect(getFetchMock()).toHaveBeenCalledTimes(2);
    });

    expect(useReportStore.getState().reports.ashigaru3?.reportId).toBe('report-2');
    expect(useTaskStore.getState().tasks.ashigaru3?.status).toBe('done');
    expect(useTaskStore.getState().tasks.ashigaru3?.updatedAt).toBe('2026-02-08T23:50:00');
    unmount();
  });

  it('parses wrapped /api/game-state responses during report done sync', async () => {
    const wrappedState = {
      ...createBaseGameState(),
      town: {
        level: 1,
        xp: 0,
        gold: 777,
      },
      economy: {
        gold: 777,
      },
    };
    getFetchMock().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          gameState: wrappedState,
        },
      }),
    });

    const { unmount } = renderHook(() => useWebSocket('ws://localhost:3200/ws'));
    const socket = getLatestSocket();

    act(() => {
      socket.triggerOpen();
    });

    useTaskStore.getState().setTask('ashigaru6', {
      taskId: 'task-wrapped',
      taskTitle: 'wrapped sync',
      assigneeId: 'ashigaru6',
      category: 'bug_fix',
      status: 'in_progress',
      updatedAt: '2026-02-09T06:10:00',
    });

    act(() => {
      socket.triggerMessage({
        type: 'report_update',
        payload: {
          reportId: 'report-wrapped',
          taskId: 'task-wrapped',
          workerId: 'ashigaru6',
          status: 'done',
          summary: 'wrapped sync complete',
          createdAt: '2026-02-09T06:11:00',
        },
      });
      vi.advanceTimersByTime(300);
    });

    await vi.waitFor(() => {
      expect(getFetchMock()).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(useGameStore.getState().gameState?.town.gold).toBe(777);
      expect(useGameStore.getState().gameState?.economy.gold).toBe(777);
    });
    unmount();
  });

  it('reconciles initial_state tasks with matching done reports', () => {
    const { unmount } = renderHook(() => useWebSocket('ws://localhost:3200/ws'));
    const socket = getLatestSocket();

    act(() => {
      socket.triggerOpen();
    });

    act(() => {
      socket.triggerMessage({
        type: 'initial_state',
        payload: {
          dashboard: '',
          gameState: createBaseGameState(),
          tasks: [
            {
              taskId: 'task-42',
              taskTitle: 'legacy-task',
              assigneeId: 'ashigaru5',
              category: 'analysis',
              status: 'assigned',
              updatedAt: '2026-02-08T23:40:00',
            },
          ],
          reports: [
            {
              reportId: 'report-42',
              taskId: 'task-42',
              workerId: 'ashigaru5',
              status: 'done',
              summary: 'done',
              createdAt: '2026-02-08T23:55:00',
            },
          ],
        },
      });
    });

    expect(useTaskStore.getState().tasks.ashigaru5?.status).toBe('done');
    expect(useTaskStore.getState().tasks.ashigaru5?.updatedAt).toBe('2026-02-08T23:55:00');
    unmount();
  });

  it('batches websocket broadcasts and delivers each queued message to all clients', () => {
    const clientA = createMockWsClient();
    const clientB = createMockWsClient();
    const wss = {
      clients: new Set([clientA, clientB]),
    } as unknown as WebSocketServer;

    broadcastWsMessage(wss, 'task_update', {
      taskId: 'task-1',
      taskTitle: 'Task',
      assigneeId: 'ashigaru3',
      category: 'test',
      status: 'in_progress',
      updatedAt: '2026-02-08T23:50:00',
    });
    broadcastWsMessage(wss, 'report_update', {
      reportId: 'report-1',
      taskId: 'task-1',
      workerId: 'ashigaru3',
      status: 'done',
      summary: 'done',
      createdAt: '2026-02-08T23:50:01',
    });

    expect(clientA.send).toHaveBeenCalledTimes(0);
    expect(clientB.send).toHaveBeenCalledTimes(0);

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(clientA.send).toHaveBeenCalledTimes(2);
    expect(clientB.send).toHaveBeenCalledTimes(2);

    const sentMessages = clientA.send.mock.calls.map(([serializedBody]) =>
      JSON.parse(serializedBody as string)
    );

    expect(sentMessages.map((entry) => entry.type)).toEqual(['task_update', 'report_update']);
  });
});
