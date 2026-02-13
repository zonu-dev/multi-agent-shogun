import { Fragment, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTaskStore, type TaskStoreState } from '@/store/taskStore';
import { shallow } from 'zustand/shallow';

import {
  extractInProgressAssigneeIds,
  isDailyResultsHeading,
  isInProgressHeading,
  normalizeSectionHeadingText,
  parseInProgressGroups,
  parseMarkdownTable,
  sanitizeAccordionLinesForDisplay,
  stripInlineMarkdown as stripInlineMarkdownFromParser,
} from './parsers';
import type {
  AccordionSegment,
  InProgressTableGroup,
  InProgressTaskHint,
  ParsedLine,
  RenderSegment,
} from './parsers';

const inlineTokenPattern = /\*\*(.+?)\*\*|`([^`]+)`|~~(.+?)~~/g;
const DASHBOARD_ACCORDION_STORAGE_PREFIX = 'dashboard_accordion_';

export const TOP_LEVEL_ACCORDION_BUTTON_CLASS =
  'flex w-full items-center gap-2 rounded border border-[color:var(--kincha)]/25 bg-[color:var(--kincha)]/10 px-2 py-1 text-left text-sm font-semibold text-[color:var(--kincha)] transition-colors hover:bg-[color:var(--kincha)]/16';
export const ALERT_TOP_LEVEL_ACCORDION_BUTTON_CLASS =
  'flex w-full items-center gap-2 rounded border border-rose-400/45 bg-rose-500/25 px-2 py-1 text-left text-sm font-semibold text-rose-100 transition-colors hover:bg-rose-500/30';
export const TOP_LEVEL_ACCORDION_ICON_CLASS = 'w-3 text-[10px]';
export const ALERT_TOP_LEVEL_ACCORDION_PANEL_CLASS =
  'space-y-1 border-t border-rose-300/35 bg-rose-500/10 px-2 pt-1 pb-2';

const normalizeAccordionSectionName = (headingText: string): string => {
  const baseText = headingText
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/[（(]\s*\d+\s*件\s*[)）]/g, '')
    .replace(/\s*-\s*只今、?戦闘中でござる(?:\s*\(In Progress - Currently in Battle\))?/u, '')
    .trim();
  const withoutDecorations = baseText
    .replace(/^[^0-9A-Za-z\u3040-\u30FF\u3400-\u9FFF]+/, '')
    .trim();
  const canonical = withoutDecorations.length > 0 ? withoutDecorations : baseText;

  if (canonical.includes('要対応')) {
    return '要対応';
  }
  if (canonical.includes('進行中')) {
    return '進行中';
  }
  if (canonical.includes('本日の戦果')) {
    return '本日の戦果';
  }
  if (canonical.includes('過去の軍令')) {
    return '過去の軍令';
  }

  return canonical;
};

const sanitizeAccordionSectionName = (headingText: string): string => {
  const normalized = headingText.trim().toLowerCase();
  if (normalized.length === 0) {
    return 'section';
  }

  const sanitized = normalized
    .replace(/\s+/g, '_')
    .replace(/[^0-9a-z_\u3040-\u30ff\u3400-\u9fffー-]/g, '');
  const trimmed = sanitized.replace(/^_+|_+$/g, '');

  return trimmed.length > 0 ? trimmed : 'section';
};

const getAccordionStorageKey = (headingText: string): string => {
  const normalizedSectionName = normalizeAccordionSectionName(headingText);
  return `${DASHBOARD_ACCORDION_STORAGE_PREFIX}${sanitizeAccordionSectionName(normalizedSectionName)}`;
};

export const readAccordionStateFromStorage = (headingText: string): boolean | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    const value = window.localStorage.getItem(getAccordionStorageKey(headingText));
    if (value === 'open') {
      return true;
    }
    if (value === 'closed') {
      return false;
    }
  } catch {
    // Ignore localStorage read errors.
  }

  return undefined;
};

export const writeAccordionStateToStorage = (headingText: string, isOpen: boolean): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(getAccordionStorageKey(headingText), isOpen ? 'open' : 'closed');
  } catch {
    // Ignore localStorage write errors.
  }
};

const convertUiTermsForDisplay = (text: string): string => {
  return text
    .replace(/(\d+)\s*G\b/g, '$1両')
    .replace(/(\d+)\s*XP\b/gi, '$1修練値')
    .replace(/\bXP\b/gi, '修練値')
    .replace(/(\d+)\s*EP\b/gi, '$1修練値')
    .replace(/\bEP\b/gi, '修練値')
    .replace(/経験値/g, '修練値')
    .replace(/Lv\.\s*/g, '格')
    .replace(/\bLevel\b/gi, '格')
    .replace(/\bGold\b/gi, '小判')
    .replace(/ゴールド/g, '小判')
    .replace(/\buncommon\b/gi, '珍')
    .replace(/\bcommon\b/gi, '並')
    .replace(/\blegendary\b/gi, '伝説')
    .replace(/\bepic\b/gi, '極')
    .replace(/\brare\b/gi, '稀');
};

export const renderInlineMarkdown = (text: string): ReactNode => {
  const matches = [...text.matchAll(inlineTokenPattern)];

  if (matches.length === 0) {
    return convertUiTermsForDisplay(text);
  }

  const rendered: ReactNode[] = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    const start = match.index ?? 0;
    const full = match[0];
    const boldText = match[1];
    const codeText = match[2];
    const strikeText = match[3];

    if (start > cursor) {
      rendered.push(
        <Fragment key={`text-${index}-${cursor}`}>
          {convertUiTermsForDisplay(text.slice(cursor, start))}
        </Fragment>
      );
    }

    if (boldText !== undefined) {
      rendered.push(
        <strong key={`bold-${index}`} className="font-semibold">
          {convertUiTermsForDisplay(boldText)}
        </strong>
      );
    } else if (codeText !== undefined) {
      rendered.push(
        <code
          key={`code-${index}`}
          className="rounded bg-black/35 px-1 py-[1px] font-mono text-[0.95em] text-amber-100"
        >
          {codeText}
        </code>
      );
    } else if (strikeText !== undefined) {
      rendered.push(
        <del key={`strike-${index}`}>{convertUiTermsForDisplay(strikeText)}</del>
      );
    }

    cursor = start + full.length;
  });

  if (cursor < text.length) {
    rendered.push(
      <Fragment key={`tail-${cursor}`}>{convertUiTermsForDisplay(text.slice(cursor))}</Fragment>
    );
  }

  return rendered;
};

export const stripInlineMarkdown = stripInlineMarkdownFromParser;

export const renderParsedLineBlock = (lines: ParsedLine[], keyPrefix: string): ReactNode[] => {
  return lines.map((line, index) => {
    const key = `${keyPrefix}-${index}`;

    if (line.kind === 'empty') {
      return <div key={`empty-${key}`} className="h-2" />;
    }

    if (line.kind === 'h1') {
      const nextLine = lines[index + 1];
      const timestampText = nextLine?.kind === 'timestamp' ? nextLine.text : null;

      return (
        <div key={`h1-${key}`} className="flex items-end justify-between gap-2">
          <h3
            className="text-base font-bold text-[color:var(--kincha)]"
            style={{ fontFamily: '"Noto Serif JP", serif' }}
          >
            {renderInlineMarkdown(line.text)}
          </h3>
          {timestampText ? (
            <p className="text-[11px] text-slate-400">{renderInlineMarkdown(timestampText)}</p>
          ) : null}
        </div>
      );
    }

    if (line.kind === 'timestamp') {
      const prev = lines[index - 1];
      if (prev?.kind === 'h1') {
        return null;
      }

      return (
        <p key={`timestamp-${key}`} className="text-[11px] text-slate-400">
          {renderInlineMarkdown(line.text)}
        </p>
      );
    }

    if (line.kind === 'h2') {
      const headingText = normalizeSectionHeadingText(line.text);

      return (
        <h4
          key={`h2-${key}`}
          className={[
            'mt-1 rounded px-2 py-1 text-sm font-semibold',
            line.alert
              ? 'border border-rose-400/45 bg-rose-500/25 text-rose-100'
              : 'border border-[color:var(--kincha)]/25 bg-[color:var(--kincha)]/10 text-[color:var(--kincha)]',
          ].join(' ')}
          style={{ fontFamily: '"Noto Serif JP", serif' }}
        >
          {renderInlineMarkdown(headingText)}
        </h4>
      );
    }

    if (line.kind === 'h3') {
      return (
        <h5
          key={`h3-${key}`}
          className={[
            'px-1 text-xs font-semibold',
            line.alert ? 'text-rose-200' : 'text-[color:var(--kincha)]/90',
          ].join(' ')}
          style={{ fontFamily: '"Noto Serif JP", serif' }}
        >
          {renderInlineMarkdown(line.text)}
        </h5>
      );
    }

    if (line.kind === 'h4') {
      return (
        <h6
          key={`h4-${key}`}
          className={[
            'px-1 text-[11px] font-semibold',
            line.alert ? 'text-rose-100' : 'text-[color:var(--kincha)]/80',
          ].join(' ')}
          style={{ fontFamily: '"Noto Serif JP", serif' }}
        >
          {renderInlineMarkdown(line.text)}
        </h6>
      );
    }

    if (line.kind === 'table') {
      if (index > 0) {
        const prev = lines[index - 1];
        if (prev.kind === 'table' && prev.alert === line.alert) {
          return null;
        }
      }

      const tableLines: ParsedLine[] = [];
      let cursor = index;
      while (cursor < lines.length) {
        const current = lines[cursor];
        if (current.kind !== 'table' || current.alert !== line.alert) {
          break;
        }
        tableLines.push(current);
        cursor += 1;
      }

      const parsedTable = parseMarkdownTable(tableLines);
      if (parsedTable === null) {
        return null;
      }

      const { headerRow, bodyRows } = parsedTable;

      return (
        <div
          key={`table-${key}`}
          className="overflow-x-auto rounded border border-[color:var(--kincha)]/25"
        >
          <table className="min-w-full border-collapse text-xs">
            <thead
              className={
                line.alert
                  ? 'bg-rose-500/30 text-rose-50'
                  : 'bg-[color:var(--kincha)]/22 text-[color:var(--kincha)]'
              }
            >
              <tr>
                {headerRow.map((cell, cellIndex) => (
                  <th
                    key={`th-${key}-${cellIndex}`}
                    className="border border-[color:var(--kincha)]/30 px-2 py-1 text-left font-semibold"
                  >
                    {renderInlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.length > 0 ? (
                bodyRows.map((row, rowIndex) => (
                  <tr
                    key={`tr-${key}-${rowIndex}`}
                    className={
                      line.alert
                        ? rowIndex % 2 === 0
                          ? 'bg-rose-500/12 text-rose-50'
                          : 'bg-rose-500/6 text-rose-100'
                        : rowIndex % 2 === 0
                          ? 'bg-white/5 text-slate-100'
                          : 'bg-black/10 text-slate-200'
                    }
                  >
                    {headerRow.map((_, cellIndex) => (
                      <td
                        key={`td-${key}-${rowIndex}-${cellIndex}`}
                        className="border border-[color:var(--kincha)]/20 px-2 py-1 align-top"
                      >
                        {renderInlineMarkdown(row[cellIndex] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr
                  className={
                    line.alert ? 'bg-rose-500/10 text-rose-100' : 'bg-white/5 text-slate-200'
                  }
                >
                  {headerRow.map((cell, cellIndex) => (
                    <td
                      key={`single-${key}-${cellIndex}`}
                      className="border border-[color:var(--kincha)]/20 px-2 py-1 align-top"
                    >
                      {renderInlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }

    if (line.kind === 'bullet') {
      return (
        <p key={`bullet-${key}`} className={line.alert ? 'text-rose-100' : 'text-slate-100'}>
          ・{renderInlineMarkdown(line.text)}
        </p>
      );
    }

    return (
      <p
        key={`text-${key}`}
        className={[
          'rounded px-2 py-1',
          line.alert ? 'bg-rose-500/15 text-rose-50' : 'text-slate-200',
        ].join(' ')}
      >
        {renderInlineMarkdown(line.text)}
      </p>
    );
  });
};

interface AccordionSectionProps {
  segment: AccordionSegment;
  isOpen: boolean;
  openSections: Record<number, boolean>;
  onToggle: (segment: AccordionSegment) => void;
  nestedSegments?: RenderSegment[];
}

const renderInProgressTable = (groups: InProgressTableGroup[], keyPrefix: string): ReactNode => {
  if (groups.length < 1) {
    return (
      <p className="rounded border border-dashed border-slate-500/35 px-3 py-2 text-xs text-slate-300">
        進行中の任務は見当たらぬ。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group, groupIndex) => (
        <section key={`${keyPrefix}-group-${group.cmdId}-${groupIndex}`} className="space-y-1">
          <h5
            className="px-1 text-xs font-semibold text-[color:var(--kincha)]"
            style={{ fontFamily: '"Noto Serif JP", serif' }}
          >
            {renderInlineMarkdown(`${group.cmdId} ${group.summary}`.trim())}
          </h5>
          <div className="overflow-x-auto rounded border border-[color:var(--kincha)]/25">
            <table className="min-w-full border-collapse text-xs">
              <thead className="bg-[color:var(--kincha)]/22 text-[color:var(--kincha)]">
                <tr>
                  <th className="w-[20%] border border-[color:var(--kincha)]/30 px-2 py-1 text-left font-semibold">
                    担当
                  </th>
                  <th className="w-[46%] border border-[color:var(--kincha)]/30 px-2 py-1 text-left font-semibold">
                    任務
                  </th>
                  <th className="w-[34%] border border-[color:var(--kincha)]/30 px-2 py-1 text-left font-semibold">
                    ステータス
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row, rowIndex) => (
                  <tr
                    key={`${keyPrefix}-row-${group.cmdId}-${groupIndex}-${rowIndex}`}
                    className={
                      rowIndex % 2 === 0
                        ? 'bg-white/5 text-slate-100'
                        : 'bg-black/10 text-slate-200'
                    }
                  >
                    <td className="border border-[color:var(--kincha)]/20 px-2 py-1 align-top">
                      {renderInlineMarkdown(row.assignee)}
                    </td>
                    <td className="border border-[color:var(--kincha)]/20 px-2 py-1 align-top">
                      {renderInlineMarkdown(row.mission)}
                    </td>
                    <td className="border border-[color:var(--kincha)]/20 px-2 py-1 align-top">
                      {renderInlineMarkdown(row.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
};

const collectTaskHintAssigneeIds = (
  lines: ParsedLine[],
  nestedSegments: RenderSegment[] | undefined,
  includeNestedSegments: boolean
): string[] => {
  const assigneeIds = new Set<string>(extractInProgressAssigneeIds(lines));

  if (!includeNestedSegments || !nestedSegments) {
    return Array.from(assigneeIds).sort();
  }

  nestedSegments.forEach((nestedSegment) => {
    if (nestedSegment.type !== 'accordion') {
      return;
    }

    const nestedIsInProgressAccordion =
      isInProgressHeading(nestedSegment.heading) ||
      (nestedSegment.heading.kind === 'h3' && nestedSegment.heading.text.includes('進行中'));
    if (!nestedIsInProgressAccordion) {
      return;
    }

    const nestedAccordionContentLines = sanitizeAccordionLinesForDisplay(
      nestedSegment.heading,
      nestedSegment.lines
    );
    extractInProgressAssigneeIds(nestedAccordionContentLines).forEach((assigneeId) =>
      assigneeIds.add(assigneeId)
    );
  });

  return Array.from(assigneeIds).sort();
};

export const AccordionSection = ({
  segment,
  isOpen,
  openSections,
  onToggle,
  nestedSegments,
}: AccordionSectionProps) => {
  const isDailyResultsAccordion =
    segment.heading.kind === 'h2' && isDailyResultsHeading(segment.heading);
  const isInProgressAccordion =
    segment.heading.kind === 'h2' && isInProgressHeading(segment.heading);
  const useCompactContentSpacing = isInProgressAccordion || isDailyResultsAccordion;
  const accordionContentLines = sanitizeAccordionLinesForDisplay(segment.heading, segment.lines);
  const taskHintAssigneeIds = useMemo(
    () =>
      collectTaskHintAssigneeIds(
        accordionContentLines,
        nestedSegments,
        isDailyResultsAccordion && !isInProgressAccordion
      ),
    [accordionContentLines, isDailyResultsAccordion, isInProgressAccordion, nestedSegments]
  );
  const selectTaskHintsByAssignee = useMemo(
    () =>
      (state: TaskStoreState): Record<string, InProgressTaskHint | null> => {
        const selected: Record<string, InProgressTaskHint | null> = {};
        taskHintAssigneeIds.forEach((assigneeId) => {
          selected[assigneeId] = state.tasks[assigneeId] ?? null;
        });
        return selected;
      },
    [taskHintAssigneeIds]
  );
  const taskHintsByAssignee = useTaskStore(selectTaskHintsByAssignee, shallow);
  const inProgressGroups = useMemo<InProgressTableGroup[]>(
    () =>
      isInProgressAccordion
        ? parseInProgressGroups(accordionContentLines, { taskHintsByAssignee })
        : [],
    [accordionContentLines, isInProgressAccordion, taskHintsByAssignee]
  );
  const nestedInProgressGroupsByStartIndex = useMemo<Record<number, InProgressTableGroup[]>>(() => {
    if (!isDailyResultsAccordion || !nestedSegments) {
      return {};
    }

    const groupsByStartIndex: Record<number, InProgressTableGroup[]> = {};
    nestedSegments.forEach((nestedSegment) => {
      if (nestedSegment.type !== 'accordion') {
        return;
      }

      const nestedIsInProgressAccordion =
        isInProgressHeading(nestedSegment.heading) ||
        (nestedSegment.heading.kind === 'h3' && nestedSegment.heading.text.includes('進行中'));
      if (!nestedIsInProgressAccordion) {
        return;
      }

      const nestedAccordionContentLines = sanitizeAccordionLinesForDisplay(
        nestedSegment.heading,
        nestedSegment.lines
      );
      groupsByStartIndex[nestedSegment.startIndex] = parseInProgressGroups(
        nestedAccordionContentLines,
        { taskHintsByAssignee }
      );
    });

    return groupsByStartIndex;
  }, [isDailyResultsAccordion, nestedSegments, taskHintsByAssignee]);
  const headingText =
    segment.heading.kind === 'h2'
      ? normalizeSectionHeadingText(segment.heading.text)
      : segment.heading.text;
  const inProgressGroupCount = isInProgressAccordion ? inProgressGroups.length : 0;
  const displayItemCount = isInProgressAccordion ? inProgressGroupCount : segment.itemCount;
  const shouldShowItemCount = segment.heading.kind === 'h2' || displayItemCount > 0;
  const isTopLevelAccordion = segment.heading.kind === 'h2';
  const titleText = shouldShowItemCount ? `${headingText} (${displayItemCount}件)` : headingText;
  const accordionPanelId = `accordion-panel-${segment.startIndex}`;

  return (
    <section
      key={`accordion-${segment.startIndex}`}
      className="rounded border border-[color:var(--kincha)]/20 bg-black/10"
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={accordionPanelId}
        onClick={() => onToggle(segment)}
        className={[
          isTopLevelAccordion
            ? TOP_LEVEL_ACCORDION_BUTTON_CLASS
            : 'flex w-full items-center gap-2 px-2 py-1 text-left text-xs font-semibold text-[color:var(--kincha)] transition-colors hover:bg-[color:var(--kincha)]/10',
        ].join(' ')}
        style={{ fontFamily: '"Noto Serif JP", serif' }}
      >
        <span
          className={isTopLevelAccordion ? TOP_LEVEL_ACCORDION_ICON_CLASS : 'w-3 text-[10px]'}
          aria-hidden
        >
          {isOpen ? '▼' : '▶'}
        </span>
        <span>{renderInlineMarkdown(titleText)}</span>
      </button>
      {isOpen ? (
        <div
          id={accordionPanelId}
          className={[
            'space-y-1 border-t border-[color:var(--kincha)]/15 px-2',
            useCompactContentSpacing ? 'pt-0 pb-2' : 'py-2',
          ].join(' ')}
        >
          {isDailyResultsAccordion
            ? nestedSegments?.map((nestedSegment) => {
                if (nestedSegment.type === 'block') {
                  return (
                    <Fragment key={`nested-block-${nestedSegment.startIndex}`}>
                      {renderParsedLineBlock(
                        nestedSegment.lines,
                        `nested-block-${nestedSegment.startIndex}`
                      )}
                    </Fragment>
                  );
                }

                const nestedIsOpen = Boolean(openSections[nestedSegment.startIndex]);
                const nestedAccordionContentLines = sanitizeAccordionLinesForDisplay(
                  nestedSegment.heading,
                  nestedSegment.lines
                );
                const nestedHeadingText =
                  nestedSegment.heading.kind === 'h2'
                    ? normalizeSectionHeadingText(nestedSegment.heading.text)
                    : nestedSegment.heading.text;
                const nestedTitleText =
                  nestedSegment.itemCount > 0
                    ? `${nestedHeadingText} (${nestedSegment.itemCount}件)`
                    : nestedHeadingText;
                const nestedIsInProgressAccordion =
                  isInProgressHeading(nestedSegment.heading) ||
                  (nestedSegment.heading.kind === 'h3' &&
                    nestedSegment.heading.text.includes('進行中'));
                const nestedAccordionPanelId = `nested-accordion-panel-${nestedSegment.startIndex}`;

                return (
                  <section
                    key={`nested-accordion-${nestedSegment.startIndex}`}
                    className="rounded border border-[color:var(--kincha)]/20 bg-black/10"
                  >
                    <button
                      type="button"
                      aria-expanded={nestedIsOpen}
                      aria-controls={nestedAccordionPanelId}
                      onClick={() => onToggle(nestedSegment)}
                      className={[
                        'flex w-full items-center gap-2 px-2 py-1 text-left text-xs font-semibold transition-colors',
                        nestedSegment.heading.alert
                          ? 'text-rose-100 hover:bg-rose-500/15'
                          : 'text-[color:var(--kincha)] hover:bg-[color:var(--kincha)]/10',
                      ].join(' ')}
                      style={{ fontFamily: '"Noto Serif JP", serif' }}
                    >
                      <span className="w-3 text-[10px]" aria-hidden>
                        {nestedIsOpen ? '▼' : '▶'}
                      </span>
                      <span>{renderInlineMarkdown(nestedTitleText)}</span>
                    </button>
                    {nestedIsOpen ? (
                      <div
                        id={nestedAccordionPanelId}
                        className="space-y-1 border-t border-[color:var(--kincha)]/15 px-2 py-2"
                      >
                        {nestedIsInProgressAccordion
                          ? renderInProgressTable(
                              nestedInProgressGroupsByStartIndex[nestedSegment.startIndex] ?? [],
                              `nested-in-progress-${nestedSegment.startIndex}`
                            )
                          : renderParsedLineBlock(
                              nestedAccordionContentLines,
                              `nested-accordion-${nestedSegment.startIndex}`
                            )}
                      </div>
                    ) : null}
                  </section>
                );
              })
            : isInProgressAccordion
              ? renderInProgressTable(inProgressGroups, `in-progress-${segment.startIndex}`)
              : renderParsedLineBlock(accordionContentLines, `accordion-${segment.startIndex}`)}
        </div>
      ) : null}
    </section>
  );
};
