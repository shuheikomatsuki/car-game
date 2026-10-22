import { knobOffset, steerFromDrag } from '../core/touch';
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
  /** メニューを開かなくても押せるよう、画面の上に常に出す */
  quick?: boolean;
  /** false を返す間はメニューに出さない */
  visible?: () => boolean;
}

/** タッチ操作できる端末か（スマホ・タブレット） */
export function prefersTouch(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

/**
 * スマホ向けの操作画面。左下をなぞってハンドル、右下のボタンでアクセル・ブレーキ、
 * 上のボタンとメニューでカメラ・リセット・マップ切替などを行う。
 */
export class TouchControls {
  private readonly root = el('touch');
  private readonly steerZone = el('touch-steer');
  private readonly steerBase = el('touch-steer-base');
  private readonly steerKnob = el('touch-steer-knob');
  private readonly accel = el('touch-accel');
  private readonly brake = el('touch-brake');
  private readonly menu = el('touch-menu');
  private readonly menuInfo = el('touch-menu-info');
  private readonly menuItems = el('touch-menu-items');
  private readonly menuButtons: { action: TouchAction; button: HTMLButtonElement }[] = [];
  private readonly quickButtons: { action: TouchAction; button: HTMLButtonElement }[] = [];
  private steerPointer: { id: number; x: number } | null = null;
  private steer = 0;
  private readonly pedalPointers = { accel: new Set<number>(), brake: new Set<number>() };
  private enabledValue = true;
  private shown = false;

  constructor(
    actions: TouchAction[],
    private readonly info: () => string,
  ) {
    const quickBar = el('touch-quick');
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', () => {
        if (!action.quick) this.closeMenu();
        action.run();
        this.refresh();
      });
      if (action.quick) {
        quickBar.appendChild(button);
        this.quickButtons.push({ action, button });
      } else {
        this.menuItems.appendChild(button);
        this.menuButtons.push({ action, button });
      }
    }
    el('touch-menu-button').addEventListener('click', () => this.openMenu());
    el('touch-menu-close').addEventListener('click', () => this.closeMenu());
    this.menu.addEventListener('click', (e) => {
      if (e.target === this.menu) this.closeMenu();
    });

    this.steerZone.addEventListener('pointerdown', (e) => {
      if (this.steerPointer || !this.enabledValue) return;
      e.preventDefault();
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
    // 長押しでメニュー（コピー等）や拡大鏡が出ないように
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.refresh();
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
      steer: this.steer,
    };
  }

  /** ボタンの表示（ON/OFF など）を今の状態に合わせる */
  refresh(): void {
    for (const { action, button } of [...this.quickButtons, ...this.menuButtons]) {
      button.textContent = action.label();
      button.classList.toggle('hidden', action.visible?.() === false);
    }
    this.menuInfo.textContent = this.info();
  }

  private openMenu(): void {
    this.refresh();
    this.releaseAll();
    this.menu.classList.remove('hidden');
  }

  private closeMenu(): void {
    this.menu.classList.add('hidden');
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

  private releaseAll(): void {
    this.releaseSteer();
    this.pedalPointers.accel.clear();
    this.pedalPointers.brake.clear();
    this.accel.classList.remove('pressed');
    this.brake.classList.remove('pressed');
  }
}
