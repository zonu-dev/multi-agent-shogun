import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AshigaruState,
  CommandUpdatePayload,
  GameState,
  ReportUpdatePayload,
  TaskUpdatePayload,
} from '@/types';
import { useCommandStore } from '@/store/commandStore';
import { useContextStore } from '@/store/contextStore';
import { useGameStore } from '@/store/gameStore';
import { useReportStore } from '@/store/reportStore';
import { useTaskStore } from '@/store/taskStore';

type AgentRole = 'ashigaru' | 'shogun' | 'karo';
type CardStatus = 'idle' | 'working' | 'failed' | 'unknown';

interface AgentHistoryEntry {
  id: string;
  timestamp: string;
  status: string;
  message: string;
  taskId: string | null;
  parentCmd: string | null;
  source: 'report' | 'command' | 'note';
}

interface AgentCurrentTask {
  taskId: string | null;
  status: string | null;
  category: string | null;
  description: string | null;
  timestamp: string | null;
}

interface AgentHistoryResponse {
  success?: boolean;
  error?: string;
  displayName?: string;
  entries?: unknown;
  currentTask?: unknown;
}

interface RenameResponse {
  success?: boolean;
  error?: string;
  name?: string;
  gameState?: unknown;
}

interface AgentDetailModalProps {
  agentId: string;
  role: AgentRole;
  initialName: string;
  onClose: () => void;
  onNameUpdated?: (agentId: string, name: string) => void;
}

const STATUS_META: Record<CardStatus, { label: string; badgeClass: string }> = {
  idle: {
    label: '待機',
    badgeClass: 'border-slate-300/35 bg-slate-500/25 text-slate-100',
  },
  working: {
    label: '作業中',
    badgeClass: 'border-sky-300/35 bg-sky-500/25 text-sky-100',
  },
  failed: {
    label: '障害',
    badgeClass: 'border-rose-300/35 bg-rose-500/25 text-rose-100',
  },
  unknown: {
    label: '不明',
    badgeClass: 'border-slate-400/35 bg-slate-600/25 text-slate-200',
  },
};

const TASK_STATUS_LABELS: Record<string, string> = {
  assigned: '拝命',
  in_progress: '作業中',
  done: '完了',
  failed: '障害',
  blocked: '差し止め',
  idle: '待機',
  working: '作業中',
  unknown: '不明',
};

const COMMANDER_PORTRAIT_META: Record<
  Exclude<AgentRole, 'ashigaru'>,
  { label: string; portraitClass: string }
> = {
  shogun: {
    label: '将',
    portraitClass:
      'border-amber-200/80 bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950',
  },
  karo: {
    label: '家',
    portraitClass:
      'border-slate-200/80 bg-gradient-to-b from-slate-200 to-slate-400 text-slate-900',
  },
};

const ASHIGARU_PORTRAIT_CLASS =
  'border-[color:var(--kincha)]/45 bg-[color:var(--kincha)]/25 text-[color:var(--kincha)]';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isGameStatePayload = (value: unknown): value is GameState =>
  isRecord(value) &&
  Array.isArray(value.ashigaru) &&
  Array.isArray(value.buildings) &&
  isRecord(value.town) &&
  Array.isArray(value.inventory) &&
  Array.isArray(value.decorations) &&
  Array.isArray(value.missions) &&
  Array.isArray(value.activityLog);

const normalizeStatus = (
  task: TaskUpdatePayload | null,
  report: ReportUpdatePayload | null,
  member: AshigaruState | undefined
): CardStatus => {
  if (
    report?.status === 'failed' ||
    task?.status === 'failed' ||
    task?.status === 'blocked' ||
    member?.status === 'blocked' ||
    member?.status === 'offline'
  ) {
    return 'failed';
  }

  if (
    member?.status === 'working' ||
    task?.status === 'in_progress' ||
    task?.status === 'assigned'
  ) {
    return 'working';
  }

  return 'idle';
};

