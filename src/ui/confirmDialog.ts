function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

export interface ConfirmOptions {
  title: string;
  /** 題の横に小さく出す英語 */
  en: string;
  lines: readonly string[];
  /** 実行するボタンの文字（「消す」など） */
  ok: string;
  /** 決めるボタンを赤くしない（消すのではなく、決めるだけのとき） */
  safe?: boolean;
}

export interface TextOptions extends ConfirmOptions {
  value: string;
  maxLength: number;
  placeholder?: string;
}

/**
 * 「本当に消しますか？」のような確認の画面。選ぶまで後ろのメニューは操作できない。
 * 最初は「やめる」にカーソルがある（Enter を続けて押しても消えないように）
 */
export class ConfirmDialog {
  private readonly root = el('confirm');
  private readonly title = el('confirm-title');
  private readonly text = el('confirm-text');
  private readonly cancelButton = el<HTMLButtonElement>('confirm-cancel');
  private readonly okButton = el<HTMLButtonElement>('confirm-ok');
  private readonly input = el<HTMLInputElement>('confirm-input');
  private resolve: ((ok: boolean) => void) | null = null;

  constructor() {
    this.cancelButton.addEventListener('click', () => this.finish(false));
    this.okButton.addEventListener('click', () => this.finish(true));
    // 外側（暗いところ）を押したらやめる
    this.root.addEventListener('click', (e) => e.target === this.root && this.finish(false));
    // メニューより先に受け取って、開いている間は後ろに渡さない
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.resolve) return;
        e.stopImmediatePropagation();
        // 文字を入れているとき: Enter で決める・Esc でやめる。それ以外は入力欄にまかせる（変換中の Enter は変換を決めるだけ）
        if (e.target === this.input) {
          if (e.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter') this.finish(true);
          else if (e.key === 'Escape') this.finish(false);
          else return;
          e.preventDefault();
          return;
        }
        e.preventDefault();
        if (e.repeat) return;
        if (e.key === 'Escape' || e.key === 'Backspace') this.finish(false);
        else if (e.key === 'Enter' || e.key === ' ') this.finish(document.activeElement === this.okButton);
        else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'a', 'd', 'w', 's'].includes(e.key))
          (document.activeElement === this.okButton ? this.cancelButton : this.okButton).focus();
      },
      { capture: true },
    );
  }

  get isOpen(): boolean {
    return this.resolve !== null;
  }

  /** 開いて、選ばれたら true（実行する）か false（やめる）を返す */
  ask(options: ConfirmOptions): Promise<boolean> {
    this.input.classList.add('hidden');
    return this.open(options, this.cancelButton);
  }

  /** 文字を入れてもらう。決めたら入れた文字、やめたら null を返す */
  async askText(options: TextOptions): Promise<string | null> {
    this.input.classList.remove('hidden');
    this.input.value = options.value;
    this.input.maxLength = options.maxLength;
    this.input.placeholder = options.placeholder ?? '';
    const ok = await this.open(options, this.input);
    return ok ? this.input.value : null;
  }

  private open(options: ConfirmOptions, focus: HTMLElement): Promise<boolean> {
    this.resolve?.(false);
    this.title.innerHTML = '';
    this.title.append(options.title);
    const en = document.createElement('span');
    en.className = 'en';
    en.textContent = options.en;
    this.title.append(en);
    this.text.replaceChildren(
      ...options.lines.map((line) => {
        const p = document.createElement('p');
        p.textContent = line;
        return p;
      }),
    );
    this.okButton.textContent = options.ok;
    this.okButton.classList.toggle('danger', !options.safe);
    this.okButton.classList.toggle('primary', options.safe === true);
    this.root.classList.toggle('safe', options.safe === true);
    this.root.classList.remove('hidden');
    focus.focus();
    if (focus === this.input) this.input.select();
    return new Promise((resolve) => (this.resolve = resolve));
  }

  private finish(ok: boolean): void {
    const resolve = this.resolve;
    if (!resolve) return;
    this.resolve = null;
    this.root.classList.add('hidden');
    (document.activeElement as HTMLElement | null)?.blur();
    resolve(ok);
  }
}
