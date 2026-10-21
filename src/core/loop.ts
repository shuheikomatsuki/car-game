/**
 * 固定タイムステップのゲームループ。
 * シミュレーションは常に一定間隔（既定 60Hz）で進め、描画は端数（alpha）で補間する。
 */
export class FixedStepLoop {
  private accumulator = 0;
  private lastTime: number | null = null;
  private running = false;

  constructor(
    private readonly step: (dt: number) => void,
    private readonly render: (alpha: number, frameDt: number) => void,
    readonly dt = 1 / 60,
    /** 処理落ち時に1フレームで進める最大ステップ数（これを超える遅れは切り捨てる） */
    private readonly maxSteps = 5,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = null;
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
  }

  private frame = (time: number) => {
    if (!this.running) return;
    const now = time / 1000;
    const frameDt = this.lastTime === null ? 0 : Math.min(now - this.lastTime, 0.25);
    this.lastTime = now;

    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= this.dt && steps < this.maxSteps) {
      this.step(this.dt);
      this.accumulator -= this.dt;
      steps++;
    }
    if (steps === this.maxSteps) this.accumulator = 0;

    this.render(this.accumulator / this.dt, frameDt);
    requestAnimationFrame(this.frame);
  };
}
