import * as React from 'react';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { shallow } from 'zustand/shallow';
import type { AshigaruState, CommandUpdatePayload, TaskUpdatePayload } from '@/types';
import { useCommandStore } from '@/store/commandStore';
import { useGameStore } from '@/store/gameStore';
import { useReportStore } from '@/store/reportStore';
import { useTaskStore } from '@/store/taskStore';
import ScrollContainer from '@/components/Common/ScrollContainer';
import AgentDetailModal from './AgentDetailModal';
import AshigaruCard from './AshigaruCard';
import type { TaskTitleLookupStatus } from './AshigaruCard';
import CommanderCard from './CommanderCard';

const StorageView = lazy(() => import('@/components/RightPanel/StorageView'));
const BuildingListView = lazy(() => import('@/components/LeftPanel/BuildingListView'));
const BukanView = React.lazy(() => import('./BukanView'));

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

type WorkerId = (typeof WORKER_IDS)[number];
type CommanderId = 'shogun' | 'karo';
type AgentRole = 'ashigaru' | CommanderId;
type LeftTab = 'army' | 'storage' | 'castle_town' | 'bukan';
type WorkerTaskRecord = Record<WorkerId, TaskUpdatePayload | null>;
type WorkerNameRecord = Record<WorkerId, string | null>;
type WorkerStatusRecord = Record<WorkerId, AshigaruState['status'] | null>;
type WorkerTaskIdRecord = Record<WorkerId, string | null>;

interface OpenDetailPayload {
  agentId: string;
  role: AgentRole;
  name: string;
}

const COMMANDER_DEFAULT_NAMES: Record<CommanderId, string> = {
  shogun: '将軍',
  karo: '家老',
};
const LEFT_TABS: readonly LeftTab[] = ['army', 'storage', 'castle_town', 'bukan'];
const LEFT_TAB_LABELS: Record<LeftTab, string> = {
  army: '軍勢',
  storage: '蔵',
  castle_town: '建造',
  bukan: '武鑑',
};
const TASK_TITLE_LOOKUP_DEBOUNCE_MS = 160;
type TaskTitleRecord = Record<string, string | null>;
type TaskTitleLookupStatusRecord = Record<string, TaskTitleLookupStatus>;

interface AgentHistoryResponse {
  currentTask?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const resolveTaskTitleFromDescription = (description: string | null): string | null => {
  if (!description) {
    return null;
  }

  return (
    description
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null
  );
};

const resolveTaskTitleFromHistoryResponse = (payload: unknown, taskId: string): string | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const response = payload as AgentHistoryResponse;
  if (!isRecord(response.currentTask)) {
    return null;
  }

  const currentTask = response.currentTask;
  const currentTaskId = typeof currentTask.taskId === 'string' ? currentTask.taskId : null;
  if (currentTaskId !== taskId) {
    return null;
  }

  const description = typeof currentTask.description === 'string' ? currentTask.description : null;
  return resolveTaskTitleFromDescription(description);
};

const createTaskTitleRecord = (): TaskTitleRecord =>
  WORKER_IDS.reduce<TaskTitleRecord>((acc, workerId) => {
    acc[workerId] = null;
    return acc;
  }, {});

const createTaskTitleLookupStatusRecord = (): TaskTitleLookupStatusRecord =>
  WORKER_IDS.reduce<TaskTitleLookupStatusRecord>((acc, workerId) => {
    acc[workerId] = 'idle';
    return acc;
  }, {});

const createWorkerTaskRecord = (): WorkerTaskRecord =>
  WORKER_IDS.reduce<WorkerTaskRecord>((acc, workerId) => {
    acc[workerId] = null;
    return acc;
  }, {} as WorkerTaskRecord);

const createWorkerNameRecord = (): WorkerNameRecord =>
  WORKER_IDS.reduce<WorkerNameRecord>((acc, workerId) => {
    acc[workerId] = null;
    return acc;
  }, {} as WorkerNameRecord);

const createWorkerStatusRecord = (): WorkerStatusRecord =>
  WORKER_IDS.reduce<WorkerStatusRecord>((acc, workerId) => {
    acc[workerId] = null;
    return acc;
  }, {} as WorkerStatusRecord);

