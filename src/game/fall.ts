import type { Car, CarSnapshot } from '../sim/car';
import type { Level } from './level';

/** 崖から落ちてから道路に戻されるまでの時間 [s] */
export const FALL_SECONDS = 1.2;
const GRAVITY = 9.81;

/**
 * 峠で道路から落ちた車。落ちている間は操作できず、見た目だけ下へ落ちていき、
 * 少し経つと落ちた地点の手前の道路に止まった状態で戻される（その分タイムを失う）。
 */
export class FallRecovery {
  /** 落ち始めてからの時間 [s]（落ちていなければ負） */
  private elapsed = -1;

  get falling(): boolean {
    return this.elapsed >= 0;
  }

  /** 見た目の高さを下げる量 [m] */
  get drop(): number {
    return this.falling ? 0.5 * GRAVITY * this.elapsed * this.elapsed : 0;
  }

  /** 物理ステップの後に呼ぶ。落ち始めたら 'fell'、道路に戻したら 'recovered' */
  update(dt: number, level: Level, car: Car, s: CarSnapshot): 'fell' | 'recovered' | null {
    if (!this.falling) {
      if (!level.fellOff(s.x, s.z)) return null;
      this.elapsed = 0;
      return 'fell';
    }
    this.elapsed += dt;
    if (this.elapsed < FALL_SECONDS) return null;
    car.reset(level.recoverySpot(s.x, s.z));
    this.elapsed = -1;
    return 'recovered';
  }

  cancel(): void {
    this.elapsed = -1;
  }
}
