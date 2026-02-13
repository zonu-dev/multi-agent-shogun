import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ActivityLogEntry } from '@/types';
import { useGameStore } from '@/store/gameStore';

const EVENT_ICONS: Record<ActivityLogEntry['type'], string> = {
  work_start: '⚔️',
  work_complete: '✅',
  purchase: '🪙',
  item_consume: '📦',
  building_upgrade: '🏗️',
  mission_complete: '📜',
};

const formatTimestamp = (timestamp: string): string => {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return '--:--';
  }

  return parsed.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const formatNumberWithSign = (value: number, suffix: string): string =>
  `${value > 0 ? '+' : ''}${value}${suffix}`;

const normalizeUiTermsForDisplay = (text: string): string => {
  return text
    .replace(/(\d+)\s*G\b/g, '$1両')
    .replace(/(\d+)\s*XP\b/gi, '$1修練値')
    .replace(/\bXP\b/gi, '修練値')
    .replace(/(\d+)\s*EP\b/gi, '$1修練値')
    .replace(/\bEP\b/gi, '修練値')
    .replace(/経験値/g, '修練値')
    .replace(/\bGold\b/gi, '小判')
    .replace(/ゴールド/g, '小判');
};

const AUTO_FOLLOW_THRESHOLD_PX = 24;
const INITIAL_VISIBLE_ENTRY_COUNT = 120;
const ENTRY_PAGE_SIZE = 80;
const ACTIVITY_LOG_TAB_ID = 'right-tab-activity_log';
const ACTIVITY_LOG_UNREAD_BADGE_ATTR = 'data-activity-log-unread-badge';
const MAX_UNREAD_BADGE_COUNT = 99;
const seedOrDebugNoisePattern =
  /(?:\bseed55\b|seed55[-_]\d+|\[(?:watcher|daily-record)-debug\]|\bdebug\b)/i;
const markdownLinkPatternSource = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;

const isNoiseActivityLogEntry = (entry: ActivityLogEntry): boolean => {
  const candidates = [
    entry.id,
    entry.message,
    entry.workerId ?? '',
    entry.workerName ?? '',
  ];
  return candidates.some((candidate) => seedOrDebugNoisePattern.test(candidate));
};

const normalizeLinkUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
};

const renderMessageWithMarkdownLinks = (message: string): ReactNode => {
  const normalized = normalizeUiTermsForDisplay(message);
  const markdownLinkPattern = new RegExp(markdownLinkPatternSource.source, 'g');
  const matches = [...normalized.matchAll(markdownLinkPattern)];
  if (matches.length < 1) {
    return normalized;
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    const fullText = match[0];
    const label = match[1];
    const url = match[2];
    const start = match.index ?? 0;
    if (start > cursor) {
      nodes.push(
        <Fragment key={`text-${index}-${cursor}`}>{normalized.slice(cursor, start)}</Fragment>
      );
    }

    const safeUrl = normalizeLinkUrl(url);
    if (safeUrl === null) {
      nodes.push(
        <Fragment key={`fallback-${index}`}>{normalized.slice(start, start + fullText.length)}</Fragment>
      );
    } else {
      nodes.push(
        <a
          key={`link-${index}`}
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-sky-300/70 underline-offset-2 transition hover:text-sky-200"
        >
          {normalizeUiTermsForDisplay(label)}
        </a>
      );
    }

    cursor = start + fullText.length;
  });

  if (cursor < normalized.length) {
    nodes.push(<Fragment key={`tail-${cursor}`}>{normalized.slice(cursor)}</Fragment>);
  }

  return nodes;
};

const buildRewardSummary = (entry: ActivityLogEntry): string[] => {
  const rewards: string[] = [];

  if (
    entry.type === 'work_complete' &&
    typeof entry.durationMinutes === 'number' &&
    Number.isFinite(entry.durationMinutes) &&
    entry.durationMinutes > 0
  ) {
    rewards.push(`${Math.floor(entry.durationMinutes)}分`);
  }

  if (typeof entry.gold === 'number' && Number.isFinite(entry.gold) && entry.gold !== 0) {
    rewards.push(formatNumberWithSign(Math.floor(entry.gold), '両'));
  }

  if (typeof entry.xp === 'number' && Number.isFinite(entry.xp) && entry.xp !== 0) {
    rewards.push(formatNumberWithSign(Math.floor(entry.xp), '修練値'));
  }

  if (Array.isArray(entry.items) && entry.items.length > 0) {
    rewards.push(entry.items.map((item) => `${item.name}×${item.quantity}`).join('、'));
  }

  return rewards;
};

