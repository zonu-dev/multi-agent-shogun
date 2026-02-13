import { create } from 'zustand';
import {
  parseAlertIssueItems,
  parseDashboardLines,
} from '@/components/RightPanel/dashboard/parsers';
import type { AlertIssueItem, ParsedLine } from '@/components/RightPanel/dashboard/parsers';

interface NormalizedDashboardContent {
  parsedLines: ParsedLine[];
  alertIssueItems: AlertIssueItem[];
  alertItems: string[];
  visibleAlertItems: string[];
  visibleAlertCount: number;
  hasAlerts: boolean;
}

const normalizeDashboardContent = (content: string): NormalizedDashboardContent => {
  const parsedLines = parseDashboardLines(content);
  const alertIssueItems = parseAlertIssueItems(parsedLines);
  const visibleAlertItems = alertIssueItems.map((issue) => issue.heading);

  return {
    parsedLines,
    alertIssueItems,
    alertItems: visibleAlertItems,
    visibleAlertItems,
    visibleAlertCount: visibleAlertItems.length,
    hasAlerts: visibleAlertItems.length > 0,
  };
};

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

export const useDashboardStore = create<DashboardStoreState>((set) => ({
  content: '',
  parsedLines: [],
  alertIssueItems: [],
  hasAlerts: false,
  alertItems: [],
  visibleAlertItems: [],
  visibleAlertCount: 0,
  setDashboard: (content) => {
    const normalized = normalizeDashboardContent(content);
    set({
      content,
      ...normalized,
    });
  },
}));
