export interface ParsedLine {
  kind: 'h1' | 'h2' | 'h3' | 'h4' | 'bullet' | 'table' | 'text' | 'timestamp' | 'empty';
  text: string;
  alert: boolean;
}

export interface BlockSegment {
  type: 'block';
  startIndex: number;
  lines: ParsedLine[];
}

export interface AccordionSegment {
  type: 'accordion';
  startIndex: number;
  heading: ParsedLine;
  lines: ParsedLine[];
  itemCount: number;
}

export type RenderSegment = BlockSegment | AccordionSegment;

export interface InProgressTableRow {
  assignee: string;
  mission: string;
  status: string;
}

export interface InProgressTableGroup {
  cmdId: string;
  summary: string;
  rows: InProgressTableRow[];
}

export interface InProgressTaskHint {
  taskId?: string | null;
  taskTitle?: string | null;
}

interface InProgressStructuredDraft {
  assignee: string | null;
  mission: string | null;
  status: string | null;
  sawKnownLabel: boolean;
}

interface ParseInProgressOptions {
  taskHintsByAssignee?: Readonly<Record<string, InProgressTaskHint | null>>;
}

export interface AlertIssueItem {
  key: string;
  heading: string;
  detailLines: ParsedLine[];
}

interface ParsedDashboardSnapshot {
  content: string;
  parsedLines: ParsedLine[];
  alertIssueItems: AlertIssueItem[];
}

const alertIssueCacheByLines = new WeakMap<ParsedLine[], AlertIssueItem[]>();
let latestDashboardSnapshot: ParsedDashboardSnapshot | null = null;

const inProgressCmdPattern = /^((?:cmd|CMD)[_-]?\d+[^\s:：]*)\s*(?:[:：]\s*|\s+)(.+)$/;
const inProgressAssigneePattern = /^([^:：]+)\s*[:：]\s*(.+)$/;
const inProgressStatusSignalPattern =
  /(?:進行中|作業中|完了|待機|停止|保留|対応中|確認中|済|blocked|blocking|done|wip|in\s*progress|todo|doing|🔄|✅|❌|⏸️)/iu;
const inProgressSummarySplitPattern = /^(.+)\s+[—–-]\s+(.+)$/u;
const dashboardCmdTokenPattern = /\b(?:cmd|CMD)[_-]?\d+[a-z0-9_-]*/g;
const dashboardTaskTokenPattern = /\b(?:subtask|task)[_-]?\d+[a-z0-9_-]*/gi;
const dashboardInternalLabelPattern = /\b(?:task[_-]?id|command[_-]?id)\b/gi;

type InProgressFieldKind = 'assignee' | 'mission' | 'status' | 'priority';

const applyDashboardLoreTermNormalization = (text: string): string => {
  return text
    .replace(/API未提供/gi, '判定中')
    .replace(/\bnew[_\s-]?implementation\b/gi, '新設任務')
    .replace(/\brefactor(?:ing)?\b/gi, '改修任務')
    .replace(/新規実装/g, '新設任務')
    .replace(/リファクタリング/g, '改修任務')
    .replace(/リファクタ/g, '改修')
    .replace(/担当cmd/gi, '担当任務')
    .replace(/\bcontext残\b/gi, '文脈残')
    .replace(/\bcontext\b/gi, '文脈');
};

const stripDashboardInternalIds = (text: string): { value: string; removed: boolean } => {
  let removed = false;
  let normalized = text;

  const withoutCmd = normalized.replace(dashboardCmdTokenPattern, '');
  if (withoutCmd !== normalized) {
    removed = true;
    normalized = withoutCmd;
  }

  const withoutTask = normalized.replace(dashboardTaskTokenPattern, '');
  if (withoutTask !== normalized) {
    removed = true;
    normalized = withoutTask;
  }

  const withoutInternalLabel = normalized.replace(dashboardInternalLabelPattern, '');
  if (withoutInternalLabel !== normalized) {
    removed = true;
    normalized = withoutInternalLabel;
  }

  normalized = normalized
    .replace(/\s{2,}/g, ' ')
    .replace(/([:：|｜])\s*(?=[:：|｜])/g, '$1')
    .replace(/^[\s:：|｜\-—–/]+/, '')
    .replace(/[\s:：|｜\-—–/]+$/, '')
    .trim();

  return {
    value: normalized,
    removed,
  };
};

export const normalizeDashboardDisplayText = (
  text: string,
  options?: { fallbackWhenIdOnly?: string }
): string => {
  const withLoreTerms = applyDashboardLoreTermNormalization(text);
  const stripped = stripDashboardInternalIds(withLoreTerms);
  if (stripped.value.length > 0) {
    return stripped.value;
  }

  if (stripped.removed) {
    const fallback = options?.fallbackWhenIdOnly?.trim();
    return fallback && fallback.length > 0 ? fallback : '任務進行中';
  }

  return withLoreTerms.trim();
};

