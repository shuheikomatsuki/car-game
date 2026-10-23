import { EMOTE_COUNT } from '../net/protocol';

/** 短いセリフ（エモート）。番号で送り合うので、並びを変えると古い版の人と食い違う（足すときは後ろに） */
export const EMOTES: readonly string[] = [
  '俺のRについて来れるか！？',
  'よろしく！',
  'お先に！',
  'ついて来い！',
  'ナイスバトル！',
  'ごめん！',
  'もう一本！',
  'ありがとう！',
];

if (EMOTES.length !== EMOTE_COUNT) throw new Error('EMOTES と EMOTE_COUNT の数が違います');