const ActivityLogView = () => {
  const gameState = useGameStore((state) => state.gameState);
  const isGameStateLoading = gameState === null;
  const rawActivityLog = gameState?.activityLog ?? [];
  const activityLog = useMemo(
    () => rawActivityLog.filter((entry) => !isNoiseActivityLogEntry(entry)),
    [rawActivityLog]
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const totalEntryCount = activityLog.length;
  const [visibleEntryCount, setVisibleEntryCount] = useState(INITIAL_VISIBLE_ENTRY_COUNT);
  const entries = useMemo(() => {
    if (totalEntryCount <= visibleEntryCount) {
      return activityLog;
    }

    return activityLog.slice(totalEntryCount - visibleEntryCount);
  }, [activityLog, totalEntryCount, visibleEntryCount]);
  const previousEntryCountRef = useRef(0);
  const previousTabCountRef = useRef(0);
  const [isAutoFollowEnabled, setIsAutoFollowEnabled] = useState(true);
  const [hasUnreadEntries, setHasUnreadEntries] = useState(false);
  const [tabUnreadCount, setTabUnreadCount] = useState(0);
  const hiddenEntryCount = Math.max(0, totalEntryCount - entries.length);
  const hasOlderEntries = hiddenEntryCount > 0;

  useEffect(() => {
    setVisibleEntryCount((current) => {
      if (totalEntryCount < 1) {
        return INITIAL_VISIBLE_ENTRY_COUNT;
      }

      if (current >= totalEntryCount) {
        return totalEntryCount;
      }

      return Math.max(INITIAL_VISIBLE_ENTRY_COUNT, current);
    });
  }, [totalEntryCount]);

  const isNearBottom = (container: HTMLDivElement): boolean => {
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceToBottom <= AUTO_FOLLOW_THRESHOLD_PX;
  };

  const isActivityLogTabActive = (): boolean => {
    if (typeof document === 'undefined') {
      return true;
    }

    const tabButton = document.getElementById(ACTIVITY_LOG_TAB_ID);
    return tabButton?.getAttribute('aria-selected') === 'true';
  };

  const scrollToLatest = (): void => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
    setIsAutoFollowEnabled(true);
    setHasUnreadEntries(false);
    setTabUnreadCount(0);
  };

  const handleScroll = (): void => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const nearBottom = isNearBottom(container);
    setIsAutoFollowEnabled(nearBottom);
    if (nearBottom) {
      setHasUnreadEntries(false);
    }
  };

  const handleShowOlderEntries = (): void => {
    setVisibleEntryCount((current) => Math.min(totalEntryCount, current + ENTRY_PAGE_SIZE));
  };

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      previousEntryCountRef.current = totalEntryCount;
      return;
    }

    const hadPreviousEntries = previousEntryCountRef.current > 0;
    const hasNewEntries = totalEntryCount > previousEntryCountRef.current;
    const nearBottom = isNearBottom(container);

    if (!hadPreviousEntries && totalEntryCount > 0) {
      container.scrollTop = container.scrollHeight;
      setHasUnreadEntries(false);
      setIsAutoFollowEnabled(true);
    } else if (hasNewEntries) {
      if (isAutoFollowEnabled || nearBottom) {
        container.scrollTop = container.scrollHeight;
        setHasUnreadEntries(false);
        setIsAutoFollowEnabled(true);
      } else {
        setHasUnreadEntries(true);
      }
    }

    if (totalEntryCount < 1) {
      setHasUnreadEntries(false);
      setIsAutoFollowEnabled(true);
    }

    previousEntryCountRef.current = totalEntryCount;
  }, [isAutoFollowEnabled, totalEntryCount]);

  useEffect(() => {
    const previousCount = previousTabCountRef.current;
    const addedCount = Math.max(0, totalEntryCount - previousCount);

    if (isActivityLogTabActive()) {
      setTabUnreadCount(0);
    } else if (addedCount > 0) {
      setTabUnreadCount((current) => Math.min(MAX_UNREAD_BADGE_COUNT, current + addedCount));
    }

    previousTabCountRef.current = totalEntryCount;
  }, [totalEntryCount]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const tabButton = document.getElementById(ACTIVITY_LOG_TAB_ID);
    if (!tabButton) {
      return undefined;
    }

    const observer = new MutationObserver(() => {
      if (tabButton.getAttribute('aria-selected') === 'true') {
        setTabUnreadCount(0);
      }
    });

    observer.observe(tabButton, {
      attributes: true,
      attributeFilter: ['aria-selected'],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const tabButton = document.getElementById(ACTIVITY_LOG_TAB_ID);
    if (!tabButton) {
      return;
    }

    const labelContainer =
      tabButton.querySelector('span.inline-flex.min-w-max.items-center.justify-center.gap-1\\.5') ??
      tabButton;
    let badge = labelContainer.querySelector(
      `[${ACTIVITY_LOG_UNREAD_BADGE_ATTR}="true"]`
    ) as HTMLSpanElement | null;

    if (tabUnreadCount > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.setAttribute(ACTIVITY_LOG_UNREAD_BADGE_ATTR, 'true');
        badge.className =
          'inline-flex shrink-0 min-w-[1.35rem] items-center justify-center rounded-full bg-sky-500 px-1.5 text-xs leading-4 text-white';
        labelContainer.appendChild(badge);
      }
      badge.textContent = tabUnreadCount > MAX_UNREAD_BADGE_COUNT ? '99+' : String(tabUnreadCount);
    } else if (badge) {
      badge.remove();
    }
  }, [tabUnreadCount]);

  useEffect(() => {
    return () => {
      if (typeof document === 'undefined') {
        return;
      }
      const tabButton = document.getElementById(ACTIVITY_LOG_TAB_ID);
      const badge = tabButton?.querySelector(
        `[${ACTIVITY_LOG_UNREAD_BADGE_ATTR}="true"]`
      ) as HTMLSpanElement | null;
      badge?.remove();
    };
  }, []);

  if (isGameStateLoading) {
    return (
      <section className="rounded-xl border border-[color:var(--kincha)]/30 bg-black/20 p-3 text-xs text-slate-300">
        読込中...
      </section>
    );
  }

  if (totalEntryCount === 0) {
    return (
      <section className="rounded-xl border border-[color:var(--kincha)]/30 bg-black/20 p-3 text-xs text-slate-300">
        記録なし
      </section>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {hasOlderEntries ? (
        <div className="mb-2">
          <button
            type="button"
            onClick={handleShowOlderEntries}
            className="rounded border border-[color:var(--kincha)]/35 bg-[color:var(--kincha)]/10 px-2 py-1 text-[11px] font-semibold text-[color:var(--kincha)] transition hover:bg-[color:var(--kincha)]/20"
          >
            {hiddenEntryCount}件を遡って表示
          </button>
        </div>
      ) : null}
      {hasUnreadEntries ? (
        <div className="mb-2">
          <button
            type="button"
            onClick={scrollToLatest}
            className="rounded border border-sky-300/45 bg-sky-500/10 px-2 py-1 text-[11px] font-semibold text-sky-100 transition hover:bg-sky-500/20"
          >
            新着あり（最新へ）
          </button>
        </div>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
      >
        {entries.map((entry) => {
          const rewardSummary = buildRewardSummary(entry);

          return (
            <article
              key={entry.id}
              className="rounded-xl border border-[color:var(--kincha)]/25 bg-black/20 px-3 py-2"
            >
              <div className="flex min-w-0 items-start gap-2">
                <time className="shrink-0 text-[11px] tabular-nums text-slate-400">
                  {formatTimestamp(entry.timestamp)}
                </time>
                <span className="shrink-0 text-sm leading-none">{EVENT_ICONS[entry.type]}</span>
                <p className="min-w-0 break-words text-xs text-slate-100">
                  {renderMessageWithMarkdownLinks(entry.message)}
                </p>
              </div>
              {rewardSummary.length > 0 ? (
                <p className="mt-1 pl-12 text-[11px] text-[color:var(--kincha)]">
                  {rewardSummary.join(' / ')}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default ActivityLogView;
