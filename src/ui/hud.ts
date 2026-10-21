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
  private readonly help = el('help');
  private lastSpeed = -1;

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

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
  }
}

export function hideLoading(): void {
  el('loading').remove();
}

export function showError(message: string): void {
  el('loading').textContent = message;
}
