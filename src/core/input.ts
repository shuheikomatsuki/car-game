import type { DriverInput } from '../sim/vehicle';

const THROTTLE_KEYS = ['KeyW', 'ArrowUp'];
const BRAKE_KEYS = ['KeyS', 'ArrowDown', 'Space'];
const LEFT_KEYS = ['KeyA', 'ArrowLeft'];
const RIGHT_KEYS = ['KeyD', 'ArrowRight'];
const DRIVING_KEYS = new Set([...THROTTLE_KEYS, ...BRAKE_KEYS, ...LEFT_KEYS, ...RIGHT_KEYS]);

/** キーボードから運転入力を作る。単発のキー操作（リセット等）は onAction で受け取る */
export class KeyboardInput {
  private readonly pressed = new Set<string>();
  private readonly actions = new Map<string, () => void>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (DRIVING_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.actions.get(e.code)?.();
      this.pressed.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.pressed.delete(e.code));
    // ウィンドウ外にフォーカスが移ったらキーを離したことにする
    target.addEventListener('blur', () => this.pressed.clear());
  }

  onAction(code: string, handler: () => void): void {
    this.actions.set(code, handler);
  }

  read(): DriverInput {
    const any = (keys: string[]) => keys.some((k) => this.pressed.has(k));
    return {
      throttle: any(THROTTLE_KEYS) ? 1 : 0,
      brake: any(BRAKE_KEYS) ? 1 : 0,
      steer: (any(LEFT_KEYS) ? 1 : 0) - (any(RIGHT_KEYS) ? 1 : 0),
    };
  }
}