const normalizePlaceholderText = (text: string): string => {
  return text
    .replace(/^#+\s*/, '')
    .replace(/^[・-]\s*/, '')
    .trim()
    .toLowerCase()
    .replace(/[。．、，,]/g, '')
    .replace(/\s+/g, '');
};

export const isPlaceholderText = (text: string): boolean => {
  const normalized = normalizePlaceholderText(text);

  return (
    normalized.length === 0 ||
    normalized === 'なし' ||
    normalized === 'none' ||
    normalized === 'なし(none)' ||
    normalized === 'none(なし)' ||
    normalized === '現在なし' ||
    normalized === '(現在なし)' ||
    normalized === '（現在なし）' ||
    normalized === '該当なし' ||
    normalized === '現在要対応項目はないでござる' ||
    normalized === 'n/a' ||
    normalized === 'na'
  );
};

export const isDailyResultsHeading = (line: ParsedLine): boolean => {
  return line.kind === 'h2' && line.text.includes('本日の戦果');
};

const isArchivedCommandsHeading = (line: ParsedLine): boolean => {
  return line.kind === 'h2' && line.text.includes('アーカイブ済み命令');
};

export const isInProgressHeading = (line: ParsedLine): boolean => {
  return line.kind === 'h2' && line.text.includes('進行中');
};

export const isAshigaruPlacementHeading = (line: ParsedLine): boolean => {
  return line.kind === 'h2' && line.text.includes('足軽配置状況');
};

export const isAlertHeading = (line: ParsedLine): boolean => {
  return line.kind === 'h2' && line.text.includes('要対応');
};

const isWaitingHeading = (line: ParsedLine): boolean => {
  return line.kind === 'h2' && line.text.includes('待機中');
};

const isInquiryHeading = (line: ParsedLine): boolean => {
  return line.kind === 'h2' && line.text.includes('伺い事項');
};

const isLegacySkillCandidateHeading = (line: ParsedLine): boolean => {
  return line.kind === 'h2' && line.text.includes('スキル化候補');
};

const isLegacyGeneratedSkillsHeading = (line: ParsedLine): boolean => {
  return line.kind === 'h2' && line.text.includes('生成されたスキル');
};

const isLegacyBugAuditHeading = (line: ParsedLine): boolean => {
  return (
    line.kind === 'h2' &&
    (line.text.includes('不具合洗い出し結果') || line.text.includes('cmd_152'))
  );
};

const shouldHideSectionHeading = (line: ParsedLine): boolean => {
  return (
    isArchivedCommandsHeading(line) ||
    isWaitingHeading(line) ||
    isInquiryHeading(line) ||
    isLegacySkillCandidateHeading(line) ||
    isLegacyGeneratedSkillsHeading(line) ||
    isLegacyBugAuditHeading(line)
  );
};

const isAccordionH2Heading = (line: ParsedLine, includeDailyResultsH2: boolean): boolean => {
  if (line.kind !== 'h2') {
    return false;
  }

  if (includeDailyResultsH2 && isDailyResultsHeading(line)) {
    return true;
  }

  return (
    isAlertHeading(line) ||
    isInProgressHeading(line) ||
    isAshigaruPlacementHeading(line) ||
    isArchivedCommandsHeading(line)
  );
};

const parseTableCells = (line: string): string[] => {
  return line
    .trim()
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell, index, all) => {
      if (cell.length > 0) {
        return true;
      }
      return index !== 0 && index !== all.length - 1;
    });
};

const isMarkdownTableLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed.length < 1) {
    return false;
  }
  if (!trimmed.startsWith('|')) {
    return false;
  }
  return !/^[-*+]\s+/.test(trimmed);
};

const isTableSeparatorRow = (cells: string[]): boolean => {
  if (cells.length === 0) {
    return false;
  }
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
};

export const parseMarkdownTable = (
  tableLines: ParsedLine[]
): { headerRow: string[]; bodyRows: string[][] } | null => {
  const tableRows: string[][] = [];
  for (const tableLine of tableLines) {
    const rawLine = tableLine.text.trim();
    if (!isMarkdownTableLine(rawLine)) {
      break;
    }
    const cells = parseTableCells(rawLine);
    if (cells.length > 0) {
      tableRows.push(cells);
    }
  }

  if (tableRows.length === 0) {
    return null;
  }

  return {
    headerRow: tableRows[0],
    bodyRows: tableRows.slice(1).filter((cells) => !isTableSeparatorRow(cells)),
  };
};

const ISSUE_HEADING_PREFIX_PATTERN = /^件\s*\d+\s*[.:：]\s*/u;

const stripIssueHeadingPrefix = (value: string): string => {
  return value.replace(ISSUE_HEADING_PREFIX_PATTERN, '').trim();
};

const IN_PROGRESS_GENERIC_MISSION_TEXT = new Set<string>([
  'codex',
  'codexhigh',
  'codexmedium',
  'codexlow',
  'codexcritical',
  'high',
  'medium',
  'low',
  'critical',
  'todo',
  'working',
  'inprogress',
  '進行中',
]);

const TASK_TOKEN_LABEL_MAP: Readonly<Record<string, string>> = Object.freeze({
  uiux: 'UI/UX',
  dx: 'DX',
  bugs: '不具合',
  bug: '不具合',
  bug345: 'バグ3+4+5',
  testing: 'テスト',
  test: 'テスト',
  security: 'セキュリティ',
  performance: 'パフォーマンス',
  refactoring: 'リファクタリング',
  spec: '仕様',
  inconsistency: '不整合',
  game: 'ゲーム',
  level: 'レベル',
  design: 'デザイン',
  parser: 'パーサー',
  analysis: '分析',
  report: '報告',
});

