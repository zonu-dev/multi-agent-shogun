import { create } from 'zustand';
import type { ContextStat } from '@/types';

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

export interface ContextSnapshot {
  contextPercent: number | null;
  capturedAt: string;
  role: 'ashigaru' | 'shogun' | 'karo';
  label: string | null;
  pane: string | null;
  status: 'idle' | 'working' | 'unknown';
}

type ContextRecord = Record<string, ContextSnapshot>;

const createEmptyContextStats = (): ContextRecord =>
  WORKER_IDS.reduce<ContextRecord>((acc, workerId) => {
    acc[workerId] = {
      contextPercent: null,
      capturedAt: '',
      role: 'ashigaru',
      label: null,
      pane: null,
      status: 'unknown',
    };
    return acc;
  }, {});

const normalizePercent = (value: number | null): number | null => {
  if (value === null || Number.isNaN(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, value));
};

export interface ContextStoreState {
  contextStats: ContextRecord;
  setContextStats: (stats: ContextStat[]) => void;
}

export const useContextStore = create<ContextStoreState>((set) => ({
  contextStats: createEmptyContextStats(),
  setContextStats: (stats) =>
    set(() => {
      const nextStats = createEmptyContextStats();
      stats.forEach((stat) => {
        nextStats[stat.workerId] = {
          contextPercent: normalizePercent(stat.contextPercent),
          capturedAt: stat.capturedAt,
          role:
            stat.role ??
            (stat.workerId === 'shogun'
              ? 'shogun'
              : stat.workerId === 'karo'
                ? 'karo'
                : 'ashigaru'),
          label: stat.label ?? null,
          pane: stat.pane,
          status: stat.status ?? 'unknown',
        };
      });

      return {
        contextStats: nextStats,
      };
    }),
}));
