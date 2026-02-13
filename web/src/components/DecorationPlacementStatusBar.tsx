import { resolveDecorationMeta, type PendingPlacement } from '@/hooks/decorationInteractionShared';

interface DecorationPlacementStatusBarProps {
  pendingPlacement: PendingPlacement | null;
  onCancel: () => void;
}

const DecorationPlacementStatusBar = ({
  pendingPlacement,
  onCancel,
}: DecorationPlacementStatusBarProps) => {
  if (!pendingPlacement) {
    return null;
  }

  const meta = resolveDecorationMeta(pendingPlacement.decorationType);
  const modeLabel = pendingPlacement.mode === 'move' ? '移設' : '新規設置';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[74] flex justify-center px-3">
      <section
        className="pointer-events-auto w-[min(46rem,calc(100vw-1.5rem))] border border-[color:var(--kincha)]/70 bg-[#0f172a]/92 p-3 text-slate-100 shadow-[0_20px_70px_rgba(2,6,23,0.65)]"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p
              className="text-sm font-bold text-[color:var(--kincha)]"
              style={{ fontFamily: '"Noto Serif JP", serif' }}
            >
              {meta.emoji} 装飾配置中 ({modeLabel})
            </p>
            <p className="mt-1 text-xs text-slate-200">
              {meta.label} | クリックで配置 / Escでキャンセル
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="border border-emerald-300/35 bg-emerald-900/35 px-2 py-1 text-[11px] font-bold text-emerald-100">
              プレビュー: 地図上ハイライトで確認
            </span>
            <button
              type="button"
              disabled
              className="cursor-default border border-sky-300/35 bg-sky-900/28 px-3 py-1.5 text-xs font-bold text-sky-100 opacity-85"
              style={{ fontFamily: '"Noto Sans JP", sans-serif' }}
            >
              確定: 地図を左クリック
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="border border-rose-300/55 bg-rose-900/45 px-3 py-1.5 text-xs font-bold text-rose-100 transition hover:bg-rose-900/65"
              style={{ fontFamily: '"Noto Sans JP", sans-serif' }}
            >
              キャンセル (Esc)
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default DecorationPlacementStatusBar;
