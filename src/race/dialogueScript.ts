import type { RivalDialogue } from './dialogue';

/**
 * ライバルとのバトルのセリフ。ここを書き換えると、ゲームの中のセリフが変わる。書き方は docs/dialogue.md。
 *
 * - キーはライバルの id（src/race/rivals.ts の RIVALS）。書いていないライバルはセリフなし
 * - 書かなければ、ライバルの得意なコースでバトルしたときだけ出る（onlyHomeCourse: false でどのコースでも）
 * - who: ライバルの id、'player'（自分）、下の CHARACTERS の id。どれでもなければ、書いた文字をそのまま名前として出す
 * - ?debug を付けて開くと、走っている間に「いまの場所（スタートからの距離）」が画面の左下に出る（at を決めるのに使う）
 *
 * いまのセリフは動作を確かめるための見本（武内樹）。好きなものに書き換えたり、消したりしてよい。
 */
export const RIVAL_DIALOGUES: Readonly<Record<string, RivalDialogue>> = {
  itsuki: {
    intro: [
      {
        say: [
          { who: 'itsuki', text: 'よーし、オレのハチゴーの走り、見せてやるぜ！' },
          { who: 'player', text: '……じゃあ、行くか' },
        ],
      },
    ],
    race: [
      { when: { at: 300, position: 'behind' }, say: [{ who: 'itsuki', text: 'へへっ、ついて来られるか？' }] },
      { when: { event: 'overtaken' }, say: [{ who: 'itsuki', text: 'うわっ、抜かれた！？' }] },
      { when: { event: 'overtake' }, say: [{ who: 'itsuki', text: 'よっしゃ、前に出たぜ！' }] },
      { when: { event: 'crash' }, say: [{ who: 'itsuki', text: 'おいおい、大丈夫かよ！' }] },
    ],
    win: [{ say: [{ who: 'itsuki', text: 'ちくしょー、負けたぁ……。でも、楽しかったぜ！' }] }],
    lose: [{ say: [{ who: 'itsuki', text: 'やったー！ オレの勝ちだ！' }] }],
  },
};

/** ライバル以外で話す人（id → 名前と画像）。画像は public/ からのパス（例: 'characters/bunta.jpg'） */
export const CHARACTERS: Readonly<Record<string, { name: string; photo?: string }>> = {
  bunta: { name: '藤原文太' },
};
