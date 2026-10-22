import { formatTime } from '../race/timeAttack';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

export interface RaceResult {
  total: number;
  laps: number[];
  /** 前回までの自己ベスト（初めてなら null） */
  previousBest: number | null;
  newTotal: boolean;
  newLap: boolean;
  bestLap: number;
  /** 記録を保存できなかった */
  notSaved: boolean;
}

/** タイムアタックの表示（周回・タイム・カウントダウン・結果） */
export class RaceHud {
  private readonly panel = el('race');
  private readonly lapEl = el('race-lap');
  private readonly timeEl = el('race-time');
  private readonly bestEl = el('race-best');
  private readonly splitEl = el('race-split');
  private readonly lapsEl = el('race-laps');
  /** 表に出している走り終えた周の数（増えたときだけ表を作り直す） */
  private shownLaps = -1;
  private currentLapEl: HTMLElement | null = null;
  private readonly countdown = el('countdown');
  private readonly warning = el('race-warning');
  private readonly result = el('race-result');
  private readonly resultBody = el('race-result-body');
  private countdownTimer: number | undefined;
  private splitTimer: number | undefined;
  private wrongWay = false;
  private offCourse = false;

  constructor(handlers: { onRetry: () => void; onQuit: () => void }) {
    const button = (id: string, run: () => void) => {
      const b = el(id);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', run);
    };
    button('race-retry', handlers.onRetry);
    button('race-quit', handlers.onQuit);
  }

  show(on: boolean): void {
    this.panel.classList.toggle('hidden', !on);
    this.shownLaps = -1;
    document.body.classList.toggle('racing', on);
    if (!on) {
      this.hideResult();
      this.setWarning({ wrongWay: false, offCourse: false });
      this.countdown.classList.remove('visible');
    }
  }

  /** 周回・タイムを更新する（毎フレーム） */
  update(s: {
    lap: number;
    totalLaps: number;
    time: number;
    best: number | null;
    /** 走り終えた周のタイム */
    laps: readonly number[];
    lapTime: number;
    /** 比べる周回タイム（自己ベストの走りの各周） */
    refLaps?: readonly number[];
    finished: boolean;
  }): void {
    this.lapEl.textContent = `LAP ${s.lap}/${s.totalLaps}`;
    this.timeEl.textContent = formatTime(s.time);
    this.bestEl.textContent = s.best === null ? 'ベスト --:--.--' : `ベスト ${formatTime(s.best)}`;
    if (s.laps.length !== this.shownLaps || (s.finished && this.currentLapEl)) this.renderLaps(s.laps, s.refLaps, s.finished, s.totalLaps);
    if (this.currentLapEl) this.currentLapEl.textContent = formatTime(s.lapTime);
  }

  /** これまでの周回タイムの表。自己ベストの同じ周より速ければ緑、遅ければ赤で差を出す */
  private renderLaps(laps: readonly number[], ref: readonly number[] | undefined, finished: boolean, totalLaps: number): void {
    this.shownLaps = laps.length;
    const fastest = Math.min(...laps);
    const rows = laps.map((t, i) => {
      const r = ref?.[i];
      const diff = r === undefined ? '' : `<span class="${t < r ? 'good' : 'bad'}">${t - r >= 0 ? '+' : '−'}${Math.abs(t - r).toFixed(2)}</span>`;
      const mark = laps.length > 1 && t === fastest ? ' fastest' : '';
      return `<tr class="done${mark}"><td>${i + 1}</td><td>${formatTime(t)}</td><td>${diff}</td></tr>`;
    });
    const running = !finished && laps.length < totalLaps;
    if (running) rows.push(`<tr class="current"><td>${laps.length + 1}</td><td></td><td></td></tr>`);
    this.lapsEl.innerHTML = rows.join('');
    this.currentLapEl = running ? (this.lapsEl.querySelector('.current td:nth-child(2)') as HTMLElement) : null;
  }

  /** カウントダウンの数字（0 で「スタート！」） */
  count(value: number): void {
    this.countdown.textContent = value > 0 ? String(value) : 'スタート！';
    this.countdown.classList.add('visible');
    window.clearTimeout(this.countdownTimer);
    if (value === 0) this.countdownTimer = window.setTimeout(() => this.countdown.classList.remove('visible'), 900);
  }

  /** 周回のタイムを少しの間だけ出す */
  split(text: string, good: boolean): void {
    this.splitEl.textContent = text;
    this.splitEl.classList.toggle('good', good);
    this.splitEl.classList.add('visible');
    window.clearTimeout(this.splitTimer);
    this.splitTimer = window.setTimeout(() => this.splitEl.classList.remove('visible'), 3000);
  }

  setWarning(state: { wrongWay?: boolean; offCourse?: boolean }): void {
    this.wrongWay = state.wrongWay ?? this.wrongWay;
    this.offCourse = state.offCourse ?? this.offCourse;
    const text = this.wrongWay ? '逆走しています' : this.offCourse ? 'コースに戻ってください（近道は周回に数えません）' : '';
    this.warning.textContent = text;
    this.warning.classList.toggle('visible', text !== '');
  }

  showResult(r: RaceResult): void {
    const lapRows = r.laps
      .map((t, i) => `<tr><td>${i + 1}周目</td><td>${formatTime(t)}${t === r.bestLap && r.newLap ? ' <span class="new">最速ラップ</span>' : ''}</td></tr>`)
      .join('');
    const best = r.newTotal
      ? `<p class="new big">自己ベスト更新！${r.previousBest !== null ? `（${formatTime(r.previousBest)} → ${formatTime(r.total)}）` : ''}</p>`
      : `<p class="note">自己ベスト ${formatTime(r.previousBest ?? r.total)}（あと ${(r.total - (r.previousBest ?? r.total)).toFixed(2)} 秒）</p>`;
    this.resultBody.innerHTML = `
      <p class="total">${formatTime(r.total)}</p>
      ${best}
      <table>${lapRows}</table>
      ${r.notSaved ? '<p class="note">このブラウザでは記録を保存できませんでした</p>' : ''}`;
    this.result.classList.remove('hidden');
  }

  hideResult(): void {
    this.result.classList.add('hidden');
  }
}
