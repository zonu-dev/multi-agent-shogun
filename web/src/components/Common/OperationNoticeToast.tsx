import { useEffect, useMemo } from 'react';
import {
  OPERATION_NOTICE_POPUP_TYPE,
  toOperationNoticePayload,
  type OperationNoticePayload,
} from '@/lib/ui/operationNotice';
import { formatCurrency } from '@/lib/gamification/economy';
import { useUIStore } from '@/store/uiStore';

const AUTO_DISMISS_MS = 4500;
const CURRENCY_TOKEN_PATTERN = /([+-]?\d[\d,]*)\s*G\b/gi;
const GOLD_WORD_PATTERN = /\bGold\b/gi;

const TONE_CLASSES: Record<
  NonNullable<OperationNoticePayload['tone']> | 'default',
  { panel: string; button: string; title: string }
> = {
  default: {
    panel: 'border-sky-300/35 bg-sky-950/70 text-sky-100',
    button: 'border-sky-200/35 hover:bg-sky-500/20',
    title: 'text-sky-50',
  },
  info: {
    panel: 'border-sky-300/35 bg-sky-950/70 text-sky-100',
    button: 'border-sky-200/35 hover:bg-sky-500/20',
    title: 'text-sky-50',
  },
  success: {
    panel: 'border-emerald-300/35 bg-emerald-950/70 text-emerald-100',
    button: 'border-emerald-200/35 hover:bg-emerald-500/20',
    title: 'text-emerald-50',
  },
  error: {
    panel: 'border-rose-300/35 bg-rose-950/75 text-rose-100',
    button: 'border-rose-200/35 hover:bg-rose-500/20',
    title: 'text-rose-50',
  },
};

const parseCurrencyToken = (token: string): number | null => {
  const normalized = token.replace(/,/g, '');
  if (!/^[+-]?\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeNoticeMessage = (message: string): string =>
  message
    .replace(CURRENCY_TOKEN_PATTERN, (_, token: string) => {
      const parsed = parseCurrencyToken(token);
      return parsed === null ? `${token}G` : formatCurrency(parsed);
    })
    .replace(GOLD_WORD_PATTERN, '小判');

const OperationNoticeToast = () => {
  const activePopup = useUIStore((state) => state.activePopup);
  const closePopup = useUIStore((state) => state.closePopup);

  const notice = useMemo(() => {
    if (activePopup?.type !== OPERATION_NOTICE_POPUP_TYPE) {
      return null;
    }

    return toOperationNoticePayload(activePopup.data);
  }, [activePopup]);

  useEffect(() => {
    if (notice === null || notice.tone === 'error' || typeof window === 'undefined') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      closePopup();
    }, AUTO_DISMISS_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [closePopup, notice]);

  if (notice === null) {
    return null;
  }

  const toneClass = TONE_CLASSES[notice.tone ?? 'default'];
  const normalizedMessage = normalizeNoticeMessage(notice.message);

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[75] w-[min(28rem,calc(100vw-2rem))]">
      <section
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={[
          'pointer-events-auto rounded-lg border px-3 py-2 text-xs shadow-[0_18px_40px_rgba(2,6,23,0.45)] backdrop-blur-sm',
          toneClass.panel,
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {notice.title ? (
              <p className={['mb-1 text-[11px] font-semibold', toneClass.title].join(' ')}>{notice.title}</p>
            ) : null}
            <p className="break-words">{normalizedMessage}</p>
          </div>
          <button
            type="button"
            onClick={closePopup}
            aria-label="通知を閉じる"
            className={['shrink-0 rounded border px-2 py-0.5 text-[11px] transition', toneClass.button].join(
              ' '
            )}
          >
            閉
          </button>
        </div>
      </section>
    </div>
  );
};

export default OperationNoticeToast;
