import Phaser from 'phaser';

export interface BuildingEffectContext {
  scene: Phaser.Scene;
  container: Phaser.GameObjects.Container;
  width: number;
  height: number;
  accentColor: number;
}

export interface BuildingWorkingEffects {
  stop: () => void;
}

interface LightEffectResult {
  light: Phaser.GameObjects.Arc;
  tween: Phaser.Tweens.Tween;
}

interface FlagEffectResult {
  flag: Phaser.GameObjects.Container;
  tween: Phaser.Tweens.Tween;
}

export const createSmokeParticles = (context: BuildingEffectContext): Phaser.Time.TimerEvent => {
  const { scene, container, width, height } = context;

  return scene.time.addEvent({
    delay: 240,
    loop: true,
    callback: () => {
      if (!container.active) {
        return;
      }

      const puff = scene.add.circle(
        Phaser.Math.FloatBetween(-width * 0.18, width * 0.18),
        -height * 0.34,
        Phaser.Math.FloatBetween(2.5, 4),
        0x64748b,
        0.52
      );

      container.add(puff);

      scene.tweens.add({
        targets: puff,
        x: puff.x + Phaser.Math.FloatBetween(-8, 8),
        y: puff.y - Phaser.Math.FloatBetween(18, 34),
        alpha: 0,
        scaleX: Phaser.Math.FloatBetween(1.6, 2.2),
        scaleY: Phaser.Math.FloatBetween(1.6, 2.2),
        duration: Phaser.Math.Between(850, 1300),
        ease: 'Sine.Out',
        onComplete: () => puff.destroy(),
      });
    },
  });
};

export const createBlinkingLight = (context: BuildingEffectContext): LightEffectResult => {
  const { scene, container, width, height, accentColor } = context;

  const light = scene.add.circle(width * 0.26, -height * 0.16, 4, accentColor, 0.5);
  container.add(light);

  const tween = scene.tweens.add({
    targets: light,
    alpha: { from: 0.24, to: 0.95 },
    scaleX: { from: 0.75, to: 1.22 },
    scaleY: { from: 0.75, to: 1.22 },
    duration: 430,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.InOut',
  });

  return { light, tween };
};

export const createFlagEffect = (context: BuildingEffectContext): FlagEffectResult => {
  const { scene, container, width, height, accentColor } = context;

  const flag = scene.add.container(width * 0.32, -height * 0.42);
  const pole = scene.add.rectangle(0, 6, 2, 20, 0x7c2d12, 0.95).setOrigin(0.5, 1);
  const banner = scene.add.rectangle(2, -12, 13, 7, accentColor, 0.94).setOrigin(0, 0.5);

  flag.add([pole, banner]);
  container.add(flag);

  const tween = scene.tweens.add({
    targets: banner,
    scaleX: { from: 0.84, to: 1.06 },
    scaleY: { from: 1.0, to: 0.84 },
    angle: { from: -2, to: 2 },
    duration: 380,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.InOut',
  });

  return { flag, tween };
};

export const createFireworkParticles = (context: BuildingEffectContext): void => {
  const { scene, container, width, height, accentColor } = context;

  for (let burst = 0; burst < 3; burst += 1) {
    scene.time.delayedCall(burst * 160, () => {
      if (!container.active) {
        return;
      }

      const originX = Phaser.Math.FloatBetween(-width * 0.18, width * 0.18);
      const originY = -height * 0.56;
      const particleCount = 14;

      for (let index = 0; index < particleCount; index += 1) {
        const angle = (Math.PI * 2 * index) / particleCount;
        const travel = Phaser.Math.FloatBetween(24, 58);
        const particle = scene.add.circle(
          originX,
          originY,
          Phaser.Math.FloatBetween(1.3, 2.8),
          accentColor,
          0.95
        );

        container.add(particle);

        scene.tweens.add({
          targets: particle,
          x: originX + Math.cos(angle) * travel,
          y: originY + Math.sin(angle) * travel - Phaser.Math.FloatBetween(8, 22),
          alpha: 0,
          scaleX: 0.4,
          scaleY: 0.4,
          duration: Phaser.Math.Between(620, 980),
          ease: 'Cubic.Out',
          onComplete: () => particle.destroy(),
        });
      }
    });
  }
};

export const startBuildingWorkingEffects = (
  context: BuildingEffectContext
): BuildingWorkingEffects => {
  const smokeTimer = createSmokeParticles(context);
  const lightEffect = createBlinkingLight(context);
  const flagEffect = createFlagEffect(context);

  return {
    stop: () => {
      smokeTimer.remove(false);
      lightEffect.tween.stop();
      flagEffect.tween.stop();
      lightEffect.light.destroy();
      flagEffect.flag.destroy();
    },
  };
};

export const playBuildingCompletionEffects = (context: BuildingEffectContext): void => {
  createFireworkParticles(context);
};
