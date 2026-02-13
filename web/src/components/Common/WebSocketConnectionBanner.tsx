import type { ConnectionStatus } from '@/hooks/useWebSocket';

type WebSocketConnectionBannerProps = {
  status: ConnectionStatus;
  reconnectAttempts: number;
  nextReconnectInSeconds?: number | null;
  onReconnect?: () => void;
};

const WebSocketConnectionBanner = ({
  status,
  reconnectAttempts,
  nextReconnectInSeconds,
  onReconnect,
}: WebSocketConnectionBannerProps) => {
  if (status === 'connected') {
    return null;
  }

  const isConnecting = status === 'connecting';
  const isReconnecting = status === 'reconnecting';
  const retryCountdownLabel =
    isReconnecting &&
    typeof nextReconnectInSeconds === 'number' &&
    Number.isFinite(nextReconnectInSeconds) &&
    nextReconnectInSeconds > 0
      ? `${nextReconnectInSeconds}秒後にリトライ`
      : null;
  const title = isConnecting
    ? '接続中...'
    : isReconnecting
      ? retryCountdownLabel === null
        ? '再接続中...'
        : `再接続中... ${retryCountdownLabel}`
      : 'サーバーとの接続が切断されました';
  const detail = isConnecting
    ? 'サーバーへ接続しています。'
    : isReconnecting
      ? reconnectAttempts > 0
        ? `復旧を試みています（${reconnectAttempts}回目）`
        : '復旧を試みています'
      : 'サーバーの状態を確認されよ。';

  const handleReconnect = () => {
    if (typeof onReconnect === 'function') {
      onReconnect();
      return;
    }

    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100]">
      <section
        role="status"
        aria-live={isConnecting ? 'polite' : 'assertive'}
        aria-atomic="true"
        className="pointer-events-auto border-b border-rose-950 bg-rose-700 text-white shadow-[0_14px_30px_rgba(127,29,29,0.35)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div>
            <p className="m-0 text-sm font-semibold">{title}</p>
            <p className="m-0 mt-1 text-xs text-white/90">{detail}</p>
            <p className="m-0 mt-1 text-xs text-white/80">通信断のため操作できません。</p>
          </div>
          {!isConnecting ? (
            <button
              type="button"
              onClick={handleReconnect}
              className="rounded border border-white/55 bg-black/25 px-2 py-1 text-xs font-semibold text-white transition hover:bg-black/40"
            >
              再接続
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
};

export default WebSocketConnectionBanner;
