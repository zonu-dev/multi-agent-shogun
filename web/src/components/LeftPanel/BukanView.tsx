import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import BukanBugyoTab from './BukanBugyoTab';
import BukanBukoTab from './BukanBukoTab';
import BukanChikujoTab from './BukanChikujoTab';
import BukanShushuTab from './BukanShushuTab';
import {
  BUKAN_TAB_LABELS,
  BUKAN_TABS,
  getWrappedBukanTab,
  type BukanTab,
  useBukanData,
} from './useBukanData';

const BukanView = () => {
  const [activeTab, setActiveTab] = useState<BukanTab>('martial');
  const {
    titleCardsByTab,
    martialAchievementCards,
    constructionAchievementCards,
    unlockedTitles,
    selectedTitleId,
    setSelectedTitleId,
    equippedTitleName,
    equippingTitle,
    canEquipSelectedTitle,
    isEquipSelectionUnchanged,
    equipNotice,
    resolveTitleDisplayName,
    onEquipTitle,
  } = useBukanData();

  const getTabId = (tab: BukanTab): string => `bukan-tab-${tab}`;
  const getPanelId = (tab: BukanTab): string => `bukan-panel-${tab}`;

  const focusTab = (tab: BukanTab): void => {
    setActiveTab(tab);
    if (typeof window === 'undefined') {
      return;
    }

    window.requestAnimationFrame(() => {
      document.getElementById(getTabId(tab))?.focus();
    });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentTab: BukanTab) => {
    const currentIndex = BUKAN_TABS.indexOf(currentTab);
    if (currentIndex < 0) {
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusTab(getWrappedBukanTab(currentIndex + 1));
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusTab(getWrappedBukanTab(currentIndex - 1));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      focusTab(BUKAN_TABS[0]);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      focusTab(BUKAN_TABS[BUKAN_TABS.length - 1]);
    }
  };

  return (
    <div className="space-y-4 text-sm text-slate-100">
      <section className="space-y-2 rounded-lg border border-[color:var(--kincha)]/25 bg-black/20 p-3">
        <h4
          className="text-xs font-semibold tracking-[0.08em] text-[color:var(--kincha)]"
          style={{ fontFamily: '"Noto Serif JP", serif' }}
        >
          装備称号
        </h4>

        <select
          value={selectedTitleId}
          onChange={(event) => {
            const nextValue = event.target.value;
            setSelectedTitleId(nextValue === '__none__' ? '__none__' : nextValue);
          }}
          className="w-full rounded-md border border-[color:var(--kincha)]/35 bg-black/40 px-2 py-1.5 text-xs text-slate-100"
        >
          <option value="__none__">装備なし</option>
          {unlockedTitles.map((title) => (
            <option key={`bukan-title-option-${title.id}`} value={title.id}>
              {resolveTitleDisplayName(title.id)}
            </option>
          ))}
        </select>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-300">
            現在装備: {equippedTitleName ?? 'なし'} / 解放称号: {unlockedTitles.length}件
          </p>
          <button
            type="button"
            onClick={() => void onEquipTitle()}
            disabled={!canEquipSelectedTitle || isEquipSelectionUnchanged}
            className="rounded-md border border-[color:var(--kincha)]/45 bg-[color:var(--kincha)]/20 px-2.5 py-1 text-[11px] font-semibold text-[color:var(--kincha)] transition hover:bg-[color:var(--kincha)]/30 disabled:cursor-not-allowed disabled:border-slate-500/50 disabled:bg-slate-500/20 disabled:text-slate-300"
          >
            {equippingTitle ? '切替中...' : '装備する'}
          </button>
        </div>

        {equipNotice ? (
          <p className="rounded-md border border-[color:var(--kincha)]/35 bg-black/30 px-2 py-1 text-[11px] text-slate-200">
            {equipNotice}
          </p>
        ) : null}
      </section>

      <nav
        className="grid grid-cols-4 gap-1 rounded-lg border border-[color:var(--kincha)]/25 bg-black/20 p-1"
        role="tablist"
        aria-label="武鑑分類"
      >
        {BUKAN_TABS.map((tab) => {
          const active = tab === activeTab;
          return (
            <button
              key={getTabId(tab)}
              id={getTabId(tab)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={getPanelId(tab)}
              tabIndex={active ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(event) => handleTabKeyDown(event, tab)}
              className={[
                'rounded-md px-2 py-1.5 text-[11px] font-semibold transition',
                active
                  ? 'bg-[color:var(--kincha)]/80 text-[#3d2200]'
                  : 'text-slate-200 hover:bg-white/10',
              ].join(' ')}
            >
              {BUKAN_TAB_LABELS[tab]}
            </button>
          );
        })}
      </nav>

      <section
        className="space-y-3"
        role="tabpanel"
        id={getPanelId(activeTab)}
        aria-labelledby={getTabId(activeTab)}
      >
        {activeTab === 'martial' ? (
          <BukanBukoTab
            titleCards={titleCardsByTab.martial}
            achievementCards={martialAchievementCards}
          />
        ) : null}

        {activeTab === 'construction' ? (
          <BukanChikujoTab
            titleCards={titleCardsByTab.construction}
            achievementCards={constructionAchievementCards}
          />
        ) : null}

        {activeTab === 'magistrate' ? (
          <BukanBugyoTab titleCards={titleCardsByTab.magistrate} />
        ) : null}

        {activeTab === 'collection' ? (
          <BukanShushuTab titleCards={titleCardsByTab.collection} />
        ) : null}
      </section>
    </div>
  );
};

export default BukanView;
