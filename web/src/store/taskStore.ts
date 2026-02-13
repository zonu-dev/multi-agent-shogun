import { create } from 'zustand';
import type { TaskUpdatePayload } from '@/types';

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

type TaskRecord = Record<string, TaskUpdatePayload | null>;

const createEmptyTasks = (): TaskRecord =>
  WORKER_IDS.reduce<TaskRecord>((acc, workerId) => {
    acc[workerId] = null;
    return acc;
  }, {});

const normalizeTasks = (data: TaskRecord | TaskUpdatePayload[]): TaskRecord => {
  if (Array.isArray(data)) {
    const next = createEmptyTasks();
    data.forEach((task) => {
      next[task.assigneeId] = task;
    });
    return next;
  }

  return {
    ...createEmptyTasks(),
    ...data,
  };
};

export interface TaskStoreState {
  tasks: TaskRecord;
  setTask: (workerId: string, data: TaskUpdatePayload | null) => void;
  setAllTasks: (data: TaskRecord | TaskUpdatePayload[]) => void;
}

export const useTaskStore = create<TaskStoreState>((set) => ({
  tasks: createEmptyTasks(),
  setTask: (workerId, data) =>
    set((state) => ({
      tasks: {
        ...state.tasks,
        [workerId]: data,
      },
    })),
  setAllTasks: (data) =>
    set({
      tasks: normalizeTasks(data),
    }),
}));
