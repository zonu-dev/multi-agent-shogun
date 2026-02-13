import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface ArchiveCommandItem {
  id: string;
  command: string;
  status: string;
  completedAt: string | null;
  note: string | null;
}

interface ArchivePayload {
  commands?: unknown;
  page?: unknown;
  limit?: unknown;
  total?: unknown;
}

interface FetchArchiveOptions {
  reset?: boolean;
}

const ARCHIVE_PAGE_SIZE = 20;
const DEFAULT_ARCHIVE_COMMANDS_API_PATH = '/api/archive-commands';

const resolveArchiveCommandsApiUrl = (): string => {
  const envUrlCandidate =
    typeof import.meta.env.VITE_ARCHIVE_COMMANDS_API_URL === 'string'
      ? import.meta.env.VITE_ARCHIVE_COMMANDS_API_URL.trim()
      : '';
  if (envUrlCandidate.length > 0) {
    return envUrlCandidate;
  }

  return DEFAULT_ARCHIVE_COMMANDS_API_PATH;
};

const buildArchiveCommandsApiUrl = (params: URLSearchParams): string => {
  const baseUrl = resolveArchiveCommandsApiUrl();
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}${params.toString()}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const toSafePositiveInt = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.floor(value));
};

const normalizeArchiveCommandItem = (entry: unknown): ArchiveCommandItem | null => {
  if (!isRecord(entry)) {
    return null;
  }

  const idCandidate = (
    typeof entry.id === 'string' && entry.id.trim().length > 0
      ? entry.id
      : typeof entry.commandId === 'string' && entry.commandId.trim().length > 0
        ? entry.commandId
        : ''
  ).trim();
  const commandCandidate = (
    typeof entry.command === 'string' && entry.command.trim().length > 0
      ? entry.command
      : typeof entry.message === 'string' && entry.message.trim().length > 0
        ? entry.message
        : ''
  ).trim();
  const noteCandidate =
    typeof entry.note === 'string' && entry.note.trim().length > 0 ? entry.note.trim() : null;

  if (idCandidate.length < 1 && commandCandidate.length < 1 && noteCandidate === null) {
    return null;
  }

  return {
    id: idCandidate || 'cmd_---',
    command: commandCandidate || noteCandidate || '内容不明',
    status: typeof entry.status === 'string' ? entry.status : '',
    completedAt:
      typeof entry.completed_at === 'string'
        ? entry.completed_at
        : typeof entry.completedAt === 'string'
          ? entry.completedAt
          : null,
    note: noteCandidate,
  };
};

const mergeArchiveCommandItems = (
  current: ArchiveCommandItem[],
  incoming: ArchiveCommandItem[]
): ArchiveCommandItem[] => {
  if (incoming.length < 1) {
    return current;
  }

  const merged = [...current];
  const seen = new Set(
    merged.map((item) => `${item.id}|${item.command}|${item.completedAt ?? ''}`)
  );

  incoming.forEach((item) => {
    const key = `${item.id}|${item.command}|${item.completedAt ?? ''}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(item);
  });

  return merged;
};

export const formatArchiveCompletedAt = (value: string | null): string => {
  if (!value || value.trim().length < 1) {
    return '日時不詳';
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString('ja-JP');
};

const isAbortError = (error: unknown): boolean =>
  (error instanceof Error && error.name === 'AbortError') ||
  (typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError');

export const useArchive = () => {
  const [archiveItems, setArchiveItems] = useState<ArchiveCommandItem[]>([]);
  const [archiveTotal, setArchiveTotal] = useState<number | null>(null);
  const [archivePage, setArchivePage] = useState(0);
  const [archiveLimit, setArchiveLimit] = useState(ARCHIVE_PAGE_SIZE);
  const [archiveLastPageCount, setArchiveLastPageCount] = useState(0);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveInitialized, setArchiveInitialized] = useState(false);
  const archiveRequestIdRef = useRef(0);
  const archiveAbortControllerRef = useRef<AbortController | null>(null);

  const fetchArchiveCommands = useCallback(async (page: number, options?: FetchArchiveOptions) => {
    const reset = options?.reset ?? false;
    const requestId = archiveRequestIdRef.current + 1;
    archiveRequestIdRef.current = requestId;
    archiveAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    archiveAbortControllerRef.current = abortController;

    setArchiveLoading(true);
    setArchiveError(null);

    try {
      const params = new URLSearchParams({
        page: String(Math.max(1, page)),
        limit: String(ARCHIVE_PAGE_SIZE),
      });
      const response = await fetch(buildArchiveCommandsApiUrl(params), {
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error(`archive fetch failed: ${response.status}`);
      }

      const payload = (await response.json().catch(() => null)) as ArchivePayload | null;
      if (abortController.signal.aborted || requestId !== archiveRequestIdRef.current) {
        return;
      }
      if (!isRecord(payload) || !Array.isArray(payload.commands)) {
        throw new Error('archive response is invalid');
      }

      const fetchedItems = payload.commands
        .map((entry) => normalizeArchiveCommandItem(entry))
        .filter((entry): entry is ArchiveCommandItem => entry !== null);
      const resolvedPage = toSafePositiveInt(payload.page);
      const resolvedLimit = toSafePositiveInt(payload.limit);
      const resolvedTotal = toSafePositiveInt(payload.total);

      setArchiveItems((current) => mergeArchiveCommandItems(reset ? [] : current, fetchedItems));
      setArchivePage(resolvedPage ?? Math.max(1, page));
      setArchiveLimit(resolvedLimit && resolvedLimit > 0 ? resolvedLimit : ARCHIVE_PAGE_SIZE);
      setArchiveTotal(resolvedTotal);
      setArchiveLastPageCount(fetchedItems.length);
      setArchiveInitialized(true);
    } catch (error) {
      if (abortController.signal.aborted || isAbortError(error)) {
        return;
      }
      if (requestId !== archiveRequestIdRef.current) {
        return;
      }
      console.error('[archive] failed to fetch archive commands:', error);
      setArchiveError('読み込み失敗');
      if (options?.reset) {
        setArchiveItems([]);
        setArchiveTotal(null);
        setArchivePage(0);
        setArchiveLastPageCount(0);
      }
      setArchiveInitialized(true);
    } finally {
      if (requestId === archiveRequestIdRef.current) {
        setArchiveLoading(false);
        archiveAbortControllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (archiveInitialized) {
      return;
    }

    void fetchArchiveCommands(1, { reset: true });
  }, [archiveInitialized, fetchArchiveCommands]);

  useEffect(() => {
    return () => {
      archiveRequestIdRef.current += 1;
      archiveAbortControllerRef.current?.abort();
      archiveAbortControllerRef.current = null;
    };
  }, []);

  const archiveCount = archiveTotal ?? archiveItems.length;

  const hasMoreArchiveItems = useMemo(() => {
    const hasKnownArchiveTotal = archiveTotal !== null;
    const archivePageSize = Math.max(1, archiveLimit);
    const archiveTotalPages = hasKnownArchiveTotal
      ? Math.max(1, Math.ceil(archiveTotal / archivePageSize))
      : null;

    return hasKnownArchiveTotal
      ? archivePage > 0 && archivePage < (archiveTotalPages ?? 0)
      : archiveInitialized && archiveLastPageCount >= archiveLimit && archiveLastPageCount > 0;
  }, [archiveInitialized, archiveLastPageCount, archiveLimit, archivePage, archiveTotal]);

  return {
    archiveItems,
    archiveCount,
    archivePage,
    archiveLoading,
    archiveError,
    archiveInitialized,
    hasMoreArchiveItems,
    fetchArchiveCommands,
  };
};
