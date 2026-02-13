import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

function shellEscapeSingleQuoted(text: string): string {
  return text.replace(/'/g, "'\\''");
}

export async function sendTmuxMessage(message: string, targetPane: string): Promise<void> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    throw new Error('Cannot send an empty tmux message.');
  }

  const escapedMessage = shellEscapeSingleQuoted(trimmedMessage);
  await execAsync(`tmux send-keys -t ${targetPane} '${escapedMessage}'`);
  await execAsync(`tmux send-keys -t ${targetPane} Enter`);
}