const toNormalizedMissionToken = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z\u3040-\u30FF\u3400-\u9FFF]+/g, '');
};

const isGenericInProgressMissionText = (value: string): boolean => {
  const normalized = toNormalizedMissionToken(value);
  if (normalized.length < 1) {
    return true;
  }
  return IN_PROGRESS_GENERIC_MISSION_TEXT.has(normalized);
};

const isLikelyFileReference = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    return false;
  }

  return (
    /[\\/]/.test(trimmed) ||
    /\b[a-z0-9_-]+\.(?:md|txt|ts|tsx|js|jsx|json|yaml|yml)\b/i.test(trimmed)
  );
};

const normalizeTaskLabelToken = (token: string): string => {
  const normalized = token.trim().toLowerCase();
  if (normalized.length < 1) {
    return '';
  }

  const mapped = TASK_TOKEN_LABEL_MAP[normalized];
  if (mapped !== undefined) {
    return mapped;
  }

  if (/^\d+$/.test(normalized)) {
    return normalized;
  }

  if (normalized.length <= 2) {
    return normalized.toUpperCase();
  }

  return normalized;
};

const humanizeTaskSlug = (slug: string): string => {
  const parts = slug
    .split(/[_-]+/)
    .map((part) => normalizeTaskLabelToken(part))
    .filter((part) => part.length > 0);

  return parts.join(' ').trim();
};

const reportReferencePattern = /report_(\d+)_([a-z0-9_]+)\.md/gi;

const resolveMissionFromReportReferences = (value: string): string | null => {
  const labels: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null = reportReferencePattern.exec(value);

  while (match !== null) {
    const index = Number.parseInt(match[1] ?? '', 10);
    const slug = match[2] ?? '';
    const humanized = humanizeTaskSlug(slug);
    if (Number.isFinite(index) && humanized.length > 0) {
      const label = `観点${index}: ${humanized}`;
      if (!seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    }
    match = reportReferencePattern.exec(value);
  }

  reportReferencePattern.lastIndex = 0;
  return labels.length > 0 ? labels.join(' / ') : null;
};

const resolveMissionFromTaskId = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    return null;
  }

  const taskIdMatch = trimmed.match(/(?:^|[\s,])(subtask[_-]?\d+[_-][a-z0-9_]+)/i);
  if (!taskIdMatch) {
    return null;
  }

  const candidate = taskIdMatch[1];
  const core =
    candidate
      .toLowerCase()
      .replace(/^(?:subtask|task)[_-]?\d+[_-]?/i, '')
      .replace(/^[\W_]+|[\W_]+$/g, '') ?? '';

  if (core.length < 1) {
    return null;
  }

  const humanized = humanizeTaskSlug(core);
  return humanized.length > 0 ? humanized : null;
};

const resolveMissionFromFileReference = (value: string): string | null => {
  const reportMission = resolveMissionFromReportReferences(value);
  if (reportMission !== null) {
    return reportMission;
  }

  if (!isLikelyFileReference(value)) {
    return null;
  }

  const pathSegments = value
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const lastSegment = pathSegments[pathSegments.length - 1];
  if (!lastSegment) {
    return null;
  }

  const withoutExtension = lastSegment.replace(/\.[a-z0-9]+$/i, '');
  const withoutKnownPrefix = withoutExtension
    .replace(/^report_\d+_/i, '')
    .replace(/^subtask_\d+_/i, '')
    .replace(/^task_\d+_/i, '');

  const humanized = humanizeTaskSlug(withoutKnownPrefix);
  return humanized.length > 0 ? humanized : null;
};

const toAssigneeId = (value: string): string | null => {
  const normalized = value.replace(/[\s~]/g, '').toLowerCase();
  const direct = normalized.match(/^ashigaru[_-]?(\d+)$/);
  if (direct) {
    return `ashigaru${direct[1]}`;
  }

  const japanese = normalized.match(/^足軽(\d+)$/);
  if (japanese) {
    return `ashigaru${japanese[1]}`;
  }

  return null;
};

const resolveMissionFromTaskHint = (
  taskHint: InProgressTaskHint | null | undefined
): string | null => {
  if (!taskHint) {
    return null;
  }

  const taskTitle = typeof taskHint.taskTitle === 'string' ? taskHint.taskTitle.trim() : '';
  if (
    taskTitle.length > 0 &&
    !isPlaceholderText(taskTitle) &&
    !isGenericInProgressMissionText(taskTitle) &&
    !isLikelyFileReference(taskTitle)
  ) {
    return taskTitle;
  }

  const taskId = typeof taskHint.taskId === 'string' ? taskHint.taskId.trim() : '';
  if (taskId.length < 1) {
    return null;
  }

  return resolveMissionFromTaskId(taskId) ?? taskId;
};

