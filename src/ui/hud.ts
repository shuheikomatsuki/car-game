import type { CarSnapshot } from '../sim/car';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

export class Hud {
  private readonly speed = el('speed-value');
  private readonly gear = el('gear');
  private readonly cameraName = el('camera-name');
  private readonly mapName = el('map-name');
  private readonly modeName = el('mode-name');
  private readonly soundState = el('sound-state');
  private readonly gamepadState = el('gamepad-state');
  private readonly help = el('help');
  private readonly toastEl = el('toast');
  private toastTimer: number | undefined;
  private lastSpeed = -1;
  private gamepadConnected: boolean | null = null;

  update(car: CarSnapshot): void {
    const kmh = Math.round(Math.abs(car.forwardSpeed) * 3.6);
    if (kmh !== this.lastSpeed) {
      this.speed.textContent = String(kmh);
      this.lastSpeed = kmh;
    }
    this.gear.textContent = car.forwardSpeed < -0.3 ? 'R' : 'D';
  }

  setCameraName(name: string): void {
    this.cameraName.textContent = `（${name}）`;
  }

  setMapName(name: string): void {
    this.mapName.textContent = name;
  }

  setMode(assist: boolean, label: string): void {
    this.modeName.textContent = label;
    document.body.classList.toggle('mode-assist', assist);
    document.body.classList.toggle('mode-manual', !assist);
  }

  setMuted(muted: boolean): void {
    this.soundState.textContent = muted ? '（OFF）' : '（ON）';
  }

  setGamepadConnected(connected: boolean): void {
    if (connected === this.gamepadConnected) return;
    if (this.gamepadConnected !== null) this.toast(connected ? 'ゲームパッド接続' : 'ゲームパッド切断');
    this.gamepadConnected = connected;
    this.gamepadState.classList.toggle('hidden', !connected);
  }

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
  }

  /** 画面中央上に短いメッセージを出す */
  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('visible'), 1800);
  }
}

export function hideLoading(): void {
  el('loading').remove();
}

export function showError(message: string): void {
  el('loading').textContent = message;
}
