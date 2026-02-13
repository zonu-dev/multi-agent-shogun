import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

import { useDashboardStore } from '@/store/dashboardStore';
import { useTaskStore } from '@/store/taskStore';

import {
  AccordionSection,
  TOP_LEVEL_ACCORDION_BUTTON_CLASS,
  TOP_LEVEL_ACCORDION_ICON_CLASS,
  readAccordionStateFromStorage,
  renderInlineMarkdown,
  renderParsedLineBlock,
  stripInlineMarkdown,
  writeAccordionStateToStorage,
} from './dashboard/AccordionSection';
import { AlertSection } from './dashboard/AlertSection';
import {
  buildSegments,
  normalizeDashboardDisplayText,
  normalizeSectionHeadingText,
  isAshigaruPlacementHeading,
  isAlertHeading,
  isInProgressHeading,
  parseAlertIssueItems,
  parseDashboardLines,
  parseInProgressGroups,
  parseMarkdownTable,
  removeHiddenSections,
} from './dashboard/parsers';
import type {
  AccordionSegment,
  InProgressTableGroup,
  ParsedLine,
  RenderSegment,
} from './dashboard/parsers';
import { formatArchiveCompletedAt, useArchive } from './dashboard/useArchive';
import DailyRecordView from './DailyRecordView';

const TABLE_SEPARATOR_CELL = '---';

const isFallbackInProgressRow = (
  row: InProgressTableGroup['rows'][number],
  groupSummary: string
): boolean => {
  return row.assignee === '—' && row.status === '進行中' && row.mission === groupSummary;
};

const countInProgressItems = (groups: InProgressTableGroup[]): number => {
  return groups.reduce((total, group) => {
    const visibleRows = group.rows.filter((row) => !isFallbackInProgressRow(row, group.summary));
    return total + visibleRows.length;
  }, 0);
};

const toMarkdownTableLine = (cells: string[]): string => {
  const normalizedCells = cells.map((cell) => (cell.trim().length > 0 ? cell : ' '));
  return `| ${normalizedCells.join(' | ')} |`;
};

const normalizeDashboardTableLinesForDisplay = (lines: ParsedLine[]): ParsedLine[] => {
  const parsedTable = parseMarkdownTable(lines);
  if (parsedTable === null) {
    return lines;
  }

  let headerRow = parsedTable.headerRow.map((cell) =>
    normalizeDashboardDisplayText(cell, { fallbackWhenIdOnly: '任務' })
  );
  let bodyRows = parsedTable.bodyRows.map((row) =>
    row.map((cell) => normalizeDashboardDisplayText(cell, { fallbackWhenIdOnly: '任務進行中' }))
  );
  const isPlacementTable =
    headerRow.some((cell) => cell.includes('足軽')) &&
    (headerRow.some((cell) => cell.includes('担当')) || headerRow.some((cell) => cell.includes('状態')));
  let contextColumnIndex = headerRow.findIndex((cell) => cell.includes('文脈残'));

  if (isPlacementTable && contextColumnIndex < 0) {
    headerRow = [...headerRow, '文脈残'];
    contextColumnIndex = headerRow.length - 1;
    bodyRows = bodyRows.map((row) => [...row, '集計待ち']);
  }

  const normalizedBodyRows = bodyRows.map((row) => {
    const nextRow = [...row];
    while (nextRow.length < headerRow.length) {
      nextRow.push('');
    }
    if (isPlacementTable && contextColumnIndex >= 0 && nextRow[contextColumnIndex].trim().length < 1) {
      nextRow[contextColumnIndex] = '集計待ち';
    }
    return nextRow;
  });

  const separatorRow = headerRow.map(() => TABLE_SEPARATOR_CELL);
  const rebuiltLines = [
    toMarkdownTableLine(headerRow),
    toMarkdownTableLine(separatorRow),
    ...normalizedBodyRows.map((row) => toMarkdownTableLine(row)),
  ];

  return rebuiltLines.map((text) => ({
    kind: 'table',
    text,
    alert: lines[0]?.alert ?? false,
  }));
};

