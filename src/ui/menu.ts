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

/** 1つを選ぶ選択肢のまとまり。押したものがすぐ反映され、メニューは開いたまま（closeOnSelect なら閉じる） */
export interface MenuGroup {
  title: string;
  choices: () => readonly MenuChoice[];
  selected: () => string | null;
  select: (id: string) => void;
  closeOnSelect?: boolean;
  /** false を返す間は出さない */
  visible?: () => boolean;
  /** 選んでいるものの説明（選択肢の下に出す） */
  detail?: () => string;
}

/** メニューの下に並べるボタン（カメラ・サウンドなど） */
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
 * 走り方・コース・車などを一覧から直接選べる。選んでもメニューは閉じないので、続けて別の項目も変えられる。
 */
export class GameMenu {
  private readonly root = el('menu');
  private readonly info = el('menu-info');
  private readonly groupsEl = el('menu-groups');
  private readonly actionsEl = el('menu-actions');
  private openValue = false;

  constructor(
    private readonly groups: readonly MenuGroup[],
    private readonly actions: readonly MenuAction[],
    private readonly handlers: {
      info: () => string;
      onOpenChange: (open: boolean) => void;
      /** Esc で開いてよいか（他の画面を開いているときは開かない） */
      canOpen: () => boolean;
    },
  ) {
    this.groupsEl.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest('button[data-group]') as HTMLButtonElement | null;
      if (!button) return;
      const group = this.groups[Number(button.dataset.group)];
      group.select(button.dataset.id!);
      if (group.closeOnSelect) this.close();
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
    el('menu-close').addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.repeat) return;
      if (this.openValue) this.close();
      else if (this.handlers.canOpen()) this.open();
      else return;
      e.preventDefault();
    });
  }

  get isOpen(): boolean {
    return this.openValue;
  }

  open(): void {
    if (this.openValue) return;
    this.openValue = true;
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

  /** 表示を今の状態に合わせる（開いていないときは何もしない） */
  refresh(): void {
    if (!this.openValue) return;
    this.info.textContent = this.handlers.info();
    this.groupsEl.innerHTML = this.groups
      .map((g, gi) => {
        if (g.visible?.() === false) return '';
        const selected = g.selected();
        const chips = g
          .choices()
          .map(
            (c) =>
              `<button type="button" class="chip${c.id === selected ? ' selected' : ''}" data-group="${gi}" data-id="${escapeHtml(c.id)}">${escapeHtml(c.label)}${
                c.note ? `<small>${escapeHtml(c.note)}</small>` : ''
              }</button>`,
          )
          .join('');
        const detail = g.detail?.() ?? '';
        return `<section><h3>${escapeHtml(g.title)}</h3><div class="chips">${chips}</div>${detail ? `<p class="note">${escapeHtml(detail)}</p>` : ''}</section>`;
      })
      .join('');
    this.actionsEl.innerHTML = this.actions
      .map((a, i) => (a.visible?.() === false ? '' : `<button type="button" data-action="${i}">${escapeHtml(a.label())}</button>`))
      .join('');
  }
}