const normalizeContextUsedPercent = (leftPercent: number | null): number | null => {
  if (leftPercent === null || Number.isNaN(leftPercent)) {
    return null;
  }

  const safeLeft = Math.max(0, Math.min(100, Math.round(leftPercent)));
  return Math.max(0, Math.min(100, 100 - safeLeft));
};

const getAshigaruPortraitLabel = (agentId: string, fallbackName: string): string => {
  const suffix = agentId.match(/(\d+)$/)?.[1];
  if (suffix) {
    return suffix;
  }

  const tailChar = fallbackName.trim().slice(-1);
  return tailChar || '兵';
};

const resolvePortraitMeta = (
  role: AgentRole,
  agentId: string,
  displayName: string
): { label: string; portraitClass: string } => {
  if (role === 'ashigaru') {
    return {
      label: getAshigaruPortraitLabel(agentId, displayName),
      portraitClass: ASHIGARU_PORTRAIT_CLASS,
    };
  }

  return COMMANDER_PORTRAIT_META[role];
};

const formatTimestamp = (value: string): string => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString('ja-JP');
};

const formatTaskStatusLabel = (status: string | null | undefined): string | null => {
  if (!status) {
    return null;
  }

  return TASK_STATUS_LABELS[status] ?? status;
};

const sortHistoryEntries = (entries: AgentHistoryEntry[]): AgentHistoryEntry[] => {
  return [...entries].sort((left, right) => {
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.id.localeCompare(right.id);
  });
};

const normalizeHistoryEntries = (payload: unknown): AgentHistoryEntry[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return sortHistoryEntries(
    payload.filter((entry): entry is AgentHistoryEntry => {
      return (
        isRecord(entry) &&
        typeof entry.id === 'string' &&
        typeof entry.timestamp === 'string' &&
        typeof entry.status === 'string' &&
        typeof entry.message === 'string' &&
        (typeof entry.taskId === 'string' || entry.taskId === null) &&
        (typeof entry.parentCmd === 'string' || entry.parentCmd === null) &&
        (entry.source === 'report' || entry.source === 'command' || entry.source === 'note')
      );
    })
  );
};

const normalizeCurrentTask = (payload: unknown): AgentCurrentTask | null => {
  if (!isRecord(payload)) {
    return null;
  }

  return {
    taskId: typeof payload.taskId === 'string' ? payload.taskId : null,
    status: typeof payload.status === 'string' ? payload.status : null,
    category: typeof payload.category === 'string' ? payload.category : null,
    description: typeof payload.description === 'string' ? payload.description : null,
    timestamp: typeof payload.timestamp === 'string' ? payload.timestamp : null,
  };
};

const resolveCommanderFromIssuedBy = (issuedBy: string): Exclude<AgentRole, 'ashigaru'> | null => {
  const normalized = issuedBy.toLowerCase();
  if (normalized.includes('shogun') || issuedBy.includes('将軍')) {
    return 'shogun';
  }

  if (normalized.includes('karo') || issuedBy.includes('家老')) {
    return 'karo';
  }

  return null;
};

const normalizeCommanderCommandEntries = (
  role: Exclude<AgentRole, 'ashigaru'>,
  commands: CommandUpdatePayload[]
): AgentHistoryEntry[] => {
  const entries: AgentHistoryEntry[] = [];

  commands.forEach((command, index) => {
    const source = command as unknown as Record<string, unknown>;
    const issuedBy = typeof command.issuedBy === 'string' ? command.issuedBy : '';
    const issuedCommander = resolveCommanderFromIssuedBy(issuedBy);
    const inferredCommander =
      issuedCommander ?? (typeof source.command === 'string' ? 'shogun' : null);
    if (inferredCommander !== role) {
      return;
    }

    const rawMessage =
      typeof command.message === 'string'
        ? command.message
        : typeof source.command === 'string'
          ? source.command
          : '';
    const message = rawMessage.trim();
    if (message.length < 1) {
      return;
    }

    const commandId =
      typeof command.commandId === 'string'
        ? command.commandId
        : typeof source.id === 'string'
          ? source.id
          : `${role}-${index + 1}`;
    const timestamp =
      typeof command.createdAt === 'string'
        ? command.createdAt
        : typeof source.timestamp === 'string'
          ? source.timestamp
          : new Date(0).toISOString();
    const status = typeof source.status === 'string' ? source.status : 'in_progress';

    entries.push({
      id: `${role}-${commandId}`,
      timestamp,
      status,
      message,
      taskId: null,
      parentCmd: commandId,
      source: 'command',
    });
  });

  return sortHistoryEntries(entries);
};

