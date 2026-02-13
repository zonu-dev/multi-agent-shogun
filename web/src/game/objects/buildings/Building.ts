import Phaser from 'phaser';
import type { BuildingLevel, BuildingType, Position } from '../../../types/game';
import {
  clampBuildingLevel,
  getBuildingConfig,
  getBuildingLevelVisual,
  mixColors,
  scaleColorBrightness,
} from './BuildingConfig';
import {
  playBuildingCompletionEffects,
  startBuildingWorkingEffects,
  type BuildingWorkingEffects,
} from './BuildingEffects';

export interface BuildingClickPayload {
  type: BuildingType;
  level: BuildingLevel;
  position: Position;
}

export class Building extends Phaser.GameObjects.Container {
  public readonly type: BuildingType;

  private readonly config: ReturnType<typeof getBuildingConfig>;
  private level: BuildingLevel;
  private isoPosition: Position;
  private isWorking: boolean;
  private currentWidth: number;
  private currentHeight: number;

  private readonly bodyGraphics: Phaser.GameObjects.Graphics;
  private readonly ornamentLayer: Phaser.GameObjects.Container;
  private readonly effectsLayer: Phaser.GameObjects.Container;
  private readonly emojiText: Phaser.GameObjects.Text;
  private readonly levelText: Phaser.GameObjects.Text;

  private workingEffects: BuildingWorkingEffects | null;
  private readonly sparkleTweens: Phaser.Tweens.Tween[] = [];