const normalizeDashboardLineForDisplay = (line: ParsedLine): ParsedLine => {
  if (line.kind === 'table' || line.kind === 'empty') {
    return line;
  }

  if (line.kind === 'timestamp') {
    return {
      ...line,
      text: normalizeDashboardDisplayText(line.text, { fallbackWhenIdOnly: '最終更新: 集計待ち' }),
    };
  }

  const fallback =
    line.kind === 'h2'
      ? '進行中'
      : line.kind === 'h1'
        ? '戦況報告'
        : line.kind === 'h3' || line.kind === 'h4'
          ? '任務進行中'
          : '集計待ち';

  return {
    ...line,
    text: normalizeDashboardDisplayText(line.text, { fallbackWhenIdOnly: fallback }),
  };
};

const normalizeLinesForDisplay = (lines: ParsedLine[]): ParsedLine[] => {
  const normalized: ParsedLine[] = [];
  let cursor = 0;

  while (cursor < lines.length) {
    const current = lines[cursor];
    if (current.kind !== 'table') {
      normalized.push(normalizeDashboardLineForDisplay(current));
      cursor += 1;
      continue;
    }

    const tableLines: ParsedLine[] = [];
    while (cursor < lines.length && lines[cursor].kind === 'table') {
      tableLines.push(lines[cursor]);
      cursor += 1;
    }
    normalized.push(...normalizeDashboardTableLinesForDisplay(tableLines));
  }

  return normalized;
};

const normalizeSegmentForDisplay = (segment: RenderSegment): RenderSegment => {
  if (segment.type === 'block') {
    return {
      ...segment,
      lines: normalizeLinesForDisplay(segment.lines),
    };
  }

  return {
    ...segment,
    heading: normalizeDashboardLineForDisplay(segment.heading),
    lines: normalizeLinesForDisplay(segment.lines),
  };
};