const resolveInProgressMissionLabel = (
  missionPrimary: string,
  missionFile: string,
  taskHint: InProgressTaskHint | null | undefined
): string => {
  const trimmedPrimary = missionPrimary.trim();
  if (
    trimmedPrimary.length > 0 &&
    !isPlaceholderText(trimmedPrimary) &&
    !isGenericInProgressMissionText(trimmedPrimary) &&
    !isLikelyFileReference(trimmedPrimary)
  ) {
    return trimmedPrimary;
  }

  const fromTaskHint = resolveMissionFromTaskHint(taskHint);
  if (fromTaskHint !== null) {
    return fromTaskHint;
  }

  const fromTaskIdInPrimary = resolveMissionFromTaskId(trimmedPrimary);
  if (fromTaskIdInPrimary !== null) {
    return fromTaskIdInPrimary;
  }

  const fromPrimaryFile = resolveMissionFromFileReference(trimmedPrimary);
  if (fromPrimaryFile !== null) {
    return fromPrimaryFile;
  }

  const fromMissionFile = resolveMissionFromFileReference(missionFile);
  if (fromMissionFile !== null) {
    return fromMissionFile;
  }

  if (trimmedPrimary.length > 0 && !isPlaceholderText(trimmedPrimary)) {
    return trimmedPrimary;
  }

  return '—';
};

const resolveInProgressStatusLabel = (rawStatus: string): string => {
  const normalized = rawStatus.trim();
  if (normalized.length < 1 || isPlaceholderText(normalized) || isLikelyFileReference(normalized)) {
    return '進行中';
  }

  return normalized;
};

const isPlaceholderIssueHeading = (heading: string): boolean => {
  return isPlaceholderText(stripIssueHeadingPrefix(heading));
};

const countAccordionItems = (
  lines: ParsedLine[],
  options?: {
    excludeNestedH3Sections?: boolean;
    countTextItems?: boolean;
    countNestedH3Headings?: boolean;
  }
): number => {
  let count = 0;
  let index = 0;
  const excludeNestedH3Sections = options?.excludeNestedH3Sections ?? false;
  const countTextItems = options?.countTextItems ?? false;
  const countNestedH3Headings = options?.countNestedH3Headings ?? false;

  if (countNestedH3Headings) {
    const nestedHeadingCount = lines.filter(
      (line) => line.kind === 'h3' && !isPlaceholderText(line.text)
    ).length;
    if (nestedHeadingCount > 0) {
      return nestedHeadingCount;
    }
  }

  while (index < lines.length) {
    const line = lines[index];

    if (line.kind === 'empty') {
      index += 1;
      continue;
    }

    if (excludeNestedH3Sections && line.kind === 'h3') {
      index += 1;
      while (index < lines.length && lines[index].kind !== 'h3') {
        index += 1;
      }
      continue;
    }

    if (line.kind === 'h3' || line.kind === 'h4') {
      index += 1;
      continue;
    }

    if (line.kind === 'timestamp' || line.kind === 'h1' || line.kind === 'h2') {
      index += 1;
      continue;
    }

    if (line.kind === 'text') {
      if (isPlaceholderText(line.text) || !countTextItems) {
        index += 1;
        continue;
      }

      count += 1;
      index += 1;
      continue;
    }

    if (line.kind === 'bullet') {
      if (!isPlaceholderText(line.text)) {
        count += 1;
      }
      index += 1;
      continue;
    }

    if (line.kind !== 'table') {
      index += 1;
      continue;
    }

    const tableLines: ParsedLine[] = [];
    let tableCursor = index;
    while (tableCursor < lines.length) {
      const current = lines[tableCursor];
      if (current.kind !== 'table') {
        break;
      }
      tableLines.push(current);
      tableCursor += 1;
    }

    const parsedTable = parseMarkdownTable(tableLines);
    if (parsedTable !== null) {
      count += parsedTable.bodyRows.filter((row) => {
        return row.some((cell) => !isPlaceholderText(cell));
      }).length;
    }
    index = tableCursor;
  }

  return count;
};

const fnv1a32 = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const createStableSegmentSignature = (
  segmentType: RenderSegment['type'],
  startIndexOffset: number,
  lines: ParsedLine[]
): string => {
  const normalizedBody = lines
    .map((line) => `${line.kind}:${line.text}`)
    .join('|');

  return `${segmentType}|${startIndexOffset}|${normalizedBody}`;
};

export const buildSegments = (
  lines: ParsedLine[],
  options: {
    includeDailyResultsH2: boolean;
    startIndexOffset?: number;
  }
): RenderSegment[] => {
  const parsedSegments: RenderSegment[] = [];
  const startIndexOffset = options.startIndexOffset ?? 0;
  const usedStableIndexes = new Set<number>();
  const allocateStableStartIndex = (signature: string): number => {
    let candidate = fnv1a32(signature);
    while (usedStableIndexes.has(candidate)) {
      candidate = (candidate + 1) >>> 0;
    }
    usedStableIndexes.add(candidate);
    return candidate;
  };
  let cursor = 0;

  while (cursor < lines.length) {
    const current = lines[cursor];
    const shouldAccordion =
      current.kind === 'h3' || isAccordionH2Heading(current, options.includeDailyResultsH2);

    if (shouldAccordion) {
      let nextHeading = cursor + 1;
      while (nextHeading < lines.length) {
        const line = lines[nextHeading];
        if (current.kind === 'h3') {
          if (line.kind === 'h1' || line.kind === 'h2' || line.kind === 'h3') {
            break;
          }
        } else if (line.kind === 'h1' || line.kind === 'h2') {
          break;
        }
        nextHeading += 1;
      }

      const accordionLines = lines.slice(cursor + 1, nextHeading);
      const accordionSignature = createStableSegmentSignature('accordion', startIndexOffset, [
        current,
        ...accordionLines,
      ]);

      parsedSegments.push({
        type: 'accordion',
        startIndex: allocateStableStartIndex(accordionSignature),
        heading: current,
        lines: accordionLines,
        itemCount: countAccordionItems(accordionLines, {
          excludeNestedH3Sections: current.kind === 'h2',
          countTextItems: current.kind === 'h3',
          countNestedH3Headings: current.kind === 'h2' && isDailyResultsHeading(current),
        }),
      });
      cursor = nextHeading;
      continue;
    }

    let nextSection = cursor + 1;
    while (nextSection < lines.length) {
      const line = lines[nextSection];
      if (line.kind === 'h3' || isAccordionH2Heading(line, options.includeDailyResultsH2)) {
        break;
      }
      nextSection += 1;
    }

    const blockLines = lines.slice(cursor, nextSection);
    const blockSignature = createStableSegmentSignature('block', startIndexOffset, blockLines);

    parsedSegments.push({
      type: 'block',
      startIndex: allocateStableStartIndex(blockSignature),
      lines: blockLines,
    });
    cursor = nextSection;
  }

  return parsedSegments;
};

