import Phaser from 'phaser';

import type { Position } from '@/types';

interface EffectEntry {
  gameObject: Phaser.GameObjects.GameObject;
  tween?: Phaser.Tweens.Tween;
}

export class CharacterEffects {
  private readonly scene: Phaser.Scene;
  private readonly owner: Phaser.GameObjects.Container;
  private readonly activeEffects: EffectEntry[] = [];
  private workingMarker?: Phaser.GameObjects.Text;
  private workingTween?: Phaser.Tweens.Tween;

  constructor(scene: Phaser.Scene, owner: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.owner = owner;
  }

  private registerTransientEffect(gameObject: Phaser.GameObjects.GameObject): EffectEntry {
    const entry: EffectEntry = { gameObject };
    this.activeEffects.push(entry);
    return entry;
  }

  private releaseTransientEffect(entry: EffectEntry): void {
    const index = this.activeEffects.indexOf(entry);
    if (index >= 0) {
      this.activeEffects.splice(index, 1);
    }
  }

  playFootsteps(from: Position, to: Position, color: number): void {
    const stepCount = 6;
    for (let i = 1; i <= stepCount; i += 1) {
      const t = i / (stepCount + 1);
      const x = Phaser.Math.Linear(from.x, to.x, t) + Phaser.Math.Between(-4, 4);
      const y = Phaser.Math.Linear(from.y, to.y, t) + Phaser.Math.Between(-2, 2);
      const footprint = this.scene.add.circle(x, y, 3, color, 0.45);
      footprint.setDepth(this.owner.depth - 1);
      const entry = this.registerTransientEffect(footprint);
      const tween = this.scene.tweens.add({
        targets: footprint,
        alpha: 0,
        scale: 0.4,
        duration: 380,
        delay: i * 90,
        onComplete: () => {
          this.releaseTransientEffect(entry);
          footprint.destroy();
        },
      });
      entry.tween = tween;
    }
  }

  startWorkingEffect(): void {
    if (this.workingMarker && this.workingTween) {
      return;
    }

    this.workingMarker = this.scene.add
      .text(14, -32, '💦', {
        fontFamily: 'sans-serif',
        fontSize: '14px',
      })
      .setOrigin(0.5)
      .setAlpha(0.9);

    this.owner.add(this.workingMarker);
    this.workingTween = this.scene.tweens.add({
      targets: this.workingMarker,
      y: -38,
      alpha: 0.4,
      duration: 420,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
  }

  stopWorkingEffect(): void {
    if (this.workingTween) {
      this.workingTween.stop();
      this.workingTween = undefined;
    }
    if (this.workingMarker) {
      this.owner.remove(this.workingMarker, true);
      this.workingMarker.destroy();
      this.workingMarker = undefined;
    }
  }

  playCompletionStars(): void {
    const starCount = 7;
    for (let i = 0; i < starCount; i += 1) {
      const theta = (Math.PI * 2 * i) / starCount;
      const star = this.scene.add
        .text(this.owner.x, this.owner.y - 6, '★', {
          fontFamily: 'sans-serif',
          fontSize: '14px',
          color: '#ffe066',
          stroke: '#fff8cc',
          strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setDepth(this.owner.depth + 1);

      const entry = this.registerTransientEffect(star);
      const tween = this.scene.tweens.add({
        targets: star,
        x: this.owner.x + Math.cos(theta) * Phaser.Math.Between(20, 34),
        y: this.owner.y + Math.sin(theta) * Phaser.Math.Between(10, 24) - 12,
        alpha: 0,
        scale: 0.5,
        duration: 520,
        ease: 'Cubic.Out',
        onComplete: () => {
          this.releaseTransientEffect(entry);
          star.destroy();
        },
      });

      entry.tween = tween;
    }
  }

  playFailureFlash(): void {
    const flash = this.scene.add.circle(this.owner.x, this.owner.y - 2, 22, 0xff4b4b, 0);
    flash.setDepth(this.owner.depth + 2);

    const entry = this.registerTransientEffect(flash);
    const tween = this.scene.tweens.add({
      targets: flash,
      alpha: 0.5,
      duration: 110,
      yoyo: true,
      repeat: 2,
      onComplete: () => {
        this.releaseTransientEffect(entry);
        flash.destroy();
      },
    });

    entry.tween = tween;
  }

  clearTransientEffects(): void {
    for (const entry of this.activeEffects) {
      entry.tween?.stop();
      entry.gameObject.destroy();
    }
    this.activeEffects.length = 0;
  }

  destroy(): void {
    this.stopWorkingEffect();
    this.clearTransientEffects();
  }
}
