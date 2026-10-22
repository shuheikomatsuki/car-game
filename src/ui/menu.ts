function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

/** メニューの選択肢の1つ（マップ・車など） */
export interface MenuChoice {
  id: string;
  label: string;
  /** ボタンの下に小さく出す説明 */
  note?: string;
}

/** 1つを選ぶ選択肢のまとまり */
export interface MenuGroup {
  /** 画面に1つだけのときは省略してよい（画面の題が見出しになる） */
  title?: string;
  choices: () => readonly MenuChoice[];
  selected: () => string | null;
  select: (id: string) => void;
  /** 選んでいるものの説明（選択肢の下に出す） */
  detail?: () => string;
}

/** 選んでいく画面の1枚 */
export interface MenuScreen {
  title: string;
  groups: readonly MenuGroup[];
}

/** プレイモード（最初の画面で選ぶ）と、その後に続けて選んでいく画面 */
export interface MenuMode {
  id: string;
  label: string;
  note?: string;
  /** 選び始めるときに呼ぶ（選択の下書きを今の状態から作るなど） */
  begin: () => void;
  screens: () => readonly MenuScreen[];
  /** これまでに選んだもの（画面の上に出す） */
  summary: () => string;
  /** 最後の画面で「スタート」を押したとき */
  finish: () => void;
}

/** 最初の画面の下に並べるボタン（カメラ・サウンドなど） */
export interface MenuAction {
  label: () => string;
  run: () => void;
  visible?: () => boolean;
  /** 押したらメニューを閉じる（別の画面を開くときなど） */
  closeOnRun?: boolean;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * ゲームのメニュー（スマホは ☰、パソコンは Esc で開く）。
 * 最初の画面でプレイモードを選び、コース・対戦相手・車などを1枚ずつ選んでいく。
 * 1つだけ選ぶ画面は選ぶとすぐ次の画面へ進み、「戻る」で前の画面に戻れる。最後の画面の「スタート」で始まる
 */
export class GameMenu {
  private readonly root = el('menu');
  private readonly titleEl = el('menu-title');
  private readonly info = el('menu-info');
  private readonly stepsEl = el('menu-steps');
  private readonly groupsEl = el('menu-groups');
  private readonly actionsEl = el('menu-actions');
  private readonly backButton = el<HTMLButtonElement>('menu-back');
  private readonly nextButton = el<HTMLButtonElement>('menu-next');
  private openValue = false;
  /** 選んでいるプレイモード（null なら最初の画面） */
  private mode: MenuMode | null = null;
  private step = 0;