export const sanitizeAccordionLinesForDisplay = (
  heading: ParsedLine,
  lines: ParsedLine[]
): ParsedLine[] => {
  if (heading.kind !== 'h2' || !isInProgressHeading(heading)) {
    return lines;
  }

  return lines.filter((line) => {
    if (
      line.kind === 'empty' ||
      line.kind === 'table' ||
      line.kind === 'bullet' ||
      line.kind === 'h3' ||
      line.kind === 'h4'
    ) {
      return true;
    }

    if (line.kind === 'text') {
      return isPlaceholderText(line.text);
    }

    return false;
  });
};

export const stripInlineMarkdown = (text: string): string => {
  return text
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
};

const inProgressAssigneeTokenPattern = /(?:ashigaru[_-]?|足軽)(\d+)/giu;

export const extractInProgressAssigneeIds = (lines: ParsedLine[]): string[] => {
  const assigneeIds = new Set<string>();

  for (const line of lines) {
    if (
      line.kind !== 'table' &&
      line.kind !== 'bullet' &&
      line.kind !== 'text' &&
      line.kind !== 'h3' &&
      line.kind !== 'h4'
    ) {
      continue;
    }

    const normalized = stripInlineMarkdown(line.text);
    let match = inProgressAssigneeTokenPattern.exec(normalized);
    while (match !== null) {
      assigneeIds.add(`ashigaru${match[1]}`);
      match = inProgressAssigneeTokenPattern.exec(normalized);
    }
    inProgressAssigneeTokenPattern.lastIndex = 0;
  }

  return Array.from(assigneeIds).sort();
};

const normalizeInProgressAssignee = (value: string): string => {
  const trimmed = stripInlineMarkdown(value).trim();
  if (trimmed.length < 1) {
    return '全隊';
  }

  const withoutInlineNote = trimmed.replace(/※.*$/u, '').trim();
  const withoutParenthetical = withoutInlineNote.replace(/[（(][^）)]*[）)]/g, '').trim();

  if (withoutParenthetical.length > 0) {
    return withoutParenthetical;
  }

  return trimmed;
};

