import { create } from 'zustand';
import type { ReportUpdatePayload } from '@/types';

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

type ReportRecord = Record<string, ReportUpdatePayload | null>;

const createEmptyReports = (): ReportRecord =>
  WORKER_IDS.reduce<ReportRecord>((acc, workerId) => {
    acc[workerId] = null;
    return acc;
  }, {});

const normalizeReports = (data: ReportRecord | ReportUpdatePayload[]): ReportRecord => {
  if (Array.isArray(data)) {
    const next = createEmptyReports();
    data.forEach((report) => {
      next[report.workerId] = report;
    });
    return next;
  }

  return {
    ...createEmptyReports(),
    ...data,
  };
};

export interface ReportStoreState {
  reports: ReportRecord;
  setReport: (workerId: string, data: ReportUpdatePayload | null) => void;
  setAllReports: (data: ReportRecord | ReportUpdatePayload[]) => void;
}

export const useReportStore = create<ReportStoreState>((set) => ({
  reports: createEmptyReports(),
  setReport: (workerId, data) =>
    set((state) => ({
      reports: {
        ...state.reports,
        [workerId]: data,
      },
    })),
  setAllReports: (data) =>
    set({
      reports: normalizeReports(data),
    }),
}));
