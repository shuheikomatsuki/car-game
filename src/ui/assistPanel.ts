import { COMMAND_BUTTONS, type Command } from '../ai/commands';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

/** 声でだけ出せる指示（ボタンが無いもの）の表示名 */
const VOICE_ONLY_LABEL: Partial<Record<Command, string>> = {
  turnLeft: '次を左',
  turnRight: '次を右',
  goLeft: '左に曲がって',
  goRight: '右に曲がって',
  correctLeft: 'そこじゃなくて次を左',
  correctRight: 'そこじゃなくて次を右',
  keepLane: '車線に戻って',
};

const LABEL: Record<Command, string> = {
  ...VOICE_ONLY_LABEL,
  ...Object.fromEntries(COMMAND_BUTTONS.map((b) => [b.command, b.label])),
} as Record<Command, string>;

export function commandLabel(c: Command): string {
  return LABEL[c];
}

/** 音声指示モードの画面（字幕・聞き取った言葉・指示ボタン・マイク） */
export class AssistPanel {
  private readonly root = el('assist');
  private readonly subtitle = el('subtitle');
  private readonly subtitleName = el('subtitle-name');
  private readonly subtitleText = el('subtitle-text');
  private readonly heard = el('heard');
  private readonly mic = el<HTMLButtonElement>('mic');
  private readonly status = el('assist-status');
  private subtitleTimer: number | undefined;
  private heardTimer: number | undefined;

  constructor(onCommand: (c: Command) => void, onMic: () => void) {
    const container = el('commands');
    for (const b of COMMAND_BUTTONS) {
      const button = document.createElement('button');
      button.className = b.command === 'danger' || b.command === 'stop' ? 'cmd urgent' : 'cmd';
      button.innerHTML = `<kbd>${b.key}</kbd>${b.label}`;
      // キーボード操作の邪魔にならないようフォーカスを取らない
      button.addEventListener('mousedown', (e) => e.preventDefault());
      button.addEventListener('click', () => onCommand(b.command));
      container.appendChild(button);
    }
    this.mic.addEventListener('mousedown', (e) => e.preventDefault());
    this.mic.addEventListener('click', onMic);
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  say(name: string, text: string): void {
    this.subtitleName.textContent = name;
    this.subtitleText.textContent = text;
    this.subtitle.classList.add('visible');
    window.clearTimeout(this.subtitleTimer);
    this.subtitleTimer = window.setTimeout(() => this.subtitle.classList.remove('visible'), 2200 + text.length * 120);
  }

  /** プレイヤーが言った／押した指示 */
  showHeard(text: string, command: Command | null, final: boolean): void {
    const arrow = command ? ` → <b>${LABEL[command]}</b>` : final ? ' → <span class="miss">（指示として聞き取れず）</span>' : '';
    this.heard.innerHTML = `<span class="you">あなた</span>「${escapeHtml(text)}」${arrow}`;
    this.heard.classList.toggle('interim', !final);
    this.heard.classList.add('visible');
    window.clearTimeout(this.heardTimer);
    this.heardTimer = window.setTimeout(() => this.heard.classList.remove('visible'), 3500);
  }

  setMic(listening: boolean): void {
    this.mic.classList.toggle('on', listening);
    this.mic.innerHTML = listening ? '🎤 聞いています…<kbd>V</kbd>' : '🎤 音声で指示<kbd>V</kbd>';
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
