import chokidar, { type FSWatcher } from 'chokidar';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { WSEventType } from './types';
import { readYamlFile } from './yaml-parser';

type FileEventName = 'add' | 'change' | 'unlink';
type LooseRecord = Record<string, unknown>;

interface MatchedEventType {
  type: WSEventType;
  kind: 'task' | 'report' | 'dashboard' | 'command' | 'game_state';
}

const WATCHER_WRITE_STABILITY_THRESHOLD_MS = 250;
const WATCHER_WRITE_POLL_INTERVAL_MS = 50;
const WATCHER_PARSE_RETRY_DELAY_MS = 80;
const WATCHER_PARSE_RETRY_ATTEMPTS = 1;
const WATCHER_EVENT_DEDUPE_WINDOW_MS = 300;

export interface CreateFileWatcherOptions {
  rootDir: string;
  onMessage: <T>(type: WSEventType, payload: T) => void;
  onError?: (error: Error) => void;
}

export interface FileWatcherHandle {
  close: () => Promise<void>;
}

function normalizeRelativePath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function matchEventType(relativePath: string): MatchedEventType | null {
  if (relativePath.startsWith('queue/tasks/') && relativePath.endsWith('.yaml')) {
    return { type: 'task_update', kind: 'task' };
  }

  if (relativePath.startsWith('queue/reports/') && relativePath.endsWith('.yaml')) {
    return { type: 'report_update', kind: 'report' };
  }

  if (relativePath === 'queue/shogun_to_karo.yaml') {
    return { type: 'command_update', kind: 'command' };
  }

  if (relativePath === 'dashboard.md') {
    return { type: 'dashboard_update', kind: 'dashboard' };
  }

  if (relativePath === 'web/game-state.yaml') {
    return { type: 'game_state_update', kind: 'game_state' };
  }

  return null;
}

function getWorkerIdFromPath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

function withYamlError(error: string, raw: string): LooseRecord {
  return {
    error,
    raw,
  };
}

function normalizeYamlPayload(data: unknown): LooseRecord {
  if (data === null || Array.isArray(data) || typeof data !== 'object') {
    return { content: data };
  }

  return data as LooseRecord;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readTaskLikeYamlWithRetry(filePath: string): Promise<LooseRecord> {
  let lastParseError: { message: string; raw: string } | null = null;
  for (let attempt = 0; attempt <= WATCHER_PARSE_RETRY_ATTEMPTS; attempt += 1) {
    const result = await readYamlFile<LooseRecord>(filePath);
    if (result.error === null) {
      return normalizeYamlPayload(result.data);
    }

    lastParseError = {
      message: result.error,
      raw: result.raw,
    };
    if (attempt < WATCHER_PARSE_RETRY_ATTEMPTS) {
      await sleep(WATCHER_PARSE_RETRY_DELAY_MS);
    }
  }

  if (lastParseError === null) {
    return withYamlError('Failed to parse YAML payload', '');
  }

  return withYamlError(lastParseError.message, lastParseError.raw);
}

async function buildTaskLikePayload(
  filePath: string,
  fsEvent: FileEventName
): Promise<LooseRecord> {
  const workerId = getWorkerIdFromPath(filePath);
  if (fsEvent === 'unlink') {
    return {
      workerId,
      deleted: true,
    };
  }

  return {
    workerId,
    ...(await readTaskLikeYamlWithRetry(filePath)),
  };
}

async function buildDashboardPayload(
  filePath: string,
  fsEvent: FileEventName
): Promise<LooseRecord> {
  if (fsEvent === 'unlink') {
    return { content: '', deleted: true };
  }

  try {
    const content = await fs.readFile(filePath, 'utf8');
    return { content };
  } catch (error) {
    return {
      content: '',
      error: error instanceof Error ? error.message : 'Failed to read dashboard markdown',
    };
  }
}

async function buildCommandPayload(filePath: string, fsEvent: FileEventName): Promise<LooseRecord> {
  if (fsEvent === 'unlink') {
    return { commands: [], deleted: true };
  }

  const result = await readYamlFile<LooseRecord>(filePath);
  if (result.error !== null) {
    return {
      commands: [],
      ...withYamlError(result.error, result.raw),
    };
  }

  const queue = result.data?.queue;
  return {
    commands: Array.isArray(queue) ? queue : [],
  };
}

async function buildGameStatePayload(
  filePath: string,
  fsEvent: FileEventName
): Promise<LooseRecord> {
  if (fsEvent === 'unlink') {
    return { deleted: true };
  }

  const result = await readYamlFile<LooseRecord>(filePath);
  if (result.error !== null) {
    return withYamlError(result.error, result.raw);
  }

  if (result.data === null || Array.isArray(result.data) || typeof result.data !== 'object') {
    return { state: result.data };
  }

  return result.data;
}

async function buildPayload(
  filePath: string,
  matchedEventType: MatchedEventType,
  fsEvent: FileEventName
): Promise<LooseRecord> {
  switch (matchedEventType.kind) {
    case 'task':
    case 'report':
      return buildTaskLikePayload(filePath, fsEvent);
    case 'dashboard':
      return buildDashboardPayload(filePath, fsEvent);
    case 'command':
      return buildCommandPayload(filePath, fsEvent);
    case 'game_state':
      return buildGameStatePayload(filePath, fsEvent);
    default:
      return {};
  }
}

function buildUnlinkPayload(filePath: string, matchedEventType: MatchedEventType): LooseRecord {
  switch (matchedEventType.kind) {
    case 'task':
    case 'report':
      return {
        workerId: getWorkerIdFromPath(filePath),
        deleted: true,
      };
    case 'dashboard':
      return { content: '', deleted: true };
    case 'command':
      return { commands: [], deleted: true };
    case 'game_state':
      return { deleted: true };
    default:
      return {};
  }
}

async function resolveMtimeMs(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

async function resolveContentHash(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath);
    return createHash('sha1').update(content).digest('hex');
  } catch {
    return null;
  }
}