const INLINE_MARKDOWN_PATTERN = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
const ORDERED_LIST_PATTERN = /^\s*\d+[.)]\s+(.+)$/;
const UNORDERED_LIST_PATTERN = /^\s*(?:[-*]|・)\s+(.+)$/;
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const renderInlineMarkdown = (value: string, keyPrefix: string): (string | JSX.Element)[] => {
  const nodes: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const token of value.matchAll(INLINE_MARKDOWN_PATTERN)) {
    const match = token[0];
    const start = token.index ?? 0;
    if (start > lastIndex) {
      nodes.push(value.slice(lastIndex, start));
    }

    if (match.startsWith('**') && match.endsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-bold-${tokenIndex}`} className="font-semibold text-slate-50">
          {match.slice(2, -2)}
        </strong>
      );
    } else {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${tokenIndex}`}
          className="rounded bg-black/40 px-1 py-0.5 font-mono text-[10px] text-amber-100"
        >
          {match.slice(1, -1)}
        </code>
      );
    }

    lastIndex = start + match.length;
    tokenIndex += 1;
  }

  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [value];
};

const renderHistoryMessage = (message: string): JSX.Element => {
  const normalized = message.replace(/\r\n/g, '\n').trimEnd();
  if (normalized.length < 1) {
    return <p className="text-[11px] text-slate-300">（空文）</p>;
  }

  const lines = normalized.split('\n');
  const blocks: JSX.Element[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.length < 1) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && lines[index].trim().startsWith('```')) {
        index += 1;
      }

      blocks.push(
        <pre
          key={`code-${blocks.length + 1}`}
          className="overflow-x-auto rounded-md border border-slate-500/35 bg-black/45 p-2 text-[10px] leading-relaxed text-slate-100"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    const orderedMatch = line.match(ORDERED_LIST_PATTERN);
    const unorderedMatch = line.match(UNORDERED_LIST_PATTERN);
    if (orderedMatch || unorderedMatch) {
      const isOrdered = orderedMatch !== null;
      const items: string[] = [];

      while (index < lines.length) {
        const currentLine = lines[index];
        const currentOrdered = currentLine.match(ORDERED_LIST_PATTERN);
        const currentUnordered = currentLine.match(UNORDERED_LIST_PATTERN);
        if (isOrdered) {
          if (currentOrdered === null) {
            break;
          }
          items.push(currentOrdered[1]);
        } else {
          if (currentUnordered === null) {
            break;
          }
          items.push(currentUnordered[1]);
        }
        index += 1;
      }

      const ListTag = isOrdered ? 'ol' : 'ul';
      blocks.push(
        <ListTag
          key={`list-${blocks.length + 1}`}
          className={isOrdered ? 'ml-4 list-decimal space-y-1' : 'ml-4 list-disc space-y-1'}
        >
          {items.map((item, itemIndex) => (
            <li key={`list-item-${blocks.length + 1}-${itemIndex + 1}`}>
              {renderInlineMarkdown(item, `list-inline-${blocks.length + 1}-${itemIndex + 1}`)}
            </li>
          ))}
        </ListTag>
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      const currentTrimmed = current.trim();
      if (
        currentTrimmed.length < 1 ||
        currentTrimmed.startsWith('```') ||
        ORDERED_LIST_PATTERN.test(current) ||
        UNORDERED_LIST_PATTERN.test(current)
      ) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }

    blocks.push(
      <p key={`paragraph-${blocks.length + 1}`} className="space-y-1 text-[11px] leading-relaxed">
        {paragraphLines.map((paragraphLine, paragraphIndex) => (
          <span key={`paragraph-line-${blocks.length + 1}-${paragraphIndex + 1}`} className="block">
            {renderInlineMarkdown(
              paragraphLine,
              `paragraph-inline-${blocks.length + 1}-${paragraphIndex + 1}`
            )}
          </span>
        ))}
      </p>
    );
  }

  return <div className="space-y-1.5">{blocks}</div>;
};