const createWorkerTaskIdRecord = (): WorkerTaskIdRecord =>
  WORKER_IDS.reduce<WorkerTaskIdRecord>((acc, workerId) => {
    acc[workerId] = null;
    return acc;
  }, {} as WorkerTaskIdRecord);

const shouldLookupTaskTitle = (task: TaskUpdatePayload | null): boolean =>
  task?.status === 'assigned' || task?.status === 'in_progress';

const toTaskLookupSignature = (task: TaskUpdatePayload | null): string => {
  const taskId = task?.taskId?.trim() || '';
  const status = task?.status ?? '';
  const taskTitle = task?.taskTitle?.trim() || '';
  return [taskId, status, taskTitle].join('|');
};

const resolveCommanderId = (issuedBy: string): CommanderId | null => {
  const normalized = issuedBy.toLowerCase();
  if (normalized.includes('shogun') || issuedBy.includes('将軍')) {
    return 'shogun';
  }

  if (normalized.includes('karo') || issuedBy.includes('家老')) {
    return 'karo';
  }

  return null;
};

const resolveCommandMessage = (command: CommandUpdatePayload): string => {
  const commandSource = command as Record<string, unknown>;
  return (
    typeof command.message === 'string'
      ? command.message
      : typeof commandSource.command === 'string'
        ? commandSource.command
        : ''
  ).trim();
};

const getLatestCommanderSpeechFromCommands = (
  commands: CommandUpdatePayload[],
  commanderId: CommanderId
): string | null => {
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    const command = commands[index];
    const issuedBy = typeof command.issuedBy === 'string' ? command.issuedBy : '';
    const resolvedCommanderId =
      resolveCommanderId(issuedBy) ?? (typeof command.command === 'string' ? 'shogun' : null);
    if (resolvedCommanderId !== commanderId) {
      continue;
    }

    const message = resolveCommandMessage(command);
    if (message.length > 0) {
      return message;
    }
  }

  return null;
};

const getWrappedLeftTab = (startIndex: number): LeftTab => {
  const tabCount = LEFT_TABS.length;
  const wrappedIndex = ((startIndex % tabCount) + tabCount) % tabCount;
  return LEFT_TABS[wrappedIndex];
};

