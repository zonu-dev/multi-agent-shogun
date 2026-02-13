import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useCommandStore } from '@/store/commandStore';
import type { CommandUpdatePayload } from '@/types';

interface SendState {
  kind: 'idle' | 'success' | 'error';
  message: string;
}

const SHOGUN_TARGET = 'shogun';
const COMMAND_INPUT_ID = 'command-bar-input';

const postMessage = async (url: string, message: string): Promise<void> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, target: SHOGUN_TARGET }),
  });

  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
};

const resolveCommandMessage = (command: CommandUpdatePayload | null): string => {
  if (command === null) {
    return '';
  }

  const commandSource = command as Record<string, unknown>;
  return (
    typeof command.message === 'string'
      ? command.message
      : typeof commandSource.command === 'string'
        ? commandSource.command
        : ''
  ).trim();
};

const CommandBar = () => {
  const commands = useCommandStore((state) => state.commands);

  const latestCommand = useMemo(
    () => (commands.length > 0 ? commands[commands.length - 1] : null),
    [commands]
  );
  const latestCommandText = resolveCommandMessage(latestCommand) || '現在、発令なし';

  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendState, setSendState] = useState<SendState>({
    kind: 'idle',
    message: '',
  });

  const handleCommandSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalized = message.trim();
    if (!normalized) {
      setSendState({ kind: 'error', message: '伝令文を入力されよ。' });
      return;
    }

    setIsSubmitting(true);
    try {
      await postMessage('/api/command', normalized);
      setSendState({ kind: 'success', message: '軍令を伝達いたした。' });
      setMessage('');
    } catch {
      setSendState({ kind: 'error', message: '伝達に失敗いたした。' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async () => {
    const payload = message.trim() || resolveCommandMessage(latestCommand) || '承認';
    setIsSubmitting(true);
    try {
      await postMessage('/api/approve', payload);
      setSendState({ kind: 'success', message: '承認を伝達いたした。' });
    } catch {
      setSendState({ kind: 'error', message: '承認伝達に失敗いたした。' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    const payload = message.trim() || resolveCommandMessage(latestCommand) || '却下';
    setIsSubmitting(true);
    try {
      await postMessage('/api/command', `却下: ${payload}`);
      setSendState({ kind: 'success', message: '却下を伝達いたした。' });
    } catch {
      setSendState({ kind: 'error', message: '却下伝達に失敗いたした。' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="h-full rounded-xl border border-[color:var(--kincha)]/40 bg-[color:var(--aitetsu)]/70 px-3 py-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-300">現下の軍令</p>
          <p
            className="truncate text-sm font-semibold text-[color:var(--kincha)]"
            style={{ fontFamily: '"Noto Serif JP", serif' }}
            title={latestCommandText}
          >
            {latestCommandText}
          </p>
        </div>

        <form
          onSubmit={handleCommandSend}
          className="flex w-full flex-col gap-2 lg:max-w-3xl lg:flex-row"
        >
          <label htmlFor={COMMAND_INPUT_ID} className="sr-only">
            軍令入力欄
          </label>
          <input
            id={COMMAND_INPUT_ID}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="軍令文を記されよ"
            className="w-full rounded-lg border border-[color:var(--kincha)]/35 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none ring-0 transition focus:border-[color:var(--kincha)]/80"
          />
          <div className="grid grid-cols-3 gap-2 lg:flex lg:shrink-0">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md border border-[color:var(--kincha)]/45 bg-[color:var(--kincha)]/20 px-3 py-2 text-xs font-semibold text-[color:var(--kincha)] transition hover:bg-[color:var(--kincha)]/30 disabled:opacity-60"
            >
              送信
            </button>
            <button
              type="button"
              onClick={handleApprove}
              disabled={isSubmitting}
              className="rounded-md border border-emerald-400/45 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-60"
            >
              承認
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={isSubmitting}
              className="rounded-md border border-rose-400/45 bg-rose-500/20 px-3 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/30 disabled:opacity-60"
            >
              却下
            </button>
          </div>
        </form>
      </div>

      {sendState.kind !== 'idle' ? (
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={[
            'mt-2 text-xs',
            sendState.kind === 'success' ? 'text-emerald-200' : 'text-rose-200',
          ].join(' ')}
        >
          {sendState.message}
        </p>
      ) : null}
    </section>
  );
};

export default CommandBar;
