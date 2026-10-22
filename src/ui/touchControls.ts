import { rollAngle, tiltSteer } from '../core/tilt';
import { STEER_RADIUS_PX, knobOffset, steerFromDrag } from '../core/touch';
import type { DriverInput } from '../sim/vehicle';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

/** 画面のボタンから呼べる操作（キーボードの単発キーに相当） */
export interface TouchAction {
  label: () => string;
  run: () => void;
  /** false を返す間は出さない */
  visible?: () => boolean;
}

/** ハンドルの操作方法: 画面をなぞる／スマホを傾ける */
export type SteerMode = 'drag' | 'tilt';

const STEER_MODE_KEY = 'car-game:steer';
/** 傾きハンドルを滑らかにする強さ（センサーの値が届くたびに、この割合だけ新しい値に寄せる） */
const TILT_SMOOTHING = 0.35;
/** 傾きハンドルを ON にしてから、これ [ms] 待ってもセンサーの値が来なければ使えないとみなす */
const TILT_WAIT_MS = 1000;

/** iOS 13 以降は、傾きセンサーを使う前にユーザーの許可が要る */
type MotionPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

function loadSteerMode(): SteerMode {
  try {
    return localStorage.getItem(STEER_MODE_KEY) === 'tilt' ? 'tilt' : 'drag';
  } catch {
    return 'drag';
  }
}

function saveSteerMode(mode: SteerMode): void {
  try {
    localStorage.setItem(STEER_MODE_KEY, mode);
  } catch {
    // 保存できなくても動作には影響しない
  }
}

function needsMotionPermission(): boolean {
  return typeof (window.DeviceMotionEvent as unknown as MotionPermission | undefined)?.requestPermission === 'function';
}

/** ペダルから指がこれ [px] 以上離れていたら、離したとみなす */
const PEDAL_MARGIN_PX = 48;

/**
 * 残っている指のどれかがボタンの上（周り margin を含む）にあるか。
 * 指を離したのにブラウザが pointerup を送ってこないときに、押しっぱなしにならないよう確かめる
 */
export function anyTouchInside(
  rect: { left: number; top: number; right: number; bottom: number },
  touches: Iterable<{ clientX: number; clientY: number }>,
  margin = PEDAL_MARGIN_PX,
): boolean {
  for (const t of touches) {
    if (t.clientX >= rect.left - margin && t.clientX <= rect.right + margin && t.clientY >= rect.top - margin && t.clientY <= rect.bottom + margin) {
      return true;
    }
  }
  return false;
}

