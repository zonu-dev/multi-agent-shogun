import { POPUP_VIEWPORT_MARGIN, type DecorationProcessingAction, type PopupPosition, type SelectedDecoration } from '@/hooks/decorationInteractionShared';
import type { MutableRefObject } from 'react';

interface DecorationSelectionPanelProps {
  panelRef: MutableRefObject<HTMLElement | null>;
  selectedDecoration: SelectedDecoration;
  selectedDecorationMeta: { emoji: string; label: string };
  selectedDecorationPassiveText: string;
  selectedDecorationUpgradeCost: number | null;
  popupPosition: PopupPosition | null;
  processingAction: DecorationProcessingAction | null;
  isPlacementPending: boolean;
  onClose: () => void;
  onCollect: () => Promise<void>;
  onMove: () => Promise<void>;
  onUpgrade: () => Promise<void>;
}

const DecorationSelectionPanel = ({
  panelRef,
  selectedDecoration,
  selectedDecorationMeta,
  selectedDecorationPassiveText,
  selectedDecorationUpgradeCost,
  popupPosition,
  processingAction,
  isPlacementPending,
  onClose,
  onCollect,
  onMove,
  onUpgrade,
}: DecorationSelectionPanelProps) => (
  <div className="pointer-events-none fixed inset-0 z-[70]">
    <section
      ref={panelRef}
      className="pointer-events-auto absolute w-[min(336px,calc(100vw-1.5rem))] border-2 border-[color:var(--kincha)]/90 bg-[#1f2937]/95 p-3 text-slate-100 shadow-[0_20px_60px_rgba(15,23,42,0.58)]"
      style={
        popupPosition
          ? {
              left: `${popupPosition.left}px`,
              top: `${popupPosition.top}px`,
            }
          : {
              left: `${POPUP_VIEWPORT_MARGIN}px`,
              top: `${POPUP_VIEWPORT_MARGIN}px`,
            }
      }
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3
            className="flex items-center gap-2 text-[14px] font-bold text-[color:var(--kincha)]"
            style={{ fontFamily: '"Noto Serif JP", serif' }}
          >
            <span>{selectedDecorationMeta.emoji}</span>
            <span>{selectedDecorationMeta.label}</span>
          </h3>
          <p className="mt-2 text-xs text-slate-300">現在の作業状態: 配置済み</p>
          <p className="mt-1 text-[11px] text-slate-300">
            座標: ({selectedDecoration.position.x}, {selectedDecoration.position.y})
          </p>
          <p className="mt-1 text-[11px] text-slate-300">等級: Lv{selectedDecoration.level}</p>
          <p className="mt-1 text-[11px] text-slate-300">{selectedDecorationPassiveText}</p>
          <p className="mt-2 text-[12px] font-bold text-slate-200">装飾操作:</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="bg-[#3f1d1d] px-2 py-1 text-[11px] text-[#fca5a5] transition hover:bg-[#542323]"
          style={{ fontFamily: '"Noto Sans JP", sans-serif' }}
        >
          閉じる
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={processingAction !== null || isPlacementPending}
          onClick={() => {
            void onCollect();
          }}
          className="border border-rose-300/45 bg-rose-900/45 px-3 py-1.5 text-xs font-bold text-rose-100 transition hover:bg-rose-900/65 disabled:cursor-not-allowed disabled:border-[#94a3b8] disabled:bg-[#475569]/45 disabled:text-[#cbd5e1]"
          style={{ fontFamily: '"Noto Sans JP", sans-serif' }}
        >
          {processingAction === 'collect' ? '回収中...' : '回収'}
        </button>
        <button
          type="button"
          disabled={processingAction !== null || isPlacementPending}
          onClick={() => {
            void onMove();
          }}
          className="border border-sky-300/55 bg-[#0b2942]/62 px-3 py-1.5 text-xs font-bold text-[#e0f2fe] transition hover:bg-[#113a5f]/72 disabled:cursor-not-allowed disabled:border-[#64748b] disabled:bg-[#334155]/35 disabled:text-[#cbd5e1]"
          style={{ fontFamily: '"Noto Sans JP", sans-serif' }}
        >
          {processingAction === 'move' ? '移動準備中...' : '移動'}
        </button>
      </div>
      <div className="mt-2">
        <button
          type="button"
          disabled={
            processingAction !== null || isPlacementPending || selectedDecorationUpgradeCost === null
          }
          onClick={() => {
            void onUpgrade();
          }}
          className="w-full border border-amber-300/55 bg-amber-900/35 px-3 py-1.5 text-xs font-bold text-amber-100 transition hover:bg-amber-800/45 disabled:cursor-not-allowed disabled:border-[#64748b] disabled:bg-[#334155]/35 disabled:text-[#cbd5e1]"
          style={{ fontFamily: '"Noto Sans JP", sans-serif' }}
        >
          {processingAction === 'upgrade'
            ? '強化中...'
            : selectedDecorationUpgradeCost !== null
              ? `強化 (${selectedDecorationUpgradeCost}両)`
              : '強化上限'}
        </button>
      </div>
    </section>
  </div>
);

export default DecorationSelectionPanel;
