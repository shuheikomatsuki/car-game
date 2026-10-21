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
  /** false の間はキーを無視する（入力欄のある画面を開いているときなど） */
  private enabledValue = true;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (!this.enabledValue) return;
      if (DRIVING_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.actions.get(e.code)?.();
      this.pressed.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.pressed.delete(e.code));
    // ウィンドウ外にフォーカスが移ったらキーを離したことにする
    target.addEventListener('blur', () => this.pressed.clear());
  }

  set enabled(on: boolean) {
    this.enabledValue = on;
    if (!on) this.pressed.clear();
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

/** ゲームパッドの値として無視する小さな傾き */
const STICK_DEADZONE = 0.12;

function applyDeadzone(v: number): number {
  if (Math.abs(v) < STICK_DEADZONE) return 0; // -0 も 0 にそろえる
  return (Math.sign(v) * (Math.abs(v) - STICK_DEADZONE)) / (1 - STICK_DEADZONE);
}

/** ゲームパッドのボタン番号（Standard Gamepad レイアウト） */
export const PAD_BUTTON = {
  /** A / × */
  south: 0,
  /** Y / △ */
  north: 3,
  leftTrigger: 6,
  rightTrigger: 7,
  /** Back / Select */
  select: 8,
  /** Start / Options */
  start: 9,
} as const;

/**
 * Standard レイアウトのゲームパッド状態を運転入力に変換する。
 * 左スティック = ハンドル、右トリガー（または A）= アクセル、左トリガー = ブレーキ。
 */
export function gamepadToDriverInput(axes: readonly number[], buttons: readonly number[]): DriverInput {
  const button = (i: number) => buttons[i] ?? 0;
  return {
    throttle: Math.max(button(PAD_BUTTON.rightTrigger), button(PAD_BUTTON.south)),
    brake: button(PAD_BUTTON.leftTrigger),
    // スティックは右が正、ハンドル入力は左が正なので反転する
    steer: applyDeadzone(-(axes[0] ?? 0)),
  };
}

/** 接続中のゲームパッドを読む。ボタンの押した瞬間は onButton で受け取る */
export class GamepadInput {
  private readonly prevButtons = new Map<number, boolean>();
  private readonly actions = new Map<number, () => void>();
  private connected = false;

  onButton(index: number, handler: () => void): void {
    this.actions.set(index, handler);
  }

  /** 毎ステップ呼ぶ。ゲームパッドが無ければ null */
  read(): DriverInput | null {
    const pad = navigator.getGamepads?.().find((p) => p?.connected && p.mapping === 'standard');
    this.connected = !!pad;
    if (!pad) return null;
    const values = pad.buttons.map((b) => b.value);
    pad.buttons.forEach((b, i) => {
      if (b.pressed && !this.prevButtons.get(i)) this.actions.get(i)?.();
      this.prevButtons.set(i, b.pressed);
    });
    return gamepadToDriverInput(pad.axes, values);
  }

  get isConnected(): boolean {
    return this.connected;
  }
}

/** キーボードとゲームパッドの入力を合成する（強いほうを採用） */
export function mergeInputs(a: DriverInput, b: DriverInput | null): DriverInput {
  if (!b) return a;
  return {
    throttle: Math.max(a.throttle, b.throttle),
    brake: Math.max(a.brake, b.brake),
    steer: Math.abs(a.steer) >= Math.abs(b.steer) ? a.steer : b.steer,
  };
}
