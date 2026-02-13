import Phaser from 'phaser';
import type { Types } from 'phaser';
import { BootScene, MainScene } from './scenes';

export const baseGameConfig: Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'phaser-container',
  transparent: true,
  backgroundColor: '#1A1A2E',
  width: 1280,
  height: 720,
  scene: [BootScene, MainScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

export const createGameConfig = (parent: string = 'phaser-container'): Types.Core.GameConfig => {
  return {
    ...baseGameConfig,
    parent,
  };
};
