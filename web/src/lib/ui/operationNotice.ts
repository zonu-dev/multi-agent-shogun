export const OPERATION_NOTICE_POPUP_TYPE = 'operation_notice';

export type OperationNoticeTone = 'info' | 'success' | 'error';

export interface OperationNoticePayload {
  message: string;
  title?: string;
  tone?: OperationNoticeTone;
}

interface OperationNoticeOptions {
  title?: string;
  tone?: OperationNoticeTone;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isOperationNoticeTone = (value: unknown): value is OperationNoticeTone =>
  value === 'info' || value === 'success' || value === 'error';

export const showOperationNotice = (
  openPopup: (type: string, data?: unknown) => void,
  message: string,
  options?: OperationNoticeOptions
): void => {
  const normalizedMessage = message.trim();
  if (normalizedMessage.length < 1) {
    return;
  }

  const normalizedTitle =
    typeof options?.title === 'string' && options.title.trim().length > 0
      ? options.title.trim()
      : undefined;

  openPopup(OPERATION_NOTICE_POPUP_TYPE, {
    message: normalizedMessage,
    title: normalizedTitle,
    tone: options?.tone,
  } satisfies OperationNoticePayload);
};

export const toOperationNoticePayload = (value: unknown): OperationNoticePayload | null => {
  if (!isRecord(value)) {
    return null;
  }

  const message = typeof value.message === 'string' ? value.message.trim() : '';
  if (message.length < 1) {
    return null;
  }

  const title =
    typeof value.title === 'string' && value.title.trim().length > 0 ? value.title.trim() : undefined;
  const tone = isOperationNoticeTone(value.tone) ? value.tone : undefined;

  return {
    message,
    title,
    tone,
  };
};
