import Phaser from 'phaser';

import type { AshigaruState, Position, TaskCategory } from '@/types';

import {
  type CharacterVisualState,
  getAshigaruProfile,
  getRankVisual,
  getStatusColor,
  getStatusRingColor,
} from './CharacterConfig';
import { CharacterEffects } from './CharacterEffects';

export interface MoveOptions {
  duration: number;
  ease?: string;
}

export interface CharacterRuntimeState {
  status: CharacterVisualState;
  taskCategory: TaskCategory;
  taskId: string | null;
}

const STATUS_LABEL_COLOR: Record<CharacterVisualState, string> = {
  idle: '#e6eefc',
  assigned: '#d3ebff',
  working: '#e4ffda',
  done: '#fff4c2',
  failed: '#ffc3c3',
  blocked: '#ff9e9e',
  offline: '#c8c8c8',
};

export class AshigaruSprite extends Phaser.GameObjects.Container {
  readonly ashigaruId: string;

  private readonly avatarBody: Phaser.GameObjects.Graphics;
  private readonly avatarAura: Phaser.GameObjects.Graphics;
  private readonly avatarNumber: Phaser.GameObjects.Text;
  private readonly nameLabel: Phaser.GameObjects.Text;
  private readonly stateLabel: Phaser.GameObjects.Text;
  private readonly effects: CharacterEffects;

  private moveTween?: Phaser.Tweens.Tween;
  private breathingTween?: Phaser.Tweens.Tween;
  private pulseTween?: Phaser.Tweens.Tween;
  private visualRank = 1;
  private runtimeState: CharacterRuntimeState;
  private internalState: AshigaruState;

  constructor(scene: Phaser.Scene, initialState: AshigaruState) {
    super(scene, initialState.position.x, initialState.position.y);

    this.ashigaruId = initialState.id;
    this.internalState = initialState;
    this.runtimeState = {
      status: 'idle',
      taskCategory: initialState.taskCategory,
      taskId: initialState.taskId,
    };

    this.avatarAura = scene.add.graphics();
    this.avatarBody = scene.add.graphics();

    const profile = getAshigaruProfile(initialState.id);
    this.avatarNumber = scene.add
      .text(0, -1, String(profile.index || 0), {
        fontFamily: 'monospace',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#111111',
      })
      .setOrigin(0.5);

    this.nameLabel = scene.add
      .text(0, 26, initialState.name || profile.name, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#f4f4f4',
      })
      .setOrigin(0.5);

    this.stateLabel = scene.add
      .text(0, -28, 'idle', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: STATUS_LABEL_COLOR.idle,
      })
      .setOrigin(0.5);

    this.add([
      this.avatarAura,
      this.avatarBody,
      this.avatarNumber,
      this.nameLabel,
      this.stateLabel,
    ]);
    this.setSize(54, 66);
    this.setDepth(this.y);
    this.scene.add.existing(this);

    this.effects = new CharacterEffects(scene, this);
    this.applyVisualState('idle');
  }

  getState(): AshigaruState {
    return this.internalState;
  }

  setTaskContext(taskCategory: TaskCategory, taskId: string | null): void {
    this.runtimeState.taskCategory = taskCategory;
    this.runtimeState.taskId = taskId;
    this.internalState = {
      ...this.internalState,
      taskCategory,
      taskId,
    };
  }

  setRank(rank: number): void {
    this.visualRank = Math.max(1, Math.floor(rank));
    this.redrawAvatar(this.runtimeState.status);
  }

  applyVisualState(status: CharacterVisualState): void {
    this.stopStateTweens();
    this.effects.stopWorkingEffect();

    this.runtimeState.status = status;
    this.stateLabel.setText(status);
    this.stateLabel.setColor(STATUS_LABEL_COLOR[status]);
    this.redrawAvatar(status);

    if (status === 'idle') {
      this.playIdlePose();
      return;
    }

    if (status === 'assigned') {
      this.pulseTween = this.scene.tweens.add({
        targets: this.avatarBody,
        alpha: 0.55,
        duration: 220,
        yoyo: true,
        repeat: -1,
      });
      return;
    }

    if (status === 'working') {
      this.effects.startWorkingEffect();
      this.breathingTween = this.scene.tweens.add({
        targets: this,
        y: this.y - 2,
        duration: 320,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
      return;
    }

    if (status === 'done') {
      this.effects.playCompletionStars();
      this.playIdlePose();
      return;
    }

    if (status === 'failed' || status === 'blocked') {
      this.effects.playFailureFlash();
      return;
    }
  }

  moveToPosition(target: Position, options: MoveOptions): Promise<void> {
    const from = { x: this.x, y: this.y };
    this.effects.playFootsteps(from, target, 0x2f2f2f);

    if (this.moveTween) {
      this.moveTween.stop();
      this.moveTween = undefined;
    }

    return new Promise((resolve) => {
      this.moveTween = this.scene.tweens.add({
        targets: this,
        x: target.x,
        y: target.y,
        duration: options.duration,
        ease: options.ease ?? 'Quadratic.InOut',
        onUpdate: () => this.setDepth(this.y),
        onComplete: () => {
          this.moveTween = undefined;
          this.internalState = {
            ...this.internalState,
            position: { x: target.x, y: target.y },
          };
          this.playIdlePose();
          resolve();
        },
        onStop: () => {
          this.moveTween = undefined;
          resolve();
        },
      });
    });
  }

  playIdlePose(): void {
    this.breathingTween?.stop();
    const baseY = this.internalState.position.y;
    this.breathingTween = this.scene.tweens.add({
      targets: this,
      y: baseY - 1,
      duration: 520,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.InOut',
      onComplete: () => {
        this.y = baseY;
      },
    });
  }

  override destroy(fromScene?: boolean): void {
    this.stopStateTweens();
    this.effects.destroy();
    super.destroy(fromScene);
  }

  private redrawAvatar(status: CharacterVisualState): void {
    const profile = getAshigaruProfile(this.ashigaruId);
    const rankVisual = getRankVisual(this.visualRank);

    this.avatarAura.clear();
    this.avatarAura.fillStyle(profile.accentColor, rankVisual.auraAlpha);
    this.avatarAura.fillCircle(0, 0, 18 * rankVisual.scale);

    this.avatarBody.clear();
    this.avatarBody.fillStyle(getStatusColor(profile.baseColor, status), 1);
    this.avatarBody.fillCircle(0, 0, 14 * rankVisual.scale);
    this.avatarBody.lineStyle(rankVisual.strokeWidth, getStatusRingColor(status), 1);
    this.avatarBody.strokeCircle(0, 0, 16 * rankVisual.scale);
  }

  private stopStateTweens(): void {
    this.pulseTween?.stop();
    this.pulseTween = undefined;
    this.breathingTween?.stop();
    this.breathingTween = undefined;
  }
}