const normalizeInProgressFieldLabel = (label: string): string => {
  return label
    .trim()
    .toLowerCase()
    .replace(/[*`_]/g, '')
    .replace(/\s+/g, '');
};

const detectInProgressFieldKind = (rawLabel: string): InProgressFieldKind | null => {
  const label = normalizeInProgressFieldLabel(rawLabel);

  if (label === '担当' || label === '担当者' || label === 'assignee' || label === 'owner') {
    return 'assignee';
  }

  if (
    label === '内容' ||
    label === '任務' ||
    label === 'タスク' ||
    label === 'task' ||
    label === '作業' ||
    label === '変更内容' ||
    label === 'summary'
  ) {
    return 'mission';
  }

  if (
    label === 'ステータス' ||
    label === '状態' ||
    label === '進捗' ||
    label === 'status' ||
    label === 'state'
  ) {
    return 'status';
  }

  if (label === 'priority' || label === '優先度') {
    return 'priority';
  }

  return null;
};

const splitInProgressSummary = (summary: string): { mission: string; status: string | null } => {
  const trimmed = summary.trim();
  if (trimmed.length < 1) {
    return {
      mission: '—',
      status: null,
    };
  }

  const summaryMatch = trimmed.match(inProgressSummarySplitPattern);
  if (!summaryMatch) {
    return {
      mission: trimmed,
      status: null,
    };
  }

  const mission = summaryMatch[1].trim();
  const statusCandidate = summaryMatch[2].trim();
  if (statusCandidate.length < 1 || !inProgressStatusSignalPattern.test(statusCandidate)) {
    return {
      mission: trimmed,
      status: null,
    };
  }

  return {
    mission: mission.length > 0 ? mission : trimmed,
    status: statusCandidate,
  };
};

const parseInProgressDetail = (value: string): { mission: string; status: string } => {
  const normalized = value.trim();
  if (normalized.length < 1) {
    return {
      mission: '—',
      status: '—',
    };
  }

  const arrowMatch = normalized.match(/^(.*?)\s*(?:→|->|=>)\s*(.+)$/);
  if (arrowMatch) {
    return {
      mission: arrowMatch[1].trim() || '—',
      status: arrowMatch[2].trim() || '進行中',
    };
  }

  const plusSplit = normalized.split(/\s+\+\s+/);
  if (plusSplit.length >= 2) {
    return {
      mission: plusSplit[0]?.trim() || '—',
      status: plusSplit.slice(1).join(' + ').trim() || '進行中',
    };
  }

  return {
    mission: normalized,
    status: '進行中',
  };
};

const findHeaderIndex = (headerRow: string[], matcher: (header: string) => boolean): number => {
  return headerRow.findIndex((header) => matcher(stripInlineMarkdown(header)));
};

const parseInProgressRowsFromTable = (
  tableLines: ParsedLine[],
  options?: ParseInProgressOptions
): InProgressTableRow[] => {
  const parsedTable = parseMarkdownTable(tableLines);
  if (parsedTable === null || parsedTable.bodyRows.length < 1) {
    return [];
  }

  const headerRow = parsedTable.headerRow;
  const assigneeIndex = findHeaderIndex(
    headerRow,
    (header) => header.includes('足軽') || header.includes('担当')
  );
  const missionIndex = findHeaderIndex(
    headerRow,
    (header) => header.includes('任務') || header.includes('タスク') || header.includes('変更内容')
  );
  const fileIndex = findHeaderIndex(headerRow, (header) => header.includes('ファイル'));
  const statusIndex = findHeaderIndex(
    headerRow,
    (header) => header.includes('ステータス') || header.includes('進捗') || header.includes('状態')
  );

  return parsedTable.bodyRows.map((row) => {
    const assigneeRaw =
      stripInlineMarkdown(row[assigneeIndex >= 0 ? assigneeIndex : 0] ?? '全隊') || '全隊';
    const assignee = normalizeInProgressAssignee(assigneeRaw);
    const assigneeId = toAssigneeId(assignee) ?? toAssigneeId(assigneeRaw);
    const taskHint =
      assigneeId !== null ? (options?.taskHintsByAssignee?.[assigneeId] ?? null) : null;
    const missionPrimary =
      stripInlineMarkdown(row[missionIndex >= 0 ? missionIndex : 1] ?? '—') || '—';
    const missionFile = fileIndex >= 0 ? stripInlineMarkdown(row[fileIndex] ?? '') : '';
    const mission = resolveInProgressMissionLabel(missionPrimary, missionFile, taskHint);
    const status = resolveInProgressStatusLabel(
      statusIndex >= 0 ? stripInlineMarkdown(row[statusIndex] ?? '') : ''
    );

    return {
      assignee,
      mission,
      status,
    };
  });
};

export const parseInProgressGroups = (
  lines: ParsedLine[],
  options?: ParseInProgressOptions
): InProgressTableGroup[] => {
  const groups: InProgressTableGroup[] = [];
  let currentGroup: InProgressTableGroup | null = null;
  let currentGroupHasTableRows = false;
  let currentStructuredDraft: InProgressStructuredDraft | null = null;
  let index = 0;

  const flushStructuredDraft = (): void => {
    if (
      currentGroup === null ||
      currentStructuredDraft === null ||
      !currentStructuredDraft.sawKnownLabel
    ) {
      currentStructuredDraft = null;
      return;
    }

    const summaryParts = splitInProgressSummary(currentGroup.summary);
    const assigneeRaw = currentStructuredDraft.assignee ?? '全隊';
    const assignee = normalizeInProgressAssignee(assigneeRaw);
    const assigneeId = toAssigneeId(assignee) ?? toAssigneeId(assigneeRaw);
    const taskHint =
      assigneeId !== null ? (options?.taskHintsByAssignee?.[assigneeId] ?? null) : null;

    currentGroup.rows.push({
      assignee,
      mission: resolveInProgressMissionLabel(
        currentStructuredDraft.mission ?? summaryParts.mission,
        '',
        taskHint
      ),
      status: resolveInProgressStatusLabel(
        currentStructuredDraft.status ?? summaryParts.status ?? '進行中'
      ),
    });

    currentStructuredDraft = null;
  };

  const beginGroup = (cmdId: string, summary: string): InProgressTableGroup => {
    flushStructuredDraft();
    const nextGroup: InProgressTableGroup = {
      cmdId,
      summary,
      rows: [],
    };
    currentGroup = nextGroup;
    currentGroupHasTableRows = false;
    currentStructuredDraft = null;
    groups.push(nextGroup);
    return nextGroup;
  };

  while (index < lines.length) {
    const line = lines[index];

    if (line.kind === 'h3' || line.kind === 'h4') {
      const headingText = stripInlineMarkdown(line.text).trim();
      const cmdMatch = headingText.match(inProgressCmdPattern);
      const fallbackCmdId = `cmd_${groups.length + 1}`;
      beginGroup(
        cmdMatch?.[1] ?? fallbackCmdId,
        (cmdMatch?.[2]?.trim() ?? headingText) || '進行中'
      );
      index += 1;
      continue;
    }

    if (line.kind === 'table') {
      flushStructuredDraft();
      const tableLines: ParsedLine[] = [];
      while (index < lines.length && lines[index].kind === 'table') {
        tableLines.push(lines[index]);
        index += 1;
      }

      const rows = parseInProgressRowsFromTable(tableLines, options);
      if (rows.length > 0) {
        const activeGroup = currentGroup ?? beginGroup(`cmd_${groups.length + 1}`, '進行中');
        activeGroup.rows.push(...rows);
        currentGroupHasTableRows = true;
      }
      continue;
    }

    if (line.kind !== 'bullet' && line.kind !== 'text') {
      index += 1;
      continue;
    }

    const text = stripInlineMarkdown(line.text).trim();
    if (text.length < 1 || isPlaceholderText(text)) {
      index += 1;
      continue;
    }

    const cmdMatch = text.match(inProgressCmdPattern);
    if (cmdMatch) {
      beginGroup(cmdMatch[1], cmdMatch[2].trim());
      index += 1;
      continue;
    }

    if (currentGroupHasTableRows) {
      currentStructuredDraft = null;
      index += 1;
      continue;
    }

    const structuredMatch = text.match(inProgressAssigneePattern);
    if (structuredMatch) {
      const fieldKind = detectInProgressFieldKind(structuredMatch[1]);
      if (fieldKind !== null) {
        if (
          fieldKind === 'assignee' &&
          currentStructuredDraft !== null &&
          (currentStructuredDraft.assignee !== null ||
            currentStructuredDraft.mission !== null ||
            currentStructuredDraft.status !== null)
        ) {
          flushStructuredDraft();
        }

        const draft =
          currentStructuredDraft ??
          (currentStructuredDraft = {
            assignee: null,
            mission: null,
            status: null,
            sawKnownLabel: false,
          });

        draft.sawKnownLabel = true;
        const fieldValue = structuredMatch[2].trim();

        if (fieldKind === 'assignee') {
          draft.assignee = fieldValue;
        } else if (fieldKind === 'mission') {
          draft.mission = fieldValue;
        } else if (fieldKind === 'status') {
          draft.status = fieldValue;
        }

        index += 1;
        continue;
      }
    }

    if (currentStructuredDraft?.sawKnownLabel) {
      if (currentStructuredDraft.mission === null) {
        currentStructuredDraft.mission = text;
      }
      index += 1;
      continue;
    }

    const activeGroup = currentGroup ?? beginGroup(`cmd_${groups.length + 1}`, '進行中');

    const assigneeMatch = structuredMatch;
    const assignee = normalizeInProgressAssignee(assigneeMatch ? assigneeMatch[1].trim() : '全隊');
    const detail = assigneeMatch ? assigneeMatch[2].trim() : text;
    const parsedDetail = parseInProgressDetail(detail);
    activeGroup.rows.push({
      assignee,
      mission: parsedDetail.mission,
      status: parsedDetail.status,
    });
    index += 1;
  }

  flushStructuredDraft();

  return groups.map((group) => {
    if (group.rows.length > 0) {
      return group;
    }

    return {
      ...group,
      rows: [
        {
          assignee: '—',
          mission: group.summary.length > 0 ? group.summary : '—',
          status: '進行中',
        },
      ],
    };
  });
};

const normalizeAlertIssueHeading = (headingText: string, index: number): string => {
  const fallbackPrefix = `件${index + 1}: `;
  const plain = stripInlineMarkdown(headingText).trim();

  if (plain.length < 1) {
    return `${fallbackPrefix}要確認`;
  }

  const normalizedFromItem = plain.replace(/^件\s*(\d+)\s*[.．:：]?\s*/u, '件$1: ').trim();
  if (/^件\d+:\s*\S+/u.test(normalizedFromItem)) {
    return normalizedFromItem;
  }

  const numbered = plain.match(/^(\d+)\s*[.)．:：、-]?\s*(.+)$/u);
  if (numbered) {
    return `件${numbered[1]}: ${numbered[2].trim()}`;
  }

  return `${fallbackPrefix}${plain}`;
};

const parseAlertIssueItemsUncached = (lines: ParsedLine[]): AlertIssueItem[] => {
  const issues: AlertIssueItem[] = [];
  let inAlertSection = false;
  let currentIssue: AlertIssueItem | null = null;

  const pushCurrentIssue = (): void => {
    if (!currentIssue) {
      return;
    }

    const isPlaceholderHeading = isPlaceholderIssueHeading(currentIssue.heading);
    const hasDetail = currentIssue.detailLines.some((line) => {
      if (line.kind === 'empty') {
        return false;
      }
      return !isPlaceholderText(line.text);
    });
    if (isPlaceholderHeading && !hasDetail) {
      currentIssue = null;
      return;
    }
    if (isPlaceholderHeading) {
      currentIssue.heading = `件${issues.length + 1}: 要確認`;
    }

    if (!hasDetail) {
      currentIssue.detailLines = [
        {
          kind: 'text',
          text: '詳細を確認されよ。',
          alert: true,
        },
      ];
    }

    issues.push(currentIssue);
    currentIssue = null;
  };

  for (const line of lines) {
    if (line.kind === 'h2') {
      const isAlert = isAlertHeading(line);
      if (inAlertSection && !isAlert) {
        break;
      }
      inAlertSection = isAlert;
      continue;
    }

    if (!inAlertSection) {
      continue;
    }

    if (line.kind === 'h3') {
      pushCurrentIssue();
      currentIssue = {
        key: `alert-issue-${issues.length}`,
        heading: normalizeAlertIssueHeading(line.text, issues.length),
        detailLines: [],
      };
      continue;
    }

    if (line.kind === 'h1' || line.kind === 'timestamp') {
      continue;
    }

    if (line.kind === 'empty') {
      if (currentIssue && currentIssue.detailLines.length > 0) {
        currentIssue.detailLines.push(line);
      }
      continue;
    }

    if (!currentIssue) {
      if ((line.kind === 'text' || line.kind === 'bullet') && isPlaceholderText(line.text)) {
        continue;
      }

      const fallbackHeading = line.kind === 'text' || line.kind === 'bullet' ? line.text : '要確認';
      currentIssue = {
        key: `alert-issue-${issues.length}`,
        heading: normalizeAlertIssueHeading(fallbackHeading, issues.length),
        detailLines: [],
      };
      if (line.kind !== 'text' && line.kind !== 'bullet') {
        currentIssue.detailLines.push(line);
      }
      continue;
    }

    currentIssue.detailLines.push(line);
  }

  pushCurrentIssue();

  return issues.filter((issue) => !isPlaceholderIssueHeading(issue.heading));
};

const parseDashboardLinesUncached = (content: string): ParsedLine[] => {
  const lines = content.split(/\r?\n/);
  const parsed: ParsedLine[] = [];
  let inAlertSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('#### ')) {
      parsed.push({ kind: 'h4', text: trimmed.slice(5), alert: inAlertSection });
      continue;
    }

    if (trimmed.startsWith('### ')) {
      parsed.push({ kind: 'h3', text: trimmed.slice(4), alert: inAlertSection });
      continue;
    }

    if (trimmed.startsWith('## ')) {
      inAlertSection = trimmed.includes('要対応');
      parsed.push({ kind: 'h2', text: trimmed.slice(3), alert: inAlertSection });
      continue;
    }

    if (trimmed.startsWith('# ')) {
      inAlertSection = false;
      parsed.push({ kind: 'h1', text: trimmed.slice(2), alert: false });
      continue;
    }

    if (trimmed.length === 0) {
      parsed.push({ kind: 'empty', text: '', alert: inAlertSection });
      continue;
    }

    if (trimmed.startsWith('最終更新:')) {
      parsed.push({ kind: 'timestamp', text: trimmed, alert: inAlertSection });
      continue;
    }

    if (trimmed.startsWith('- ')) {
      parsed.push({ kind: 'bullet', text: trimmed.slice(2), alert: inAlertSection });
      continue;
    }

    if (trimmed.startsWith('|')) {
      parsed.push({ kind: 'table', text: trimmed, alert: inAlertSection });
      continue;
    }

    parsed.push({ kind: 'text', text: trimmed, alert: inAlertSection });
  }

  return parsed;
};

export const parseAlertIssueItems = (lines: ParsedLine[]): AlertIssueItem[] => {
  if (latestDashboardSnapshot !== null && latestDashboardSnapshot.parsedLines === lines) {
    return latestDashboardSnapshot.alertIssueItems;
  }

  const cached = alertIssueCacheByLines.get(lines);
  if (cached !== undefined) {
    return cached;
  }

  const parsedItems = parseAlertIssueItemsUncached(lines);
  alertIssueCacheByLines.set(lines, parsedItems);
  return parsedItems;
};

export const parseDashboardLines = (content: string): ParsedLine[] => {
  if (latestDashboardSnapshot !== null && latestDashboardSnapshot.content === content) {
    return latestDashboardSnapshot.parsedLines;
  }

  const parsedLines = parseDashboardLinesUncached(content);
  const alertIssueItems = parseAlertIssueItemsUncached(parsedLines);

  alertIssueCacheByLines.set(parsedLines, alertIssueItems);
  latestDashboardSnapshot = {
    content,
    parsedLines,
    alertIssueItems,
  };

  return parsedLines;
};

export const removeHiddenSections = (lines: ParsedLine[]): ParsedLine[] => {
  const filteredLines: ParsedLine[] = [];
  let cursor = 0;

  while (cursor < lines.length) {
    const current = lines[cursor];

    if (shouldHideSectionHeading(current)) {
      cursor += 1;

      while (cursor < lines.length) {
        const line = lines[cursor];
        if (line.kind === 'h1' || line.kind === 'h2') {
          break;
        }
        cursor += 1;
      }
      continue;
    }

    filteredLines.push(current);
    cursor += 1;
  }

  return filteredLines;
};

export const normalizeSectionHeadingText = (headingText: string): string => {
  const trimmed = headingText.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  const withoutLegacyInProgressSubtitle = trimmed
    .replace(/\s*-\s*只今、?戦闘中でござる(?:\s*\(In Progress - Currently in Battle\))?/u, '')
    .trim();
  const mainSectionText =
    withoutLegacyInProgressSubtitle.split(/\s+[-–—]\s+/)[0]?.trim() ??
    withoutLegacyInProgressSubtitle;
  const withoutLeadingDecorations = mainSectionText
    .replace(/^[^0-9A-Za-z\u3040-\u30FF\u3400-\u9FFF]+/, '')
    .trim();
  const normalizedHeading =
    withoutLeadingDecorations.length > 0 ? withoutLeadingDecorations : mainSectionText;

  return normalizeDashboardDisplayText(normalizedHeading, { fallbackWhenIdOnly: '任務進行中' });
};