const LeftPanel = () => {
  const shogunReportSummary = useReportStore(
    (state) => state.reports.shogun?.summary?.trim() || null
  );
  const karoReportSummary = useReportStore((state) => state.reports.karo?.summary?.trim() || null);
  const shogunCommandSpeech = useCommandStore((state) =>
    getLatestCommanderSpeechFromCommands(state.commands, 'shogun')
  );
  const karoCommandSpeech = useCommandStore((state) =>
    getLatestCommanderSpeechFromCommands(state.commands, 'karo')
  );
  const ashigaruMembers = useGameStore((state) => state.gameState?.ashigaru ?? []);
  const workerTasks = useTaskStore(
    (state) =>
      WORKER_IDS.reduce<WorkerTaskRecord>((acc, workerId) => {
        acc[workerId] = state.tasks[workerId] ?? null;
        return acc;
      }, createWorkerTaskRecord()),
    shallow
  );
  const [activeTab, setActiveTab] = useState<LeftTab>('army');
  const [mountedTabs, setMountedTabs] = useState<Set<LeftTab>>(
    () => new Set<LeftTab>(['army', 'castle_town'])
  );
  const [activeAgent, setActiveAgent] = useState<OpenDetailPayload | null>(null);
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
  const [resolvedTaskTitles, setResolvedTaskTitles] = useState<TaskTitleRecord>(() =>
    createTaskTitleRecord()
  );
  const [taskTitleLookupStatuses, setTaskTitleLookupStatuses] =
    useState<TaskTitleLookupStatusRecord>(() => createTaskTitleLookupStatusRecord());
  const taskTitleCacheRef = useRef<Map<string, string>>(new Map());
  const previousWorkerTasksRef = useRef<WorkerTaskRecord | null>(null);
  const taskLookupSignatureRef = useRef<Record<WorkerId, string>>(
    WORKER_IDS.reduce<Record<WorkerId, string>>((acc, workerId) => {
      acc[workerId] = '';
      return acc;
    }, {} as Record<WorkerId, string>)
  );
  const taskLookupTimerRef = useRef<Partial<Record<WorkerId, ReturnType<typeof setTimeout>>>>({});
  const taskLookupAbortControllerRef = useRef<Partial<Record<WorkerId, AbortController>>>({});

  const handleOpenDetail = useCallback((payload: OpenDetailPayload) => {
    setActiveAgent(payload);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setActiveAgent(null);
  }, []);

  const handleNameUpdated = useCallback((agentId: string, name: string) => {
    setNameOverrides((prev) => {
      if (prev[agentId] === name) {
        return prev;
      }

      return {
        ...prev,
        [agentId]: name,
      };
    });
  }, []);

  const commanderNames = useMemo<Record<CommanderId, string>>(
    () => ({
      shogun: nameOverrides.shogun?.trim() || COMMANDER_DEFAULT_NAMES.shogun,
      karo: nameOverrides.karo?.trim() || COMMANDER_DEFAULT_NAMES.karo,
    }),
    [nameOverrides.karo, nameOverrides.shogun]
  );

  const commanderSpeeches = useMemo<Record<CommanderId, string | null>>(() => {
    return {
      shogun: shogunReportSummary ?? shogunCommandSpeech,
      karo: karoReportSummary ?? karoCommandSpeech,
    };
  }, [karoCommandSpeech, karoReportSummary, shogunCommandSpeech, shogunReportSummary]);

  const workerProfiles = useMemo(() => {
    const names = createWorkerNameRecord();
    const statuses = createWorkerStatusRecord();
    const taskIds = createWorkerTaskIdRecord();
    const memberById = new Map<string, AshigaruState>(ashigaruMembers.map((member) => [member.id, member]));

    WORKER_IDS.forEach((workerId) => {
      const member = memberById.get(workerId);
      names[workerId] = member?.name ?? null;
      statuses[workerId] = member?.status ?? null;
      taskIds[workerId] = member?.taskId ?? null;
    });

    return {
      names,
      statuses,
      taskIds,
    };
  }, [ashigaruMembers]);

  const focusTab = useCallback((tab: LeftTab) => {
    setActiveTab(tab);
    window.requestAnimationFrame(() => {
      document.getElementById(`left-tab-${tab}`)?.focus();
    });
  }, []);

  const handleTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, currentTab: LeftTab) => {
      const currentIndex = LEFT_TABS.indexOf(currentTab);
      if (currentIndex < 0) {
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        focusTab(getWrappedLeftTab(currentIndex + 1));
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        focusTab(getWrappedLeftTab(currentIndex - 1));
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        focusTab(LEFT_TABS[0]);
        return;
      }

      if (event.key === 'End') {
        event.preventDefault();
        focusTab(LEFT_TABS[LEFT_TABS.length - 1]);
      }
    },
    [focusTab]
  );

  useEffect(() => {
    setMountedTabs((current) => {
      if (current.has(activeTab)) {
        return current;
      }

      const next = new Set(current);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  useEffect(() => {
    const clearLookupJob = (workerId: WorkerId): void => {
      const activeTimer = taskLookupTimerRef.current[workerId];
      if (activeTimer !== undefined) {
        clearTimeout(activeTimer);
        delete taskLookupTimerRef.current[workerId];
      }

      const activeAbortController = taskLookupAbortControllerRef.current[workerId];
      if (activeAbortController) {
        activeAbortController.abort();
        delete taskLookupAbortControllerRef.current[workerId];
      }
    };

    const isTaskLookupTargetActive = (workerId: WorkerId, taskId: string): boolean => {
      const liveTask = useTaskStore.getState().tasks[workerId] ?? null;
      const liveTaskId = liveTask?.taskId?.trim() || null;
      return liveTaskId === taskId && shouldLookupTaskTitle(liveTask);
    };

    const previousWorkerTasks = previousWorkerTasksRef.current;
    const changedWorkerIds = WORKER_IDS.filter((workerId) => {
      if (previousWorkerTasks === null) {
        return true;
      }

      return !Object.is(previousWorkerTasks[workerId], workerTasks[workerId]);
    });
    previousWorkerTasksRef.current = workerTasks;

    if (changedWorkerIds.length === 0) {
      return;
    }

    changedWorkerIds.forEach((workerId) => {
      const task = workerTasks[workerId];
      const lookupSignature = toTaskLookupSignature(task);
      if (taskLookupSignatureRef.current[workerId] === lookupSignature) {
        return;
      }
      taskLookupSignatureRef.current[workerId] = lookupSignature;

      clearLookupJob(workerId);

      const directTaskTitle = task?.taskTitle?.trim() || null;
      const taskId = task?.taskId?.trim() || null;
      if (directTaskTitle) {
        setResolvedTaskTitles((prev) =>
          prev[workerId] === directTaskTitle
            ? prev
            : {
                ...prev,
                [workerId]: directTaskTitle,
              }
        );
        setTaskTitleLookupStatuses((prev) =>
          prev[workerId] === 'ready'
            ? prev
            : {
                ...prev,
                [workerId]: 'ready',
              }
        );
        if (taskId) {
          taskTitleCacheRef.current.set(taskId, directTaskTitle);
        }
        return;
      }

      if (!taskId || !shouldLookupTaskTitle(task)) {
        setResolvedTaskTitles((prev) =>
          prev[workerId] === null
            ? prev
            : {
                ...prev,
                [workerId]: null,
              }
        );
        setTaskTitleLookupStatuses((prev) =>
          prev[workerId] === 'idle'
            ? prev
            : {
                ...prev,
                [workerId]: 'idle',
              }
        );
        return;
      }

      const cachedTaskTitle = taskTitleCacheRef.current.get(taskId);
      if (cachedTaskTitle) {
        setResolvedTaskTitles((prev) =>
          prev[workerId] === cachedTaskTitle
            ? prev
            : {
                ...prev,
                [workerId]: cachedTaskTitle,
              }
        );
        setTaskTitleLookupStatuses((prev) =>
          prev[workerId] === 'ready'
            ? prev
            : {
                ...prev,
                [workerId]: 'ready',
              }
        );
        return;
      }

      setResolvedTaskTitles((prev) =>
        prev[workerId] === null
          ? prev
          : {
              ...prev,
              [workerId]: null,
            }
      );
      setTaskTitleLookupStatuses((prev) =>
        prev[workerId] === 'loading'
          ? prev
          : {
              ...prev,
              [workerId]: 'loading',
            }
      );

      taskLookupTimerRef.current[workerId] = setTimeout(() => {
        delete taskLookupTimerRef.current[workerId];
        const abortController = new AbortController();
        taskLookupAbortControllerRef.current[workerId] = abortController;

        void (async () => {
          try {
            const response = await fetch(`/api/agent-history/${workerId}`, {
              signal: abortController.signal,
            });
            if (!response.ok) {
              throw new Error(`agent-history request failed: ${response.status}`);
            }

            const payload = (await response.json()) as unknown;
            const historyTaskTitle = resolveTaskTitleFromHistoryResponse(payload, taskId);
            if (!historyTaskTitle) {
              throw new Error('current task description is not available');
            }

            if (!isTaskLookupTargetActive(workerId, taskId)) {
              return;
            }

            taskTitleCacheRef.current.set(taskId, historyTaskTitle);
            setResolvedTaskTitles((prev) =>
              prev[workerId] === historyTaskTitle
                ? prev
                : {
                    ...prev,
                    [workerId]: historyTaskTitle,
                  }
            );
            setTaskTitleLookupStatuses((prev) =>
              prev[workerId] === 'ready'
                ? prev
                : {
                    ...prev,
                    [workerId]: 'ready',
                  }
            );
          } catch (error: unknown) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              return;
            }

            if (!isTaskLookupTargetActive(workerId, taskId)) {
              return;
            }

            console.warn(`[LeftPanel] failed to resolve task title for ${workerId}`, error);
            setResolvedTaskTitles((prev) =>
              prev[workerId] === null
                ? prev
                : {
                    ...prev,
                    [workerId]: null,
                  }
            );
            setTaskTitleLookupStatuses((prev) =>
              prev[workerId] === 'failed'
                ? prev
                : {
                    ...prev,
                    [workerId]: 'failed',
                  }
            );
          } finally {
            if (taskLookupAbortControllerRef.current[workerId] === abortController) {
              delete taskLookupAbortControllerRef.current[workerId];
            }
          }
        })();
      }, TASK_TITLE_LOOKUP_DEBOUNCE_MS);
    });
  }, [workerTasks]);

  useEffect(() => {
    return () => {
      WORKER_IDS.forEach((workerId) => {
        const activeTimer = taskLookupTimerRef.current[workerId];
        if (activeTimer !== undefined) {
          clearTimeout(activeTimer);
        }
        taskLookupAbortControllerRef.current[workerId]?.abort();
      });
      taskLookupTimerRef.current = {};
      taskLookupAbortControllerRef.current = {};
      previousWorkerTasksRef.current = null;
    };
  }, []);

  return (
    <>
      <ScrollContainer
        className="flex h-full flex-col overflow-y-auto"
        contentClassName="flex min-h-0 flex-1 flex-col gap-3"
      >
        <nav
          role="tablist"
          aria-label="左パネル"
          className="flex w-full min-w-0 shrink-0 flex-nowrap items-center gap-2 overflow-x-auto rounded-lg border border-[color:var(--kincha)]/25 bg-black/20 p-1"
        >
          {LEFT_TABS.map((tab) => {
            const active = tab === activeTab;
            return (
              <button
                key={tab}
                type="button"
                id={`left-tab-${tab}`}
                role="tab"
                aria-selected={active}
                aria-controls={`left-panel-${tab}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setActiveTab(tab)}
                onKeyDown={(event) => handleTabKeyDown(event, tab)}
                className={[
                  'flex-none min-w-max whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold leading-none transition',
                  active
                    ? 'bg-[color:var(--kincha)]/80 text-[#3d2200]'
                    : 'text-slate-200 hover:bg-white/10',
                ].join(' ')}
              >
                {LEFT_TAB_LABELS[tab]}
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 min-w-0 flex-1">
          {LEFT_TABS.map((tab) => {
            const active = tab === activeTab;
            const shouldRender = mountedTabs.has(tab);

            return (
              <section
                key={`left-panel-${tab}`}
                id={`left-panel-${tab}`}
                role="tabpanel"
                aria-labelledby={`left-tab-${tab}`}
                hidden={!active}
                className="min-h-full min-w-0 overflow-x-hidden pb-2"
              >
                {shouldRender ? (
                  tab === 'army' ? (
                    <div className="space-y-3">
                      <section className="space-y-2 pb-1">
                        <CommanderCard
                          commanderId="shogun"
                          name={commanderNames.shogun}
                          latestSpeech={commanderSpeeches.shogun}
                          onOpenDetail={handleOpenDetail}
                        />
                        <CommanderCard
                          commanderId="karo"
                          name={commanderNames.karo}
                          latestSpeech={commanderSpeeches.karo}
                          onOpenDetail={handleOpenDetail}
                        />
                      </section>

                      <section className="space-y-2 pb-1">
                        {WORKER_IDS.map((workerId) => (
                          <AshigaruCard
                            key={workerId}
                            workerId={workerId}
                            memberName={workerProfiles.names[workerId]}
                            memberStatus={workerProfiles.statuses[workerId]}
                            memberTaskId={workerProfiles.taskIds[workerId]}
                            resolvedTaskTitle={resolvedTaskTitles[workerId]}
                            taskTitleLookupStatus={taskTitleLookupStatuses[workerId]}
                            onOpenDetail={handleOpenDetail}
                          />
                        ))}
                      </section>
                    </div>
                  ) : tab === 'storage' ? (
                    <Suspense
                      fallback={
                        <div className="px-2 py-3 text-xs text-slate-300">読み込み中...</div>
                      }
                    >
                      <StorageView />
                    </Suspense>
                  ) : tab === 'castle_town' ? (
                    <Suspense
                      fallback={
                        <div className="px-2 py-3 text-xs text-slate-300">読み込み中...</div>
                      }
                    >
                      <BuildingListView />
                    </Suspense>
                  ) : (
                    <Suspense
                      fallback={
                        <div className="px-2 py-3 text-xs text-slate-300">読み込み中...</div>
                      }
                    >
                      <BukanView />
                    </Suspense>
                  )
                ) : null}
              </section>
            );
          })}
        </div>
      </ScrollContainer>

      {activeAgent ? (
        <AgentDetailModal
          agentId={activeAgent.agentId}
          role={activeAgent.role}
          initialName={nameOverrides[activeAgent.agentId] ?? activeAgent.name}
          onClose={handleCloseDetail}
          onNameUpdated={handleNameUpdated}
        />
      ) : null}
    </>
  );
};

export default LeftPanel;
