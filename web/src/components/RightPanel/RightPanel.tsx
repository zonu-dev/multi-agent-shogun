import { Component, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { ErrorInfo, KeyboardEvent, ReactNode } from 'react';
import ScrollContainer from '@/components/Common/ScrollContainer';
import { useDashboardStore } from '@/store/dashboardStore';
import { useGameStore } from '@/store/gameStore';

const DashboardView = lazy(() => import('./DashboardView'));
const MissionView = lazy(() => import('./MissionView'));
const ShopView = lazy(() => import('./ShopView'));
const ActivityLogView = lazy(() => import('./ActivityLogView'));

type RightTab = 'dashboard' | 'mission' | 'shop' | 'activity_log';

const RIGHT_TABS: readonly RightTab[] = ['dashboard', 'mission', 'shop', 'activity_log'];

const TAB_LABELS: Record<RightTab, string> = {
  dashboard: '戦況報告',
  mission: '御触書',
  shop: '商処',
  activity_log: '軍記',
};

interface RightPanelErrorBoundaryProps {
  tab: RightTab;
  children: ReactNode;
}

interface RightPanelErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

class RightPanelErrorBoundary extends Component<
  RightPanelErrorBoundaryProps,
  RightPanelErrorBoundaryState
> {
  state: RightPanelErrorBoundaryState = {
    hasError: false,
    errorMessage: null,
  };

  static getDerivedStateFromError(error: unknown): RightPanelErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : null,
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[RightPanel] panel rendering failed', {
      tab: this.props.tab,
      error,
      componentStack: info.componentStack,
    });
  }

  private readonly handleReset = (): void => {
    this.setState({
      hasError: false,
      errorMessage: null,
    });
  };

  private readonly handleReload = (): void => {
    if (typeof window === 'undefined') {
      return;
    }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        className="mx-2 mt-2 rounded-lg border border-rose-400/45 bg-rose-500/15 px-3 py-3 text-xs text-rose-100"
      >
        <p className="font-semibold">右パネルの描画に失敗いたした。</p>
        <p className="mt-1 text-rose-100/85">
          一時的な不具合の可能性があるため、再試行または再読込を試されよ。
        </p>
        {this.state.errorMessage ? (
          <p className="mt-1 break-words text-[11px] text-rose-100/75">{this.state.errorMessage}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={this.handleReset}
            className="rounded border border-rose-200/45 bg-rose-500/20 px-2 py-1 text-[11px] font-semibold text-rose-50 transition hover:bg-rose-500/30"
          >
            再試行
          </button>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded border border-rose-200/45 bg-black/25 px-2 py-1 text-[11px] font-semibold text-rose-50 transition hover:bg-black/35"
          >
            再読込
          </button>
        </div>
      </div>
    );
  }
}

const getWrappedTab = (startIndex: number): RightTab => {
  const tabCount = RIGHT_TABS.length;
  const wrappedIndex = ((startIndex % tabCount) + tabCount) % tabCount;
  return RIGHT_TABS[wrappedIndex];
};

const RightPanel = () => {
  const [activeTab, setActiveTab] = useState<RightTab>('dashboard');
  const [mountedTabs, setMountedTabs] = useState<Set<RightTab>>(() => new Set(['dashboard']));
  const hasAlerts = useDashboardStore((state) => state.hasAlerts);
  const alertCount = useDashboardStore((state) => state.visibleAlertCount);
  const gameState = useGameStore((state) => state.gameState);
  const claimableMissionCount = useMemo(
    () =>
      (gameState?.missions ?? []).filter((mission) => {
        const progressCurrent = mission.progress?.current ?? 0;
        const progressTarget = mission.progress?.target ?? Number.POSITIVE_INFINITY;

        return progressCurrent >= progressTarget && mission.claimed !== true;
      }).length,
    [gameState?.missions]
  );
  const dashboardBadgeCount = hasAlerts ? alertCount : 0;

  const focusTab = (tab: RightTab) => {
    setActiveTab(tab);
    window.requestAnimationFrame(() => {
      document.getElementById(`right-tab-${tab}`)?.focus();
    });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentTab: RightTab) => {
    const currentIndex = RIGHT_TABS.indexOf(currentTab);
    if (currentIndex < 0) {
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusTab(getWrappedTab(currentIndex + 1));
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusTab(getWrappedTab(currentIndex - 1));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      focusTab(RIGHT_TABS[0]);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      focusTab(RIGHT_TABS[RIGHT_TABS.length - 1]);
    }
  };

  useEffect(() => {
    setMountedTabs((current) => {
      if (current.has(activeTab)) {
        return current;
      }

      const next = new Set(current);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  return (
    <ScrollContainer
      className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden"
      contentClassName="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-x-hidden pb-4"
    >
      <nav
        role="tablist"
        aria-label="右パネル"
        className="flex w-full min-w-0 shrink-0 flex-nowrap items-center gap-2 overflow-x-auto rounded-lg border border-[color:var(--kincha)]/25 bg-black/20 p-1"
      >
        {RIGHT_TABS.map((tab) => {
          const active = tab === activeTab;
          const badgeCount =
            tab === 'dashboard'
              ? dashboardBadgeCount
              : tab === 'mission'
                ? claimableMissionCount
                : 0;

          return (
            <button
              key={tab}
              type="button"
              id={`right-tab-${tab}`}
              role="tab"
              aria-selected={active}
              aria-controls={`right-panel-${tab}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(event) => handleTabKeyDown(event, tab)}
              className={[
                'flex-none min-w-max whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold leading-none transition',
                active
                  ? 'bg-[color:var(--kincha)]/80 text-[#3d2200]'
                  : 'text-slate-200 hover:bg-white/10',
              ].join(' ')}
            >
              <span className="inline-flex min-w-max items-center justify-center gap-1.5">
                <span>{TAB_LABELS[tab]}</span>
                {badgeCount > 0 ? (
                  <span className="inline-flex shrink-0 min-w-[1.35rem] items-center justify-center rounded-full bg-rose-500 px-1.5 text-xs leading-4 text-white">
                    {badgeCount}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="min-h-0 min-w-0 flex-1">
        {RIGHT_TABS.map((tab) => {
          const active = tab === activeTab;
          const shouldRender = mountedTabs.has(tab);

          return (
            <section
              key={`right-panel-${tab}`}
              id={`right-panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`right-tab-${tab}`}
              hidden={!active}
              className="min-h-full min-w-0 overflow-x-hidden pb-2"
            >
              <RightPanelErrorBoundary tab={tab}>
                <Suspense
                  fallback={<div className="px-2 py-3 text-xs text-slate-300">読み込み中...</div>}
                >
                  <div className="min-w-0 overflow-x-hidden">
                    {shouldRender ? (
                      tab === 'dashboard' ? (
                        <DashboardView />
                      ) : tab === 'mission' ? (
                        <MissionView />
                      ) : tab === 'activity_log' ? (
                        <ActivityLogView />
                      ) : (
                        <ShopView />
                      )
                    ) : null}
                  </div>
                </Suspense>
              </RightPanelErrorBoundary>
            </section>
          );
        })}
      </div>
    </ScrollContainer>
  );
};

export default RightPanel;
