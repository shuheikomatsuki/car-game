import type { RaceState } from '../net/protocol';
import type { BoardChoice } from './rankingPanel';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** エントリー画面に出す、部屋の1人分 */
export interface RoomMember {
  id: number;
  name: string;
  car: string;
  color: number;
}

export interface OnlineRaceView {
  race: RaceState;
  selfId: number;
  members: readonly RoomMember[];
  /** コースの名前と、時間帯・天気（「峠（ダウンヒル） ／ 夜・雨」） */
  conditions: string;
}

export interface OnlineRacePanelHandlers {
  /** 準備 OK（その車で出る）・取り消し */
  onReady: (ready: boolean, car: string) => void;
  onStart: () => void;
  /** 抜ける（言い出した人なら対戦をやめる） */
  onLeave: () => void;
  onOpenChange: (open: boolean) => void;
}

const hexColor = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * オンライン対戦のエントリー画面: 言い出した人がコース・時間帯・天気を決めた後、各自が車を選んで「準備OK」にする。
 * 全員が準備 OK になったら、言い出した人がスタートの合図を出す
 */
export class OnlineRacePanel {
  private readonly root = el('online-race');
  private readonly cond = el('or-cond');
  private readonly status = el('or-status');
  private readonly cars = el('or-cars');
  private readonly entrants = el('or-entrants');
  private readonly readyButton = el<HTMLButtonElement>('or-ready');
  private readonly startButton = el<HTMLButtonElement>('or-start');
  private readonly leaveButton = el<HTMLButtonElement>('or-leave');
  private view: OnlineRaceView | null = null;
  private car: string;
  private openValue = false;

  constructor(
    choices: readonly BoardChoice[],
    initialCar: string,
    private readonly carLabel: (id: string) => string,
    private readonly handlers: OnlineRacePanelHandlers,
  ) {
    this.car = initialCar;
    this.cars.innerHTML = choices
      .map((c) => `<button type="button" class="rk-course" role="option" data-id="${escapeHtml(c.id)}"><span>${escapeHtml(c.label)}</span>${c.note ? `<small>${escapeHtml(c.note)}</small>` : ''}</button>`)
      .join('');
    this.cars.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
      if (!b) return;
      this.car = b.dataset.id!;
      // 準備 OK のまま車を替えたら、その車で出直す
      if (this.isReady) this.handlers.onReady(true, this.car);
      this.render();
    });
    this.readyButton.addEventListener('click', () => this.handlers.onReady(!this.isReady, this.car));
    this.startButton.addEventListener('click', () => this.handlers.onStart());
    this.leaveButton.addEventListener('click', () => this.handlers.onLeave());
    el('or-hide').addEventListener('click', () => this.close());
  }

  get isOpen(): boolean {
    return this.openValue;
  }

  get selectedCar(): string {
    return this.car;
  }

  private get isReady(): boolean {
    return !!this.view && this.view.race.entrants.includes(this.view.selfId);
  }

  /** 対戦の様子が変わったとき（開いていなければ中身だけ変える） */
  update(view: OnlineRaceView | null): void {
    this.view = view;
    if (!view || view.race.phase !== 'entry') {
      this.close();
      return;
    }
    this.render();
  }

  open(car?: string): void {
    if (!this.view) return;
    if (car) this.car = car;
    if (!this.openValue) {
      this.openValue = true;
      this.root.classList.remove('hidden');
      this.handlers.onOpenChange(true);
    }
    this.render(true);
  }

  close(): void {
    if (!this.openValue) return;
    this.openValue = false;
    this.root.classList.add('hidden');
    (document.activeElement as HTMLElement | null)?.blur();
    this.handlers.onOpenChange(false);
  }

  private render(scroll = false): void {
    const v = this.view;
    if (!v) return;
    const { race, selfId } = v;
    const isHost = race.host === selfId;
    const ready = this.isReady;
    const hostName = v.members.find((m) => m.id === race.host)?.name ?? '誰か';
    const waiting = v.members.filter((m) => !race.entrants.includes(m.id)).length;
    const everyoneReady = waiting === 0;
    this.cond.textContent = v.conditions;
    this.status.textContent = isHost
      ? everyoneReady
        ? '全員が準備OKです。「スタート」で一斉にカウントダウンが始まります。'
        : ready
          ? `あと${waiting}人の準備OKを待っています。全員そろうと「スタート」を押せます。`
          : '車を選んで「準備OK」。全員が準備OKになると「スタート」を押せます。'
      : ready && everyoneReady
        ? `全員が準備OKです。${hostName} さんのスタートの合図を待っています…`
        : ready
          ? `あと${waiting}人の準備OKを待っています…`
          : '車を選んで「準備OK」を押してください。';
    for (const b of this.cars.querySelectorAll<HTMLButtonElement>('button[data-id]')) {
      const on = b.dataset.id === this.car;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-selected', String(on));
      if (on && scroll) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    this.entrants.innerHTML = v.members
      .map((m) => {
        const order = race.entrants.indexOf(m.id);
        const car = m.id === selfId ? this.car : m.car;
        return `<li class="${order >= 0 ? 'ready' : ''}${m.id === selfId ? ' me' : ''}"><span class="dot" style="background:${hexColor(m.color)}"></span><span class="name">${escapeHtml(m.name)}${
          m.id === race.host ? '<i>主催</i>' : ''
        }</span><span class="car">${escapeHtml(this.carLabel(car))}</span><span class="mark">${order >= 0 ? '準備OK' : '選択中'}</span></li>`;
      })
      .join('');
    this.readyButton.textContent = ready ? '準備OKを取り消す' : '準備OK';
    this.readyButton.classList.toggle('primary', !ready);
    this.startButton.classList.toggle('hidden', !isHost);
    this.startButton.disabled = !everyoneReady;
    this.leaveButton.textContent = isHost ? '対戦をやめる' : '抜ける';
  }
}
