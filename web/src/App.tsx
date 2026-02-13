import { Suspense, lazy } from 'react';
import OperationNoticeToast from '@/components/Common/OperationNoticeToast';
import WebSocketConnectionBanner from '@/components/Common/WebSocketConnectionBanner';
import DecorationInteractionOverlay from '@/components/DecorationInteractionOverlay';
import LeftPanel from '@/components/LeftPanel/LeftPanel';
import RightPanel from '@/components/RightPanel/RightPanel';
import StatusBar from '@/components/StatusBar';
import { useWebSocket } from '@/hooks/useWebSocket';

const PhaserGame = lazy(() => import('@/game/PhaserGame'));

function App() {
  const { status, reconnectAttempts, nextReconnectInSeconds, reconnectNow } = useWebSocket();

  return (
    <div className="app-shell min-w-0 w-full max-w-full gap-0 overflow-x-hidden p-0 [grid-template-rows:minmax(0,1fr)]">
      <WebSocketConnectionBanner
        status={status}
        reconnectAttempts={reconnectAttempts}
        nextReconnectInSeconds={nextReconnectInSeconds}
        onReconnect={reconnectNow}
      />
      <main className="main-layout relative isolate min-w-0 w-full max-w-full overflow-hidden">
        <section className="left-panel relative z-10 min-w-0 overflow-hidden">
          <LeftPanel />
        </section>

        <section className="relative z-0 grid min-h-0 min-w-0 [grid-template-rows:auto_minmax(0,1fr)] gap-3 overflow-hidden">
          <section className="relative z-10">
            <StatusBar />
          </section>
          <section className="game-panel panel relative z-0 overflow-hidden">
            <Suspense
              fallback={<div className="p-3 text-sm text-slate-300">ゲームを読み込み中...</div>}
            >
              <PhaserGame />
            </Suspense>
          </section>
        </section>

        <section className="right-panel relative z-20 min-w-0 overflow-x-hidden">
          <RightPanel />
        </section>
      </main>
      <DecorationInteractionOverlay />
      <OperationNoticeToast />
    </div>
  );
}

export default App;
