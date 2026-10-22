import type { CarEntry } from '../net/leaderboard';
import { MAX_ENTRY_NAME_LENGTH } from '../net/leaderboard';
import { formatTime } from '../race/timeAttack';
import { loadPlayerName, savePlayerName } from './onlinePanel';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export interface BoardChoice {
  id: string;
  label: string;
}

/** 車の選択肢の「すべての車」（車ごとのランキングをまとめて出す） */
export const ALL_CARS = 'all';

export interface RankingPanelHandlers {
  /** そのランキングを読む（car が ALL_CARS ならすべての車。まだ送っていない自己ベストがあれば先に送る）。mine は自分の記録の id */
  load: (course: string, car: string) => Promise<{ entries: CarEntry[]; mine: ReadonlySet<string> }>;
  /** 選んだ記録のゴーストと、その記録の車で走る */
  onRace: (course: string, entry: CarEntry) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

/** ランキングの画面: コースと車を選んで上位の記録を見て、選んだ人のゴーストと走る */
export class RankingPanel {
  private readonly root = el('ranking');
  private readonly course = el<HTMLSelectElement>('ranking-course');
  private readonly car = el<HTMLSelectElement>('ranking-car');
  private readonly name = el<HTMLInputElement>('ranking-name');
  private readonly status = el('ranking-status');
  private readonly table = el<HTMLTableElement>('ranking-table');
  private entries: CarEntry[] = [];
  private readonly carLabels: Map<string, string>;
  private openValue = false;
  /** 古い読み込みの結果で上書きしないための番号 */
  private loadId = 0;

  constructor(
    courses: readonly BoardChoice[],
    cars: readonly BoardChoice[],
    private readonly handlers: RankingPanelHandlers,
  ) {
    const options = (list: readonly BoardChoice[]) => list.map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('');
    this.course.innerHTML = options(courses);
    this.car.innerHTML = options([{ id: ALL_CARS, label: 'すべての車' }, ...cars]);
    this.carLabels = new Map(cars.map((c) => [c.id, c.label]));
    this.course.addEventListener('change', () => void this.reload());
    this.car.addEventListener('change', () => void this.reload());
    this.name.maxLength = MAX_ENTRY_NAME_LENGTH;
    this.name.addEventListener('change', () => {
      savePlayerName(this.name.value.trim());
      // 名前を入れたら、まだ送っていない自己ベストを送る
      void this.reload();
    });
    this.table.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest('button[data-index]') as HTMLButtonElement | null;
      if (!button) return;
      const entry = this.entries[Number(button.dataset.index)];
      if (!entry) return;
      button.disabled = true;
      this.status.textContent = `${entry.name} さんのゴーストを読み込んでいます…`;
      this.handlers.onRace(this.course.value, entry).then(
        () => this.close(),
        (err: unknown) => {
          button.disabled = false;
          this.status.textContent = `読み込めませんでした: ${err instanceof Error ? err.message : String(err)}`;
        },
      );
    });
    el('ranking-close').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (this.openValue && e.key === 'Escape') {
        // 同じ Esc でメニューが開かないように
        e.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return this.openValue;
  }

  open(course: string, car: string): void {
    this.openValue = true;
    this.course.value = course;
    this.car.value = car;
    this.name.value = loadPlayerName();
    this.root.classList.remove('hidden');
    this.handlers.onOpenChange(true);
    void this.reload();
  }

  close(): void {
    if (!this.openValue) return;
    this.openValue = false;
    this.root.classList.add('hidden');
    (document.activeElement as HTMLElement | null)?.blur();
    this.handlers.onOpenChange(false);
  }

  private async reload(): Promise<void> {
    const id = ++this.loadId;
    this.status.textContent = '読み込んでいます…';
    try {
      const { entries, mine } = await this.handlers.load(this.course.value, this.car.value);
      if (id !== this.loadId) return;
      this.entries = entries;
      this.render(mine);
      const hint = this.name.value.trim() ? '' : '名前を入れると、自己ベストがランキングに載ります。';
      this.status.textContent = entries.length ? hint : `まだ記録がありません。${hint}`;
    } catch (err) {
      if (id !== this.loadId) return;
      this.entries = [];
      this.render(new Set());
      this.status.textContent = `ランキングを読み込めませんでした: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private render(mine: ReadonlySet<string>): void {
    const top = this.entries[0]?.total;
    this.table.innerHTML = this.entries
      .map((e, i) => {
        const gap = i === 0 || top === undefined ? '' : `<span class="note">+${(e.total - top).toFixed(2)}</span>`;
        const date = new Date(e.date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
        return `<tr class="${mine.has(e.id) ? 'me' : ''}"><td>${i + 1}</td><td class="name">${escapeHtml(e.name)}</td><td class="car">${escapeHtml(this.carLabels.get(e.car) ?? e.car)}</td><td>${formatTime(e.total)} ${gap}</td><td class="note">${date}</td><td><button type="button" data-index="${i}">対戦</button></td></tr>`;
      })
      .join('');
  }
}