  constructor(scene: Phaser.Scene, type: BuildingType, level: BuildingLevel, position: Position) {
    super(scene, position.x, position.y);

    this.type = type;
    this.config = getBuildingConfig(type);
    this.level = clampBuildingLevel(level);
    this.isoPosition = { ...position };
    this.isWorking = false;
    this.currentWidth = 0;
    this.currentHeight = 0;
    this.workingEffects = null;

    this.bodyGraphics = scene.add.graphics();
    this.ornamentLayer = scene.add.container(0, 0);
    this.effectsLayer = scene.add.container(0, 0);
    this.emojiText = scene.add
      .text(0, 0, this.config.emoji, {
        fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
        fontSize: '28px',
        color: '#ffffff',
        stroke: '#0f172a',
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    this.levelText = scene.add
      .text(0, 0, `Lv.${this.level}`, {
        fontFamily: '"Trebuchet MS", sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#111827',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    this.add([
      this.bodyGraphics,
      this.ornamentLayer,
      this.effectsLayer,
      this.levelText,
      this.emojiText,
    ]);
    scene.add.existing(this);

    this.renderBuilding();
    this.bindInput();
  }

  public getLevel(): BuildingLevel {
    return this.level;
  }

  public getIsoPosition(): Position {
    return { ...this.isoPosition };
  }

  public setLevel(level: BuildingLevel): void {
    const nextLevel = clampBuildingLevel(level);

    if (nextLevel === this.level) {
      return;
    }

    this.level = nextLevel;
    this.renderBuilding();
  }

  public setIsoPosition(position: Position): void {
    this.isoPosition = { ...position };
    this.setPosition(position.x, position.y);
    this.setDepth(position.y + this.level * 0.01);
    this.syncInputPriority();
  }

  public setWorking(isWorking: boolean): void {
    if (this.isWorking === isWorking) {
      return;
    }

    this.isWorking = isWorking;

    if (isWorking) {
      this.startWorkingEffects();
      return;
    }

    this.stopWorkingEffects();
  }

  public playCompletionEffect(): void {
    this.stopWorkingEffects();

    playBuildingCompletionEffects({
      scene: this.scene,
      container: this.effectsLayer,
      width: this.currentWidth,
      height: this.currentHeight,
      accentColor: mixColors(this.config.color, 0xffffff, 0.25),
    });
  }

  public override destroy(fromScene?: boolean): void {
    this.clearSparkleTweens();
    this.stopWorkingEffects();
    super.destroy(fromScene);
  }

  private bindInput(): void {
    this.refreshHitArea();

    this.on(
      'pointerdown',
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData
      ) => {
        event.stopPropagation();
        this.emit('building:click', {
          type: this.type,
          level: this.level,
          position: { ...this.isoPosition },
        } satisfies BuildingClickPayload);
      }
    );
  }

  private renderBuilding(): void {
    const visual = getBuildingLevelVisual(this.level);
    const baseColor = scaleColorBrightness(this.config.color, visual.brightness);
    const topColor = visual.useGradient ? mixColors(baseColor, 0xffffff, 0.22) : baseColor;
    const bottomColor = visual.useGradient ? mixColors(baseColor, 0x000000, 0.18) : baseColor;

    this.currentWidth = Math.round(this.config.baseSize.width * visual.scale);
    this.currentHeight = Math.round(this.config.baseSize.height * visual.scale);

    this.bodyGraphics.clear();

    if (visual.useGradient) {
      this.bodyGraphics.fillGradientStyle(
        topColor,
        topColor,
        bottomColor,
        bottomColor,
        visual.alpha
      );
    } else {
      this.bodyGraphics.fillStyle(baseColor, visual.alpha);
    }

    const left = -this.currentWidth / 2;
    const top = -this.currentHeight / 2;
    const cornerRadius = Math.max(6, Math.floor(this.currentWidth * 0.12));

    this.bodyGraphics.fillRoundedRect(
      left,
      top,
      this.currentWidth,
      this.currentHeight,
      cornerRadius
    );

    if (visual.showBorder) {
      this.bodyGraphics.lineStyle(
        visual.borderThickness,
        mixColors(baseColor, 0xffffff, 0.32),
        0.95
      );
      this.bodyGraphics.strokeRoundedRect(
        left,
        top,
        this.currentWidth,
        this.currentHeight,
        cornerRadius
      );
    }

    this.drawOrnaments(visual.showOrnaments, visual.showSparkle, baseColor);
    this.updateTexts();
    this.refreshHitArea();
    this.setDepth(this.isoPosition.y + this.level * 0.01);
    this.syncInputPriority();

    if (this.isWorking) {
      this.startWorkingEffects();
    }
  }

  private drawOrnaments(showOrnaments: boolean, showSparkle: boolean, baseColor: number): void {
    this.clearSparkleTweens();
    this.ornamentLayer.removeAll(true);

    if (showOrnaments) {
      const trimColor = mixColors(baseColor, 0xffffff, 0.36);
      const roofTrim = this.scene.add
        .rectangle(0, -this.currentHeight * 0.36, this.currentWidth * 0.74, 6, trimColor, 0.95)
        .setOrigin(0.5);
      const sideLeft = this.scene.add
        .rectangle(
          -this.currentWidth * 0.32,
          -this.currentHeight * 0.02,
          4,
          this.currentHeight * 0.56,
          trimColor,
          0.62
        )
        .setOrigin(0.5);
      const sideRight = this.scene.add
        .rectangle(
          this.currentWidth * 0.32,
          -this.currentHeight * 0.02,
          4,
          this.currentHeight * 0.56,
          trimColor,
          0.62
        )
        .setOrigin(0.5);

      this.ornamentLayer.add([roofTrim, sideLeft, sideRight]);
    }

    if (showSparkle) {
      const sparkleColor = '#fde68a';
      const sparkles = [
        this.scene.add
          .text(-this.currentWidth * 0.24, -this.currentHeight * 0.58, '✦', {
            fontFamily: '"Trebuchet MS", sans-serif',
            fontSize: '14px',
            color: sparkleColor,
            stroke: '#7c2d12',
            strokeThickness: 2,
          })
          .setOrigin(0.5),
        this.scene.add
          .text(this.currentWidth * 0.26, -this.currentHeight * 0.62, '✦', {
            fontFamily: '"Trebuchet MS", sans-serif',
            fontSize: '13px',
            color: sparkleColor,
            stroke: '#7c2d12',
            strokeThickness: 2,
          })
          .setOrigin(0.5),
      ];

      sparkles.forEach((sparkle, index) => {
        const tween = this.scene.tweens.add({
          targets: sparkle,
          alpha: { from: 0.28, to: 1 },
          yoyo: true,
          repeat: -1,
          duration: 520 + index * 120,
          delay: index * 140,
          ease: 'Sine.InOut',
        });
        this.sparkleTweens.push(tween);
      });

      this.ornamentLayer.add(sparkles);
    }
  }

  private clearSparkleTweens(): void {
    if (this.sparkleTweens.length === 0) {
      return;
    }

    for (const tween of this.sparkleTweens) {
      tween.stop();
      this.scene.tweens.killTweensOf(tween.targets);
    }
    this.sparkleTweens.length = 0;
  }

  private updateTexts(): void {
    const emojiSize = Math.max(22, Math.round(this.currentWidth * 0.34));

    this.emojiText
      .setFontSize(`${emojiSize}px`)
      .setPosition(0, -this.currentHeight * 0.63)
      .setAlpha(this.level === 1 ? 0.8 : 1);

    this.levelText
      .setText(`Lv.${this.level}`)
      .setColor(this.level === 5 ? '#fde68a' : '#ffffff')
      .setPosition(0, this.currentHeight * 0.12);
  }

  private refreshHitArea(): void {
    const hitWidth = Math.max(
      this.config.hitArea.minWidth,
      Math.round(this.currentWidth * this.config.hitArea.scaleX)
    );
    const hitHeight = Math.max(
      this.config.hitArea.minHeight,
      Math.round(this.currentHeight * this.config.hitArea.scaleY)
    );
    this.setSize(hitWidth, hitHeight);

    const hitArea = this.input?.hitArea as Phaser.Geom.Rectangle | undefined;

    if (hitArea) {
      hitArea.setTo(0, 0, hitWidth, hitHeight);
    } else {
      this.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, hitWidth, hitHeight),
        Phaser.Geom.Rectangle.Contains
      );
    }

    if (this.input) {
      this.input.cursor = 'pointer';
    }

    this.syncInputPriority();
  }

  private syncInputPriority(): void {
    if (!this.input) {
      return;
    }

    const depthPriority = Math.round(this.depth * 100);
    const interactive = this.input as Phaser.Types.Input.InteractiveObject & {
      priorityID?: number;
    };
    interactive.priorityID = depthPriority + this.config.hitArea.priorityBoost;
  }

  private startWorkingEffects(): void {
    this.stopWorkingEffects();

    this.workingEffects = startBuildingWorkingEffects({
      scene: this.scene,
      container: this.effectsLayer,
      width: this.currentWidth,
      height: this.currentHeight,
      accentColor: mixColors(this.config.color, 0xffffff, 0.3),
    });
  }

  private stopWorkingEffects(): void {
    if (!this.workingEffects) {
      this.effectsLayer.removeAll(true);
      return;
    }

    this.workingEffects.stop();
    this.workingEffects = null;
    this.effectsLayer.removeAll(true);
  }
}