const AgentDetailModal = ({
  agentId,
  role,
  initialName,
  onClose,
  onNameUpdated,
}: AgentDetailModalProps) => {
  const member = useGameStore((state) =>
    state.gameState?.ashigaru.find((item) => item.id === agentId)
  );
  const commands = useCommandStore((state) => state.commands);
  const updateGameState = useGameStore((state) => state.updateGameState);
  const task = useTaskStore((state) => state.tasks[agentId] ?? null);
  const report = useReportStore((state) => state.reports[agentId] ?? null);
  const contextStat = useContextStore((state) => state.contextStats[agentId] ?? null);

  const [displayName, setDisplayName] = useState(initialName);
  const [draftName, setDraftName] = useState(initialName);
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [entries, setEntries] = useState<AgentHistoryEntry[]>([]);
  const [currentTask, setCurrentTask] = useState<AgentCurrentTask | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const historyContainerRef = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogTitleRef = useRef<HTMLHeadingElement | null>(null);
  const dialogTitleId = useMemo(
    () => `agent-detail-modal-title-${agentId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    [agentId]
  );

  useEffect(() => {
    setDisplayName(initialName);
    setDraftName(initialName);
    setIsEditingName(false);
    setNotice(null);
  }, [agentId, initialName]);

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;
    setEntries([]);
    setCurrentTask(null);
    setNotice(null);

    const loadHistory = async () => {
      setIsLoadingHistory(true);
      try {
        const response = await fetch(`/api/agent-history/${encodeURIComponent(agentId)}`, {
          method: 'GET',
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as AgentHistoryResponse | null;
        if (!isActive || payload === null) {
          return;
        }

        if (!response.ok || payload.success === false) {
          setNotice(payload.error ?? '履歴取得に失敗いたした。');
          return;
        }

        if (typeof payload.displayName === 'string' && payload.displayName.trim().length > 0) {
          setDisplayName(payload.displayName);
          setDraftName(payload.displayName);
          onNameUpdated?.(agentId, payload.displayName);
        }
        setEntries(normalizeHistoryEntries(payload.entries));
        setCurrentTask(normalizeCurrentTask(payload.currentTask));
      } catch {
        if (isActive) {
          setNotice('履歴取得に失敗いたした。');
        }
      } finally {
        if (isActive) {
          setIsLoadingHistory(false);
        }
      }
    };

    void loadHistory();
    return () => {
      isActive = false;
      controller.abort();
    };
  }, [agentId, onNameUpdated]);

  const getFocusableElements = useCallback((): HTMLElement[] => {
    const modalElement = modalRef.current;
    if (!modalElement) {
      return [];
    }

    return Array.from(modalElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) => {
        if (element.getAttribute('aria-hidden') === 'true') {
          return false;
        }
        if (element.hasAttribute('disabled')) {
          return false;
        }
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }
    );
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (closeButtonRef.current) {
        closeButtonRef.current.focus();
        return;
      }

      dialogTitleRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [agentId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements();
      if (focusableElements.length < 1) {
        event.preventDefault();
        closeButtonRef.current?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (!modalRef.current?.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
        return;
      }

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [getFocusableElements, onClose]);

  const status = useMemo<CardStatus>(() => {
    if (role === 'ashigaru') {
      return normalizeStatus(task, report, member);
    }

    if (contextStat?.status === 'idle' || contextStat?.status === 'working') {
      return contextStat.status;
    }

    return 'unknown';
  }, [contextStat?.status, member, report, role, task]);

  const contextUsedPercent = useMemo(
    () => normalizeContextUsedPercent(contextStat?.contextPercent ?? null),
    [contextStat?.contextPercent]
  );
  const fallbackCommanderEntries = useMemo(() => {
    if (role === 'ashigaru') {
      return [];
    }

    return normalizeCommanderCommandEntries(role, commands);
  }, [commands, role]);
  const displayEntries = useMemo(() => {
    if (entries.length > 0) {
      return entries;
    }
    return fallbackCommanderEntries;
  }, [entries, fallbackCommanderEntries]);
  const portraitMeta = useMemo(
    () => resolvePortraitMeta(role, agentId, displayName),
    [agentId, displayName, role]
  );

  const fallbackTaskLabel = useMemo(() => {
    if (task?.taskId) {
      const taskStatusLabel = formatTaskStatusLabel(task.status);
      return taskStatusLabel ? `${task.taskId} (${taskStatusLabel})` : task.taskId;
    }

    return '任務なし';
  }, [task?.status, task?.taskId]);

  const taskLabel = useMemo(() => {
    if (currentTask?.taskId) {
      const taskStatusLabel = formatTaskStatusLabel(currentTask.status);
      return `${currentTask.taskId}${taskStatusLabel ? ` (${taskStatusLabel})` : ''}`;
    }

    if (role === 'ashigaru') {
      return fallbackTaskLabel;
    }

    return '任務情報なし';
  }, [currentTask?.status, currentTask?.taskId, fallbackTaskLabel, role]);

  const saveName = useCallback(async () => {
    const nextName = draftName.trim();
    if (nextName.length < 1 || nextName.length > 40) {
      setNotice('名前は1〜40文字で入力されよ。');
      return;
    }

    if (nextName === displayName) {
      setIsEditingName(false);
      return;
    }

    setIsSavingName(true);
    setNotice(null);
    try {
      const response = await fetch('/api/rename-agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId,
          name: nextName,
        }),
      });
      const payload = (await response.json().catch(() => null)) as RenameResponse | null;
      if (!response.ok || payload?.success === false) {
        setNotice(payload?.error ?? '改名保存に失敗いたした。');
        return;
      }

      setDisplayName(nextName);
      setDraftName(nextName);
      setIsEditingName(false);
      onNameUpdated?.(agentId, nextName);

      if (isGameStatePayload(payload?.gameState)) {
        updateGameState(payload.gameState);
      }
    } catch {
      setNotice('改名保存に失敗いたした。');
    } finally {
      setIsSavingName(false);
    }
  }, [agentId, displayName, draftName, onNameUpdated, updateGameState]);

  useEffect(() => {
    const container = historyContainerRef.current;
    if (!container) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [agentId, displayEntries, isLoadingHistory]);

  const statusMeta = STATUS_META[status];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[1px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <article
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        className="flex max-h-[min(90vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[color:var(--kincha)]/45 bg-[#0f1427] shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[color:var(--kincha)]/25 px-5 py-4">
          <h2 id={dialogTitleId} ref={dialogTitleRef} tabIndex={-1} className="sr-only">
            {`${displayName} の詳細`}
          </h2>
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={[
                'mt-0.5 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border text-xl font-black shadow-[inset_0_1px_6px_rgba(0,0,0,0.28)]',
                portraitMeta.portraitClass,
              ].join(' ')}
              aria-hidden="true"
            >
              {portraitMeta.label}
            </div>

            <div className="min-w-0">
              <p className="text-[11px] tracking-[0.08em] text-slate-400">軍勢詳細</p>
              {isEditingName ? (
                <div className="mt-1 flex items-center gap-2">
                  <input
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    aria-label="兵名を改める入力"
                    className="w-56 rounded-md border border-[color:var(--kincha)]/45 bg-black/30 px-2 py-1 text-sm text-slate-100 outline-none ring-offset-0 focus:border-[color:var(--kincha)]/75"
                    maxLength={40}
                  />
                  <button
                    type="button"
                    onClick={() => void saveName()}
                    disabled={isSavingName}
                    className="rounded-md border border-emerald-300/45 bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-100 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isSavingName ? '保存中...' : '保存'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(displayName);
                      setIsEditingName(false);
                    }}
                    className="rounded-md border border-slate-300/35 bg-slate-500/20 px-2 py-1 text-xs font-semibold text-slate-100"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingName(true)}
                  className="mt-1 rounded-md border border-transparent px-1 text-left text-xl font-semibold text-[color:var(--kincha)] transition hover:border-[color:var(--kincha)]/35 hover:bg-[color:var(--kincha)]/10"
                  style={{ fontFamily: '"Noto Serif JP", serif' }}
                >
                  {displayName}
                </button>
              )}
              <p className="mt-1 text-[11px] text-slate-400">兵識別: {agentId}</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300/35 bg-slate-500/20 px-2 py-1 text-sm font-semibold text-slate-100"
            aria-label="閉じる"
          >
            ×
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
            <div className="rounded-lg border border-[color:var(--kincha)]/25 bg-black/25 p-3">
              <p className="mb-1 text-[11px] text-slate-400">戦況</p>
              <span
                className={[
                  'inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold',
                  statusMeta.badgeClass,
                ].join(' ')}
              >
                {statusMeta.label}
              </span>
            </div>

            <div className="rounded-lg border border-[color:var(--kincha)]/25 bg-black/25 p-3">
              <p className="mb-1 text-[11px] text-slate-400">気力消耗</p>
              <p className="text-sm text-slate-100">
                {contextUsedPercent === null ? '取得中...' : `${contextUsedPercent}%`}
              </p>
            </div>

            <div className="rounded-lg border border-[color:var(--kincha)]/25 bg-black/25 p-3">
              <p className="mb-1 text-[11px] text-slate-400">現在の任務</p>
              <p className="break-words text-sm text-slate-100">{taskLabel}</p>
              {currentTask?.description ? (
                <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-slate-500/30 bg-slate-950/35 px-2 py-1.5">
                  <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-300">
                    {currentTask.description}
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="flex min-h-0 flex-col rounded-lg border border-[color:var(--kincha)]/25 bg-black/25 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h4
                className="text-sm font-semibold text-[color:var(--kincha)]"
                style={{ fontFamily: '"Noto Serif JP", serif' }}
              >
                発言・報告履歴
              </h4>
              {isLoadingHistory ? (
                <span className="text-[11px] text-slate-400">読み込み中...</span>
              ) : null}
            </div>

            <div
              ref={historyContainerRef}
              className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
            >
              {displayEntries.length > 0 ? (
                displayEntries.map((entry) => (
                  <article
                    key={entry.id}
                    className="rounded-md border border-slate-400/25 bg-slate-900/60 px-2.5 py-2"
                  >
                    <div className="text-[11px] text-slate-200">
                      {renderHistoryMessage(entry.message)}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-slate-400">
                      <span>{formatTimestamp(entry.timestamp)}</span>
                      <span>{formatTaskStatusLabel(entry.status) ?? '不明'}</span>
                      {entry.taskId ? <span>{entry.taskId}</span> : null}
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-slate-500/35 px-3 py-2 text-xs text-slate-300">
                  {role === 'karo'
                    ? '履歴を取得中でござる。現時点で表示対象は見つからぬ。'
                    : '履歴はまだ無い。'}
                </div>
              )}
            </div>
          </section>
        </div>

        {notice ? (
          <footer className="border-t border-[color:var(--kincha)]/25 px-5 py-3 text-xs text-rose-200">
            {notice}
          </footer>
        ) : null}
      </article>
    </div>
  );
};

export default AgentDetailModal;