const renderInProgressGroupTable = (groups: InProgressTableGroup[], keyPrefix: string) => {
  if (groups.length < 1 || countInProgressItems(groups) < 1) {
    return (
      <p className="rounded border border-dashed border-slate-500/35 px-3 py-2 text-xs text-slate-300">
        進行中の任務は見当たらぬ。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group, groupIndex) => {
        const displayRows = group.rows.filter((row) => !isFallbackInProgressRow(row, group.summary));
        if (displayRows.length < 1) {
          return null;
        }

        const headingText = normalizeDashboardDisplayText(group.summary, {
          fallbackWhenIdOnly: '任務進行中',
        });

        return (
          <section key={`${keyPrefix}-group-${group.cmdId}-${groupIndex}`} className="space-y-1">
            <h5
              className="px-1 text-xs font-semibold text-[color:var(--kincha)]"
              style={{ fontFamily: '"Noto Serif JP", serif' }}
            >
              {renderInlineMarkdown(headingText)}
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
                  {displayRows.map((row, rowIndex) => (
                    <tr
                      key={`${keyPrefix}-row-${group.cmdId}-${groupIndex}-${rowIndex}`}
                      className={
                        rowIndex % 2 === 0 ? 'bg-white/5 text-slate-100' : 'bg-black/10 text-slate-200'
                      }
                    >
                      <td className="border border-[color:var(--kincha)]/20 px-2 py-1 align-top">
                        {renderInlineMarkdown(
                          normalizeDashboardDisplayText(row.assignee, {
                            fallbackWhenIdOnly: '全隊',
                          })
                        )}
                      </td>
                      <td className="border border-[color:var(--kincha)]/20 px-2 py-1 align-top">
                        {renderInlineMarkdown(
                          normalizeDashboardDisplayText(row.mission, {
                            fallbackWhenIdOnly: '任務進行中',
                          })
                        )}
                      </td>
                      <td className="border border-[color:var(--kincha)]/20 px-2 py-1 align-top">
                        {renderInlineMarkdown(
                          normalizeDashboardDisplayText(row.status, {
                            fallbackWhenIdOnly: '進行中',
                          })
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
};

const DashboardView = () => {
  const content = useDashboardStore((state) => state.content);
  const hasAlerts = useDashboardStore((state) => state.hasAlerts);
  const visibleAlertCount = useDashboardStore((state) => state.visibleAlertCount);
  const setDashboard = useDashboardStore((state) => state.setDashboard);
  const taskHintsByAssignee = useTaskStore((state) => state.tasks);
  const [alertOpen, setAlertOpen] = useState(true);
  const [openAlertIssues, setOpenAlertIssues] = useState<Record<string, boolean>>({});
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({});
  const [initialFetchLoading, setInitialFetchLoading] = useState(false);
  const [initialFetchError, setInitialFetchError] = useState<string | null>(null);
  const [initialFetchRetryCount, setInitialFetchRetryCount] = useState(0);
  const archivePanelId = 'dashboard-archive-panel';

  const {
    archiveItems,
    archiveCount,
    archivePage,
    archiveLoading,
    archiveError,
    archiveInitialized,
    hasMoreArchiveItems,
    fetchArchiveCommands,
  } = useArchive();

  const retryInitialFetch = useCallback(() => {
    setInitialFetchRetryCount((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (content.trim().length > 0) {
      return;
    }

    let cancelled = false;
    setInitialFetchLoading(true);
    setInitialFetchError(null);

    fetch('/api/state')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`dashboard fetch failed: ${response.status}`);
        }
        return response.json() as Promise<unknown>;
      })
      .then((data: unknown) => {
        if (cancelled) {
          return;
        }

        if (
          typeof data === 'object' &&
          data !== null &&
          'dashboard' in data &&
          typeof (data as Record<string, unknown>).dashboard === 'string'
        ) {
          if (useDashboardStore.getState().content.trim().length > 0) {
            return;
          }

          setDashboard((data as Record<string, unknown>).dashboard as string);
          setInitialFetchError(null);
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setInitialFetchError('戦況報告の取得に失敗した。');
      })
      .finally(() => {
        if (!cancelled) {
          setInitialFetchLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [content, initialFetchRetryCount, setDashboard]);

  useEffect(() => {
    const persistedAlertState = readAccordionStateFromStorage('要対応');
    if (persistedAlertState !== undefined) {
      setAlertOpen(persistedAlertState);
    }

    const persistedArchiveState = readAccordionStateFromStorage('過去の軍令');
    if (persistedArchiveState !== undefined) {
      setArchiveOpen(persistedArchiveState);
    }
  }, []);

  const parsedLines = useMemo(() => parseDashboardLines(content), [content]);
  const alertIssueItems = useMemo(() => parseAlertIssueItems(parsedLines), [parsedLines]);
  const displayAlertIssueItems = useMemo(() => {
    return alertIssueItems.map((issue) => ({
      ...issue,
      heading: normalizeDashboardDisplayText(issue.heading, { fallbackWhenIdOnly: '要確認' }),
      detailLines: normalizeLinesForDisplay(issue.detailLines),
    }));
  }, [alertIssueItems]);
  const topTimestampText = useMemo<string | null>(() => {
    return parsedLines.find((line) => line.kind === 'timestamp')?.text ?? null;
  }, [parsedLines]);
  const contentLines = useMemo<ParsedLine[]>(() => {
    return parsedLines.filter((line, index) => {
      if (line.kind === 'h1') {
        return false;
      }

      if (line.kind === 'timestamp' && parsedLines[index - 1]?.kind === 'h1') {
        return false;
      }

      return true;
    });
  }, [parsedLines]);
  const visibleContentLines = useMemo<ParsedLine[]>(() => {
    return removeHiddenSections(contentLines);
  }, [contentLines]);
  const displayAlertCount = visibleAlertCount > 0 ? visibleAlertCount : displayAlertIssueItems.length;
  const hasVisibleAlerts = hasAlerts || displayAlertIssueItems.length > 0;
  const segments = useMemo<RenderSegment[]>(() => {
    return buildSegments(visibleContentLines, { includeDailyResultsH2: true });
  }, [visibleContentLines]);
  const displaySegments = useMemo<RenderSegment[]>(() => {
    const filtered = segments.filter((segment) => {
      return !(
        segment.type === 'accordion' &&
        segment.heading.kind === 'h2' &&
        isAlertHeading(segment.heading)
      );
    });

    const normalized: RenderSegment[] = [];
    filtered.forEach((segment, index) => {
      if (segment.type !== 'block') {
        normalized.push(segment);
        return;
      }

      if (index !== 0) {
        normalized.push(segment);
        return;
      }

      let firstVisibleLine = 0;
      while (
        firstVisibleLine < segment.lines.length &&
        segment.lines[firstVisibleLine]?.kind === 'empty'
      ) {
        firstVisibleLine += 1;
      }

      const trimmedLines = segment.lines.slice(firstVisibleLine);
      if (trimmedLines.length > 0) {
        normalized.push({
          ...segment,
          lines: trimmedLines,
        });
      }
    });

    return normalized;
  }, [segments]);
  const orderedSegments = useMemo<RenderSegment[]>(() => {
    const placementIndex = displaySegments.findIndex((segment) => {
      return (
        segment.type === 'accordion' &&
        segment.heading.kind === 'h2' &&
        isAshigaruPlacementHeading(segment.heading)
      );
    });
    if (placementIndex < 0) {
      return displaySegments;
    }

    const inProgressIndex = displaySegments.findIndex((segment) => {
      return (
        segment.type === 'accordion' &&
        segment.heading.kind === 'h2' &&
        isInProgressHeading(segment.heading)
      );
    });
    if (inProgressIndex < 0 || placementIndex < inProgressIndex) {
      return displaySegments;
    }

    const reordered = [...displaySegments];
    const [placementSegment] = reordered.splice(placementIndex, 1);
    const targetIndex = reordered.findIndex((segment) => {
      return (
        segment.type === 'accordion' &&
        segment.heading.kind === 'h2' &&
        isInProgressHeading(segment.heading)
      );
    });
    if (!placementSegment || targetIndex < 0) {
      return displaySegments;
    }

    reordered.splice(targetIndex, 0, placementSegment);
    return reordered;
  }, [displaySegments]);
  const displayReadyOrderedSegments = useMemo<RenderSegment[]>(() => {
    return orderedSegments.map((segment) => normalizeSegmentForDisplay(segment));
  }, [orderedSegments]);
  const nestedSegmentsByStartIndex = useMemo<Record<number, RenderSegment[]>>(() => {
    const nested: Record<number, RenderSegment[]> = {};

    displayReadyOrderedSegments.forEach((segment) => {
      if (segment.type === 'accordion' && segment.heading.kind === 'h2') {
        nested[segment.startIndex] = buildSegments(segment.lines, {
          includeDailyResultsH2: false,
          startIndexOffset: segment.startIndex + 1,
        });
      }
    });

    return nested;
  }, [displayReadyOrderedSegments]);
  const inProgressGroupsByStartIndex = useMemo<Record<number, InProgressTableGroup[]>>(() => {
    const groupsByStartIndex: Record<number, InProgressTableGroup[]> = {};

    orderedSegments.forEach((segment) => {
      if (segment.type !== 'accordion' || segment.heading.kind !== 'h2') {
        return;
      }
      if (!isInProgressHeading(segment.heading)) {
        return;
      }

      groupsByStartIndex[segment.startIndex] = parseInProgressGroups(segment.lines, {
        taskHintsByAssignee,
      });
    });

    return groupsByStartIndex;
  }, [orderedSegments, taskHintsByAssignee]);

  const toggleAccordion = (segment: AccordionSegment): void => {
    setOpenSections((prev) => {
      const nextIsOpen = !prev[segment.startIndex];

      if (segment.heading.kind === 'h2') {
        writeAccordionStateToStorage(segment.heading.text, nextIsOpen);
      }

      return {
        ...prev,
        [segment.startIndex]: nextIsOpen,
      };
    });
  };

  useEffect(() => {
    setOpenSections((prev) => {
      let changed = false;
      const next = { ...prev };

      orderedSegments.forEach((segment) => {
        if (segment.type !== 'accordion' || segment.heading.kind !== 'h2') {
          return;
        }

        const persistedState = readAccordionStateFromStorage(segment.heading.text);
        if (persistedState !== undefined) {
          if (next[segment.startIndex] !== persistedState) {
            next[segment.startIndex] = persistedState;
            changed = true;
          }
          return;
        }

        if (
          (isInProgressHeading(segment.heading) || isAshigaruPlacementHeading(segment.heading)) &&
          next[segment.startIndex] === undefined
        ) {
          next[segment.startIndex] = true;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [orderedSegments]);

  useEffect(() => {
    setOpenAlertIssues((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;

      alertIssueItems.forEach((issue) => {
        const existing = prev[issue.key];
        next[issue.key] = existing ?? false;
        if (existing === undefined) {
          changed = true;
        }
      });

      if (Object.keys(prev).length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [alertIssueItems]);

  return (
    <div className="space-y-1 text-sm text-slate-100">
      {topTimestampText ? (
        <p className="text-xs text-slate-400">
          {renderInlineMarkdown(
            normalizeDashboardDisplayText(topTimestampText, {
              fallbackWhenIdOnly: '最終更新: 集計待ち',
            })
          )}
        </p>
      ) : null}

      <DailyRecordView />

      <AlertSection
        hasVisibleAlerts={hasVisibleAlerts}
        displayAlertCount={displayAlertCount}
        alertIssueItems={displayAlertIssueItems}
        alertOpen={alertOpen}
        setAlertOpen={setAlertOpen}
        openAlertIssues={openAlertIssues}
        setOpenAlertIssues={setOpenAlertIssues}
      />

      {visibleContentLines.length === 0 ? (
        initialFetchError ? (
          <div className="rounded border border-rose-400/45 bg-rose-500/15 px-2 py-2 text-xs text-rose-100">
            <p>{initialFetchError}</p>
            <button
              type="button"
              onClick={retryInitialFetch}
              disabled={initialFetchLoading}
              className="mt-2 rounded border border-rose-300/45 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {initialFetchLoading ? '再試行中...' : '再試行'}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate-300">
              {initialFetchLoading ? '戦況を判定中...' : '戦況は集計待ちでござる。'}
            </p>
            <section className="rounded border border-[color:var(--kincha)]/20 bg-black/10">
              <button
                type="button"
                aria-expanded
                className={TOP_LEVEL_ACCORDION_BUTTON_CLASS}
                style={{ fontFamily: '"Noto Serif JP", serif' }}
              >
                <span className={TOP_LEVEL_ACCORDION_ICON_CLASS} aria-hidden>
                  ▼
                </span>
                <span>足軽配置状況 (0件)</span>
              </button>
              <div className="space-y-1 border-t border-[color:var(--kincha)]/15 px-2 py-2">
                <p className="rounded border border-dashed border-slate-500/35 px-2 py-1 text-xs text-slate-300">
                  集計待ち
                </p>
              </div>
            </section>
            <section className="rounded border border-[color:var(--kincha)]/20 bg-black/10">
              <button
                type="button"
                aria-expanded
                className={TOP_LEVEL_ACCORDION_BUTTON_CLASS}
                style={{ fontFamily: '"Noto Serif JP", serif' }}
              >
                <span className={TOP_LEVEL_ACCORDION_ICON_CLASS} aria-hidden>
                  ▼
                </span>
                <span>進行中 (0件)</span>
              </button>
              <div className="space-y-1 border-t border-[color:var(--kincha)]/15 px-2 py-2">
                <p className="rounded border border-dashed border-slate-500/35 px-2 py-1 text-xs text-slate-300">
                  判定中
                </p>
              </div>
            </section>
          </div>
        )
      ) : (
        displayReadyOrderedSegments.map((segment) => {
          if (segment.type === 'block') {
            return (
              <Fragment key={`block-${segment.startIndex}`}>
                {renderParsedLineBlock(segment.lines, `block-${segment.startIndex}`)}
              </Fragment>
            );
          }

          if (segment.heading.kind === 'h2' && isInProgressHeading(segment.heading)) {
            const inProgressGroups = inProgressGroupsByStartIndex[segment.startIndex] ?? [];
            const displayItemCount = countInProgressItems(inProgressGroups);
            const titleText = `${normalizeSectionHeadingText(segment.heading.text)} (${displayItemCount}件)`;
            const accordionPanelId = `in-progress-panel-${segment.startIndex}`;

            return (
              <section
                key={`accordion-${segment.startIndex}`}
                className="rounded border border-[color:var(--kincha)]/20 bg-black/10"
              >
                <button
                  type="button"
                  aria-expanded={Boolean(openSections[segment.startIndex])}
                  aria-controls={accordionPanelId}
                  onClick={() => toggleAccordion(segment)}
                  className={TOP_LEVEL_ACCORDION_BUTTON_CLASS}
                  style={{ fontFamily: '"Noto Serif JP", serif' }}
                >
                  <span className={TOP_LEVEL_ACCORDION_ICON_CLASS} aria-hidden>
                    {openSections[segment.startIndex] ? '▼' : '▶'}
                  </span>
                  <span>{renderInlineMarkdown(titleText)}</span>
                </button>
                {openSections[segment.startIndex] ? (
                  <div
                    id={accordionPanelId}
                    className="space-y-1 border-t border-[color:var(--kincha)]/15 px-2 pt-0 pb-2"
                  >
                    {renderInProgressGroupTable(
                      inProgressGroups,
                      `in-progress-${segment.startIndex}`
                    )}
                  </div>
                ) : null}
              </section>
            );
          }

          return (
            <AccordionSection
              key={`accordion-${segment.startIndex}`}
              segment={segment}
              isOpen={Boolean(openSections[segment.startIndex])}
              openSections={openSections}
              onToggle={toggleAccordion}
              nestedSegments={nestedSegmentsByStartIndex[segment.startIndex]}
            />
          );
        })
      )}

      <section className="rounded border border-[color:var(--kincha)]/20 bg-black/10">
        <button
          type="button"
          aria-expanded={archiveOpen}
          aria-controls={archivePanelId}
          onClick={() => {
            setArchiveOpen((prev) => {
              const next = !prev;
              writeAccordionStateToStorage('過去の軍令', next);
              return next;
            });
          }}
          className={TOP_LEVEL_ACCORDION_BUTTON_CLASS}
          style={{ fontFamily: '"Noto Serif JP", serif' }}
        >
          <span className={TOP_LEVEL_ACCORDION_ICON_CLASS} aria-hidden>
            {archiveOpen ? '▼' : '▶'}
          </span>
          <span>{`過去の軍令 (${archiveCount}件)`}</span>
        </button>

        {archiveOpen ? (
          <div
            id={archivePanelId}
            className="space-y-2 border-t border-[color:var(--kincha)]/15 px-2 py-2"
          >
            {archiveError ? (
              <p className="rounded border border-rose-400/45 bg-rose-500/15 px-2 py-1 text-xs text-rose-100">
                読み込み失敗
              </p>
            ) : null}

            {archiveLoading && archiveItems.length < 1 ? (
              <p className="text-xs text-slate-300">読み込み中...</p>
            ) : null}

            {archiveItems.length > 0 ? (
              <ul className="space-y-1">
                {archiveItems.map((item, index) => (
                  <li
                    key={`archive-item-${item.id}-${item.completedAt ?? 'none'}-${index}`}
                    className="rounded border border-[color:var(--kincha)]/20 bg-black/15 px-2 py-1 text-xs text-slate-100"
                  >
                    <p
                      className="line-clamp-3 break-words leading-relaxed"
                      title={`${normalizeDashboardDisplayText(stripInlineMarkdown(item.command), {
                        fallbackWhenIdOnly: '任務記録',
                      })} | ${formatArchiveCompletedAt(item.completedAt)}`}
                    >
                      <span>
                        {renderInlineMarkdown(
                          normalizeDashboardDisplayText(stripInlineMarkdown(item.command), {
                            fallbackWhenIdOnly: '任務記録',
                          })
                        )}
                      </span>
                      <span className="text-slate-300">{' | '}</span>
                      <span className="text-slate-300">
                        {formatArchiveCompletedAt(item.completedAt)}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}

            {!archiveLoading && archiveInitialized && archiveItems.length < 1 && !archiveError ? (
              <p className="rounded border border-dashed border-slate-500/35 px-2 py-1 text-xs text-slate-300">
                過去の軍令は見当たらぬ。
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {hasMoreArchiveItems ? (
                <button
                  type="button"
                  onClick={() => {
                    if (archiveLoading) {
                      return;
                    }
                    void fetchArchiveCommands(archivePage + 1, { reset: false });
                  }}
                  disabled={archiveLoading}
                  className="rounded border border-[color:var(--kincha)]/40 bg-[color:var(--kincha)]/12 px-2 py-1 text-xs font-semibold text-[color:var(--kincha)] transition hover:bg-[color:var(--kincha)]/18 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {archiveLoading ? '読み込み中...' : '次の20件を表示'}
                </button>
              ) : null}

              {archiveError ? (
                <button
                  type="button"
                  onClick={() => {
                    if (archiveLoading) {
                      return;
                    }
                    const reset = archiveItems.length < 1;
                    const nextPage = reset ? 1 : archivePage + 1;
                    void fetchArchiveCommands(nextPage, { reset });
                  }}
                  disabled={archiveLoading}
                  className="rounded border border-rose-300/45 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  再試行
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
};

export default DashboardView;
