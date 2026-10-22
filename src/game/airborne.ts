/** 重力加速度 [m/s^2] */
const GRAVITY = 9.81;
/** 地面からこれ以上浮いていたら、タイヤが地面から離れているとみなす [m] */
const AIR_GAP = 0.15;
/** 地面を走っているときに持てる上向きの速さの上限 [m/s]（急な上り段差で跳ね上がらないように） */
const MAX_CLIMB_SPEED = 4;

/**
 * 車の上下の動き（見た目と、浮いているかどうか）。物理は平らなままなので、高さだけをここで計算する。
 *
 * 地面が重力で落ちるより速く下がると（段差・急な下り）車は地面から離れ、放物線を描いて落ちる。
 * 浮いている間はタイヤが効かない（Car.airborne）。
 */
export class Airborne {
  /** 車の高さ [m] */
  private y = 0;
  /** 上下の速さ [m/s] */
  private vy = 0;
  /** 今の地面の高さ */
  private groundY = 0;
  private placed = false;
  /** 少しでも地面から離れているか */
  private offGround = false;

  /** 地面から浮いている高さ [m] */
  get gap(): number {
    return this.placed ? Math.max(0, this.y - this.groundY) : 0;
  }

  /** タイヤが地面から離れているか */
  get inAir(): boolean {
    return this.gap > AIR_GAP;
  }

  /** 物理ステップの後に、車の下の地面の高さを渡す。着地したらそのときの下向きの速さ [m/s] を返す */
  update(dt: number, ground: number): number | null {
    if (!this.placed) {
      this.reset(ground);
      return null;
    }
    const y = this.y + this.vy * dt - 0.5 * GRAVITY * dt * dt;
    const vy = this.vy - GRAVITY * dt;
    this.groundY = ground;
    if (y > ground) {
      this.y = y;
      this.vy = vy;
      this.offGround = true;
      return null;
    }
    // 地面の上: 地面に沿って動く
    const landing = this.offGround ? -vy : null;
    this.offGround = false;
    this.vy = Math.min(MAX_CLIMB_SPEED, (ground - this.y) / dt);
    this.y = ground;
    return landing;
  }

  /** 地面の上に置き直す（コースに戻したときなど） */
  reset(ground: number): void {
    this.y = this.groundY = ground;
    this.vy = 0;
    this.placed = true;
    this.offGround = false;
  }
}