  constructor(
    private readonly modes: readonly MenuMode[],
    private readonly actions: readonly MenuAction[],
    private readonly handlers: {
      info: () => string;
      /** いまのプレイモード（最初の画面で選ばれている印を付ける） */
      currentMode: () => string;
      onOpenChange: (open: boolean) => void;
      /** Esc で開いてよいか（他の画面を開いているときは開かない） */
      canOpen: () => boolean;
    },
  ) {
    this.groupsEl.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest('button[data-group]') as HTMLButtonElement | null;
      if (!button) return;
      const id = button.dataset.id!;
      if (button.dataset.group === 'mode') {
        this.mode = this.modes.find((m) => m.id === id) ?? null;
        this.mode?.begin();
        this.step = 0;
        this.refresh();
        return;
      }
      const screen = this.screen();
      if (!screen) return;
      screen.groups[Number(button.dataset.group)].select(id);
      // 選ぶものが1つだけの画面は、選んだらすぐ次へ
      if (screen.groups.length === 1) this.next();
      else this.refresh();
    });
    this.actionsEl.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null;
      if (!button) return;
      const action = this.actions[Number(button.dataset.action)];
      if (action.closeOnRun) this.close();
      action.run();
      if (this.openValue) this.refresh();
    });
    this.backButton.addEventListener('click', () => this.back());
    this.nextButton.addEventListener('click', () => this.next());
    el('menu-close').addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.repeat) return;
      if (this.openValue) {
        // 選んでいる途中なら1つ前の画面へ、最初の画面なら閉じる
        if (this.mode) this.back();
        else this.close();
      } else if (this.handlers.canOpen()) this.open();
      else return;
      e.preventDefault();
    });
  }

  get isOpen(): boolean {
    return this.openValue;
  }

  /** 最初の画面（プレイモードを選ぶ）から開く */
  open(): void {
    if (this.openValue) return;
    this.openValue = true;
    this.mode = null;
    this.step = 0;
    this.refresh();
    this.root.classList.remove('hidden');
    this.handlers.onOpenChange(true);
  }

  close(): void {
    if (!this.openValue) return;
    this.openValue = false;
    this.root.classList.add('hidden');
    (document.activeElement as HTMLElement | null)?.blur();
    this.handlers.onOpenChange(false);
  }

  private screen(): MenuScreen | null {
    return this.mode?.screens()[this.step] ?? null;
  }

  private back(): void {
    if (!this.mode) return;
    if (this.step > 0) this.step--;
    else this.mode = null;
    this.refresh();
  }

  private next(): void {
    if (!this.mode) return;
    if (this.step < this.mode.screens().length - 1) {
      this.step++;
      this.refresh();
      return;
    }
    const mode = this.mode;
    this.close();
    mode.finish();
  }

  /** 表示を今の状態に合わせる（開いていないときは何もしない） */
  refresh(): void {
    if (!this.openValue) return;
    const chip = (group: string, c: MenuChoice, selected: boolean) =>
      `<button type="button" class="chip${selected ? ' selected' : ''}" data-group="${group}" data-id="${escapeHtml(c.id)}">${escapeHtml(c.label)}${
        c.note ? `<small>${escapeHtml(c.note)}</small>` : ''
      }</button>`;
    const mode = this.mode;
    this.root.classList.toggle('home', !mode);
    this.backButton.classList.toggle('hidden', !mode);
    this.nextButton.classList.toggle('hidden', !mode);
    this.actionsEl.classList.toggle('hidden', !!mode);
    if (!mode) {
      this.titleEl.textContent = 'メニュー';
      this.info.textContent = this.handlers.info();
      this.stepsEl.innerHTML = '';
      const current = this.handlers.currentMode();
      this.groupsEl.innerHTML = `<section><h3>プレイモードを選ぶ</h3><div class="chips modes">${this.modes.map((m) => chip('mode', m, m.id === current)).join('')}</div></section>`;
      this.actionsEl.innerHTML = this.actions
        .map((a, i) => (a.visible?.() === false ? '' : `<button type="button" data-action="${i}">${escapeHtml(a.label())}</button>`))
        .join('');
      return;
    }
    const screens = mode.screens();
    this.step = Math.min(this.step, screens.length - 1);
    const screen = screens[this.step];
    this.titleEl.textContent = `${mode.label}：${screen.title}`;
    this.info.textContent = mode.summary();
    // 何枚目か（選び終えた画面・いまの画面・この後の画面）
    this.stepsEl.innerHTML = screens
      .map((s, i) => `<li class="${i < this.step ? 'done' : i === this.step ? 'current' : ''}">${escapeHtml(s.title)}</li>`)
      .join('');
    this.groupsEl.innerHTML = screen.groups
      .map((g, gi) => {
        const selected = g.selected();
        const chips = g
          .choices()
          .map((c) => chip(String(gi), c, c.id === selected))
          .join('');
        const detail = g.detail?.() ?? '';
        return `<section>${g.title ? `<h3>${escapeHtml(g.title)}</h3>` : ''}<div class="chips">${chips}</div>${detail ? `<p class="note">${escapeHtml(detail)}</p>` : ''}</section>`;
      })
      .join('');
    this.nextButton.textContent = this.step === screens.length - 1 ? 'スタート' : '次へ';
  }
}