/** タッチ操作できる端末か（スマホ・タブレット） */
export function prefersTouch(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

/**
 * スマホ向けの操作画面。左下をなぞってハンドル、右下のボタンでアクセル・ブレーキ、
 * 上のボタンでカメラ・リセット、☰ でメニュー（GameMenu）を開く。
 */
export class TouchControls {
  private readonly root = el('touch');
  private readonly steerZone = el('touch-steer');
  private readonly steerBase = el('touch-steer-base');
  private readonly steerKnob = el('touch-steer-knob');
  private readonly steerHint = el('touch-steer-hint');
  private readonly accel = el('touch-accel');
  private readonly brake = el('touch-brake');
  private readonly quickButtons: { action: TouchAction; button: HTMLButtonElement }[] = [];
  private steerPointer: { id: number; x: number } | null = null;
  private steer = 0;
  private readonly pedalPointers = { accel: new Set<number>(), brake: new Set<number>() };
  private enabledValue = true;
  private shown = false;
  private mode: SteerMode = 'drag';
  /** 傾きセンサーの最新の角度（まだ届いていない、または平らで測れないときは null） */
  private tiltAngle: number | null = null;
  /** まっすぐ走るときの持ち方の角度（null なら次に届いた値を基準にする） */
  private tiltNeutral: number | null = null;
  private tiltListening = false;

  constructor(actions: TouchAction[], onMenu: () => void) {
    const quickBar = el('touch-quick');
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', () => {
        action.run();
        this.refresh();
      });
      quickBar.appendChild(button);
      this.quickButtons.push({ action, button });
    }
    el('touch-menu-button').addEventListener('click', () => {
      this.releaseAll();
      onMenu();
    });

    this.steerZone.addEventListener('pointerdown', (e) => {
      if (this.steerPointer || !this.enabledValue) return;
      e.preventDefault();
      if (this.mode === 'tilt') {
        // 傾きハンドルのときは、触れたときの持ち方を「まっすぐ」にする
        this.recenterTilt();
        return;
      }
      this.steerZone.setPointerCapture(e.pointerId);
      this.steerPointer = { id: e.pointerId, x: e.clientX };
      // 指を置いた場所にハンドルを出す
      const zone = this.steerZone.getBoundingClientRect();
      this.steerBase.style.left = `${e.clientX - zone.left}px`;
      this.steerBase.style.top = `${e.clientY - zone.top}px`;
      this.steerZone.classList.add('active');
      this.setSteer(0);
    });
    this.steerZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.steerPointer?.id) return;
      this.setSteer(e.clientX - this.steerPointer.x);
    });
    const endSteer = (e: PointerEvent) => {
      if (e.pointerId !== this.steerPointer?.id) return;
      this.releaseSteer();
    };
    this.steerZone.addEventListener('pointerup', endSteer);
    this.steerZone.addEventListener('pointercancel', endSteer);

    this.bindPedal(this.accel, this.pedalPointers.accel);
    this.bindPedal(this.brake, this.pedalPointers.brake);
    // 指を離したのに pointerup が届かず、アクセルが押しっぱなしになることがある（iPhone の Safari など）。
    // 指の数が変わるたびに、残っている指でペダルを確かめ直す
    const recheck = (e: TouchEvent) => this.recheckPedals(e.touches);
    window.addEventListener('touchend', recheck, { capture: true, passive: true });
    window.addEventListener('touchcancel', recheck, { capture: true, passive: true });
    // ボタンが取りこぼしても、どこかで指が離れたらそのペダルを離す
    const forget = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      this.releasePointer(e.pointerId);
    };
    window.addEventListener('pointerup', forget, { capture: true });
    window.addEventListener('pointercancel', forget, { capture: true });
    // 別のアプリや通知に切り替わったときも離したことにする
    document.addEventListener('visibilitychange', () => document.hidden && this.releaseAll());
    window.addEventListener('blur', () => this.releaseAll());
    window.addEventListener('pagehide', () => this.releaseAll());
    // 長押しでメニュー（コピー等）や拡大鏡が出ないように
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    // 画面の向きが変わったら持ち方も変わるので、基準を取り直す
    window.addEventListener('orientationchange', () => this.recenterTilt());
    screen.orientation?.addEventListener?.('change', () => this.recenterTilt());

    // 前回「傾ける」にしていたら続けて使う。iOS は許可を求めるのに画面に触れる必要があるので、最初に触れたときに
    if (loadSteerMode() === 'tilt') {
      this.applyMode('tilt');
      if (needsMotionPermission()) {
        const resume = () => {
          window.removeEventListener('touchend', resume);
          void this.setSteerMode('tilt');
        };
        window.addEventListener('touchend', resume);
      } else {
        this.listenTilt();
      }
    }
    // ボタンの文字は、作った側の準備ができてから refresh() で入れる（label がこのインスタンスを参照できるように）
  }

  get steerMode(): SteerMode {
    return this.mode;
  }

  /**
   * ハンドルの操作方法を切り替える。傾きセンサーが使えない・許可されなかったときは
   * 「なぞる」のままにして false を返す。iOS では画面に触れた操作の中から呼ぶこと。
   */
  async setSteerMode(mode: SteerMode): Promise<boolean> {
    if (mode === 'drag') {
      this.applyMode('drag');
      saveSteerMode('drag');
      return true;
    }
    const permission = (window.DeviceMotionEvent as unknown as MotionPermission | undefined)?.requestPermission;
    if (!window.DeviceMotionEvent) return this.tiltUnavailable();
    if (permission) {
      try {
        if ((await permission()) !== 'granted') return this.tiltUnavailable();
      } catch {
        return this.tiltUnavailable();
      }
    }
    this.listenTilt();
    this.recenterTilt();
    // センサーの無いパソコンでも DeviceMotionEvent はあるので、値が届くかで判断する
    for (let waited = 0; this.tiltAngle === null && waited < TILT_WAIT_MS; waited += 50) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (this.tiltAngle === null) return this.tiltUnavailable();
    this.applyMode('tilt');
    saveSteerMode('tilt');
    return true;
  }

  /** 今の持ち方を「まっすぐ」にする */
  recenterTilt(): void {
    this.tiltNeutral = null;
    if (this.mode === 'tilt') this.setTiltSteer(0);
  }

  private tiltUnavailable(): false {
    this.applyMode('drag');
    saveSteerMode('drag');
    return false;
  }

  private applyMode(mode: SteerMode): void {
    this.releaseSteer();
    this.mode = mode;
    // なぞるときに指の位置へ動かしたハンドルを、決まった位置に戻す
    this.steerBase.style.left = '';
    this.steerBase.style.top = '';
    this.root.classList.toggle('tilt', mode === 'tilt');
    this.steerHint.textContent = mode === 'tilt' ? '傾けてハンドル・タップでまっすぐに合わせる' : '左右になぞってハンドル';
  }

  private listenTilt(): void {
    if (this.tiltListening) return;
    this.tiltListening = true;
    window.addEventListener('devicemotion', (e) => {
      const g = e.accelerationIncludingGravity;
      if (g?.x == null || g.y == null) return;
      this.tiltAngle = rollAngle(g.x, g.y);
      if (this.mode !== 'tilt' || this.tiltAngle === null) return;
      this.tiltNeutral ??= this.tiltAngle;
      const target = tiltSteer(this.tiltAngle, this.tiltNeutral);
      this.setTiltSteer(this.steer + (target - this.steer) * TILT_SMOOTHING);
    });
  }

  private setTiltSteer(steer: number): void {
    this.steer = Math.abs(steer) < 0.01 ? 0 : steer;
    // つまみは「今どれだけ切っているか」を表す（右に切ると右へ）
    this.steerKnob.style.transform = `translateX(${-this.steer * STEER_RADIUS_PX}px)`;
  }

  /** 操作画面を出す（一度出したら出しっぱなし） */
  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.root.classList.remove('hidden');
    document.body.classList.add('touch');
  }

  get isShown(): boolean {
    return this.shown;
  }

  /** false の間は指を離したことにする（入力欄のある画面を開いているときなど） */
  set enabled(on: boolean) {
    this.enabledValue = on;
    if (!on) this.releaseAll();
  }

  read(): DriverInput {
    if (!this.enabledValue) return { throttle: 0, brake: 0, steer: 0 };
    return {
      throttle: this.pedalPointers.accel.size > 0 ? 1 : 0,
      brake: this.pedalPointers.brake.size > 0 ? 1 : 0,
      steer: this.steerInput(),
    };
  }

  /** ボタンの表示（ON/OFF など）を今の状態に合わせる */
  refresh(): void {
    for (const { action, button } of this.quickButtons) {
      button.textContent = action.label();
      button.classList.toggle('hidden', action.visible?.() === false);
    }
  }

  /** 残っている指がどれもペダルの上になければ、そのペダルを離す */
  private recheckPedals(touches: TouchList): void {
    const list = Array.from(touches);
    for (const [button, pointers] of [
      [this.accel, this.pedalPointers.accel],
      [this.brake, this.pedalPointers.brake],
    ] as const) {
      if (pointers.size === 0) continue;
      if (list.length > 0 && anyTouchInside(button.getBoundingClientRect(), list)) continue;
      pointers.clear();
      button.classList.remove('pressed');
    }
    if (list.length === 0 && this.steerPointer) this.releaseSteer();
  }

  private releasePointer(id: number): void {
    for (const [button, pointers] of [
      [this.accel, this.pedalPointers.accel],
      [this.brake, this.pedalPointers.brake],
    ] as const) {
      if (pointers.delete(id) && pointers.size === 0) button.classList.remove('pressed');
    }
  }

  private bindPedal(button: HTMLElement, pointers: Set<number>): void {
    button.addEventListener('pointerdown', (e) => {
      if (!this.enabledValue) return;
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      pointers.add(e.pointerId);
      button.classList.add('pressed');
    });
    const release = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) button.classList.remove('pressed');
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  }

  private setSteer(dx: number): void {
    this.steer = steerFromDrag(dx);
    this.steerKnob.style.transform = `translateX(${knobOffset(dx)}px)`;
  }

  private releaseSteer(): void {
    this.steerPointer = null;
    this.steerZone.classList.remove('active');
    this.setSteer(0);
  }

  /** 傾きハンドルで、まだ傾きを測れていない（平らに置いている等）間はまっすぐ */
  private steerInput(): number {
    if (this.mode === 'tilt' && this.tiltAngle === null) return 0;
    return this.steer;
  }

  private releaseAll(): void {
    this.releaseSteer();
    this.pedalPointers.accel.clear();
    this.pedalPointers.brake.clear();
    this.accel.classList.remove('pressed');
    this.brake.classList.remove('pressed');
  }
}
