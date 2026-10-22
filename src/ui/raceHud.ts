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
    document.body.classList.toggle('racing', on);
    if (!on) {
      this.hideResult();
      this.setWarning({ wrongWay: false, offCourse: false });
      this.countdown.classList.remove('visible');
    }
  }

  /** 周回・タイムを更新する（毎フレーム） */
  update(lap: number, totalLaps: number, time: number, best: number | null): void {
    this.lapEl.textContent = `LAP ${lap}/${totalLaps}`;
    this.timeEl.textContent = formatTime(time);
    this.bestEl.textContent = best === null ? 'ベスト --:--.--' : `ベスト ${formatTime(best)}`;
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