async function resolveDedupeFingerprint(
  filePath: string,
  fsEvent: FileEventName
): Promise<string> {
  if (fsEvent === 'unlink') {
    return 'unlink';
  }

  const [mtimeMs, contentHash] = await Promise.all([
    resolveMtimeMs(filePath),
    resolveContentHash(filePath),
  ]);
  return `${mtimeMs ?? -1}:${contentHash ?? 'missing'}`;
}

function pruneExpiredDedupeEntries(dedupeCache: Map<string, number>, now: number): void {
  for (const [key, seenAt] of dedupeCache.entries()) {
    if (now - seenAt > WATCHER_EVENT_DEDUPE_WINDOW_MS * 3) {
      dedupeCache.delete(key);
    }
  }
}

async function shouldSkipDuplicateEvent(
  dedupeCache: Map<string, number>,
  fsEvent: FileEventName,
  absolutePath: string,
  relativePath: string
): Promise<boolean> {
  const fingerprint = await resolveDedupeFingerprint(absolutePath, fsEvent);
  const dedupeKey = `${relativePath}:${fsEvent}:${fingerprint}`;
  const now = Date.now();
  pruneExpiredDedupeEntries(dedupeCache, now);

  const lastSeenAt = dedupeCache.get(dedupeKey);
  dedupeCache.set(dedupeKey, now);
  return lastSeenAt !== undefined && now - lastSeenAt <= WATCHER_EVENT_DEDUPE_WINDOW_MS;
}

export function createFileWatcher(options: CreateFileWatcherOptions): FileWatcherHandle {
  const watchPaths = [
    path.join(options.rootDir, 'queue', 'tasks', '*.yaml'),
    path.join(options.rootDir, 'queue', 'reports', '*.yaml'),
    path.join(options.rootDir, 'queue', 'shogun_to_karo.yaml'),
    path.join(options.rootDir, 'dashboard.md'),
    path.join(options.rootDir, 'web', 'game-state.yaml'),
  ];
  const dedupeCache = new Map<string, number>();

  const watcher: FSWatcher = chokidar.watch(watchPaths, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: WATCHER_WRITE_STABILITY_THRESHOLD_MS,
      pollInterval: WATCHER_WRITE_POLL_INTERVAL_MS,
    },
  });

  const handleEvent = (fsEvent: FileEventName, absolutePath: string): void => {
    const relativePath = normalizeRelativePath(options.rootDir, absolutePath);
    const matchedEventType = matchEventType(relativePath);
    if (matchedEventType === null) {
      return;
    }

    void (async () => {
      try {
        if (await shouldSkipDuplicateEvent(dedupeCache, fsEvent, absolutePath, relativePath)) {
          return;
        }

        const payload =
          fsEvent === 'unlink'
            ? buildUnlinkPayload(absolutePath, matchedEventType)
            : await buildPayload(absolutePath, matchedEventType, fsEvent);
        options.onMessage(matchedEventType.type, payload);
      } catch (error) {
        if (options.onError !== undefined) {
          const normalizedError = error instanceof Error ? error : new Error(String(error));
          options.onError(normalizedError);
        }
      }
    })();
  };

  watcher.on('add', (absolutePath) => {
    handleEvent('add', absolutePath);
  });

  watcher.on('change', (absolutePath) => {
    handleEvent('change', absolutePath);
  });

  watcher.on('unlink', (absolutePath) => {
    handleEvent('unlink', absolutePath);
  });

  watcher.on('error', (error) => {
    if (options.onError !== undefined) {
      options.onError(error instanceof Error ? error : new Error(String(error)));
    }
  });

  return {
    close: async () => {
      await watcher.close();
    },
  };
}
