import type { Dispatch, SetStateAction } from 'react';

import {
  ALERT_TOP_LEVEL_ACCORDION_BUTTON_CLASS,
  ALERT_TOP_LEVEL_ACCORDION_PANEL_CLASS,
  TOP_LEVEL_ACCORDION_ICON_CLASS,
  renderInlineMarkdown,
  renderParsedLineBlock,
  writeAccordionStateToStorage,
} from './AccordionSection';
import type { AlertIssueItem } from './parsers';

const ALERT_PANEL_ID = 'dashboard-alert-panel';
const toIssuePanelId = (issueKey: string): string => {
  const normalized = issueKey
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_\u3040-\u30ff\u3400-\u9fff]/g, '');

  return `dashboard-alert-issue-${normalized || 'item'}`;
};

interface AlertSectionProps {
  hasVisibleAlerts: boolean;
  displayAlertCount: number;
  alertIssueItems: AlertIssueItem[];
  alertOpen: boolean;
  setAlertOpen: Dispatch<SetStateAction<boolean>>;
  openAlertIssues: Record<string, boolean>;
  setOpenAlertIssues: Dispatch<SetStateAction<Record<string, boolean>>>;
}

export const AlertSection = ({
  hasVisibleAlerts,
  displayAlertCount,
  alertIssueItems,
  alertOpen,
  setAlertOpen,
  openAlertIssues,
  setOpenAlertIssues,
}: AlertSectionProps) => {
  const sectionClassName = hasVisibleAlerts
    ? 'rounded border border-rose-400/45 bg-rose-500/15'
    : 'rounded border border-emerald-400/35 bg-emerald-500/10';

  return (
    <section className={sectionClassName}>
      <button
        type="button"
        aria-expanded={alertOpen}
        aria-controls={ALERT_PANEL_ID}
        onClick={() => {
          setAlertOpen((prev) => {
            const next = !prev;
            writeAccordionStateToStorage('要対応', next);
            return next;
          });
        }}
        className={ALERT_TOP_LEVEL_ACCORDION_BUTTON_CLASS}
        style={{ fontFamily: '"Noto Serif JP", serif' }}
      >
        <span className={TOP_LEVEL_ACCORDION_ICON_CLASS} aria-hidden>
          {alertOpen ? '▼' : '▶'}
        </span>
        <span>{`要対応 (${displayAlertCount}件)`}</span>
      </button>
      {alertOpen ? (
        <div id={ALERT_PANEL_ID} className={ALERT_TOP_LEVEL_ACCORDION_PANEL_CLASS}>
          {alertIssueItems.length > 0 ? (
            alertIssueItems.map((issue) => {
              const issueOpen = Boolean(openAlertIssues[issue.key]);
              const issuePanelId = toIssuePanelId(issue.key);

              return (
                <section
                  key={issue.key}
                  className="rounded border border-rose-300/40 bg-rose-500/12"
                >
                  <button
                    type="button"
                    aria-expanded={issueOpen}
                    aria-controls={issuePanelId}
                    onClick={() => {
                      setOpenAlertIssues((prev) => ({
                        ...prev,
                        [issue.key]: !prev[issue.key],
                      }));
                    }}
                    className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs font-semibold text-rose-50 transition-colors hover:bg-rose-500/20"
                    style={{ fontFamily: '"Noto Serif JP", serif' }}
                  >
                    <span className="w-3 text-[10px]" aria-hidden>
                      {issueOpen ? '▼' : '▶'}
                    </span>
                    <span className="truncate" title={issue.heading}>
                      {renderInlineMarkdown(issue.heading)}
                    </span>
                  </button>
                  {issueOpen ? (
                    <div
                      id={issuePanelId}
                      className="space-y-1 border-t border-rose-300/30 px-2 py-2"
                    >
                      {renderParsedLineBlock(issue.detailLines, issue.key)}
                    </div>
                  ) : null}
                </section>
              );
            })
          ) : (
            <p className="rounded border border-dashed border-emerald-300/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-100">
              要対応なし
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
};
