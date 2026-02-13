import { create } from 'zustand';
import type { CommandUpdatePayload } from '@/types';

export interface CommandStoreState {
  commands: CommandUpdatePayload[];
  setCommands: (cmds: CommandUpdatePayload[]) => void;
  getLatestCommand: () => CommandUpdatePayload | null;
}

export const useCommandStore = create<CommandStoreState>((set, get) => ({
  commands: [],
  setCommands: (cmds) => set({ commands: [...cmds] }),
  getLatestCommand: () => {
    const { commands } = get();
    return commands.length > 0 ? commands[commands.length - 1] : null;
  },
}));
