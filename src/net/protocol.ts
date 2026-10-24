/**
 * マルチプレイの通信内容（クライアントとサーバーで共有する）。
 * クライアント権威: 各プレイヤーが自分の車を計算し、状態を送り合う。サーバーは部屋ごとに中継し、
 * 対戦の進行（エントリー・スタートの合図・ゴールの順）だけを管理する。
 */

export const PROTOCOL_VERSION = 3;
export const MAX_PLAYERS = 8;
/** 名前の上限（文字数） */
export const MAX_NAME_LENGTH = 10;
/** 部屋コードに使う文字（読み間違えやすい 0/O・1/I/L を除く） */
export const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;

export interface PlayerInfo {
  id: number;
  name: string;
  /** 車の種類（VEHICLE_PRESETS の id） */
  car: string;
  /** 車体の色の番号 */
  color: number;
  /** ヘッドライトをつけているか */
  lights: boolean;
}

/** 部屋の対戦の条件（言い出した人が決め、全員が同じ条件で走る） */
export interface RaceSettings {
  /** MAPS の番号 */
  map: number;
  time: string;
  weather: string;
}

/**
 * 部屋の対戦の様子。
 * entry: エントリー中（各自が車を選んで準備 OK にする）、racing: スタートの合図を出した後
 */
export interface RaceState {
  phase: 'entry' | 'racing';
  settings: RaceSettings;
  /** 言い出した人（スタートの合図・中止ができる） */
  host: number;
  /** 準備 OK の人（並ぶ順） */
  entrants: number[];
  /** ゴールした人とタイム [s]（ゴールした順） */
  finished: { id: number; time: number }[];
  /** 何回目の対戦か（古い対戦の知らせを取り違えないため） */
  seq: number;
  /** スタートの合図を出した時刻 [ms]（サーバーの時計。長すぎる対戦を打ち切るため） */
  startedAt?: number;
}

/** セリフ（エモート）の長さの上限（文字数） */
export const MAX_EMOTE_LENGTH = 20;

const TIMES = ['day', 'morning', 'night'];
const WEATHER_IDS = ['clear', 'rain', 'fog'];

/**
 * 車の状態（JSON を小さくするため配列）。
 * [x, z, yaw, forwardSpeed, steerAngle, wheelSpin]
 */
export type CarState = [number, number, number, number, number, number];

export type ClientMessage =
  | { t: 'hello'; v: number; name: string; car: string; map: number; lights?: boolean }
  /** time: 送信側の時計 [ms]（受信側で補間に使う）。p: 対戦中なら、コースを進んだ距離 [m]（順位に使う） */
  | { t: 'state'; time: number; s: CarState; p?: number }
  | { t: 'profile'; car?: string; lights?: boolean }
  | { t: 'map'; map: number }
  /** クラクションを鳴らし始める・止める */
  | { t: 'horn'; on: boolean }
  | { t: 'emote'; text: string }
  /** 対戦を言い出す（条件を決める） */
  | { t: 'raceOpen'; settings: RaceSettings }
  /** 対戦の準備 OK（その車で出る）・取り消し */
  | { t: 'raceReady'; ready: boolean; car: string }
  /** 言い出した人がスタートの合図を出す */
  | { t: 'raceStart' }
  /** ゴールした（time [s]） */
  | { t: 'raceFinish'; seq: number; time: number }
  /** 言い出した人が対戦をやめる（全員）・自分だけ抜ける */
  | { t: 'raceCancel' }
  | { t: 'ping'; time: number };

export type ServerMessage =
  | { t: 'welcome'; id: number; color: number; players: PlayerInfo[]; map: number; race: RaceState | null }
  | { t: 'join'; player: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'profile'; player: PlayerInfo }
  | { t: 'state'; id: number; time: number; s: CarState; p?: number }
  | { t: 'map'; map: number; by: number }
  | { t: 'horn'; id: number; on: boolean }
  | { t: 'emote'; id: number; text: string }
  /** 対戦の様子が変わった（null は対戦なし）。start は、スタートの合図を出した直後だけ付く */
  | { t: 'race'; race: RaceState | null; by: number; start?: boolean }
  | { t: 'pong'; time: number }
  | { t: 'error'; reason: 'full' | 'version' | 'badRequest' | 'idle' | 'origin' | 'region' };

export function isRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((c) => ROOM_CODE_CHARS.includes(c));
}

export function randomRoomCode(rng: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_CHARS[Math.floor(rng() * ROOM_CODE_CHARS.length)];
  return code;
}

export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function sanitizeName(name: unknown): string {
  const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f<>]/g, '').trim() : '';
  return [...s].slice(0, MAX_NAME_LENGTH).join('') || 'ゲスト';
}

/** セリフの文字を整える（制御文字と < > を除き、長すぎたら切る）。空なら '' */
export function sanitizeEmote(text: unknown): string {
  const s = typeof text === 'string' ? text.replace(/[\u0000-\u001f<>]/g, '').trim() : '';
  return [...s].slice(0, MAX_EMOTE_LENGTH).join('');
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseSettings(v: unknown): RaceSettings | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!finite(o.map) || o.map < 0 || typeof o.time !== 'string' || typeof o.weather !== 'string') return null;
  if (!TIMES.includes(o.time) || !WEATHER_IDS.includes(o.weather)) return null;
  return { map: Math.trunc(o.map), time: o.time, weather: o.weather };
}

/** 受け取ったメッセージの形を確かめる（壊れた・悪意のある入力は null） */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > 2000) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null) return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'hello':
      if (!finite(o.v) || !finite(o.map) || typeof o.car !== 'string') return null;
      return { t: 'hello', v: o.v, name: sanitizeName(o.name), car: o.car.slice(0, 16), map: Math.trunc(o.map), lights: o.lights === true };
    case 'state': {
      const s = o.s;
      if (!finite(o.time) || !Array.isArray(s) || s.length !== 6 || !s.every(finite)) return null;
      if (o.p !== undefined && !finite(o.p)) return null;
      return { t: 'state', time: o.time, s: s as CarState, ...(o.p !== undefined ? { p: o.p as number } : {}) };
    }
    case 'profile': {
      if (o.car !== undefined && typeof o.car !== 'string') return null;
      if (o.lights !== undefined && typeof o.lights !== 'boolean') return null;
      if (o.car === undefined && o.lights === undefined) return null;
      return { t: 'profile', ...(typeof o.car === 'string' ? { car: o.car.slice(0, 16) } : {}), ...(typeof o.lights === 'boolean' ? { lights: o.lights } : {}) };
    }
    case 'horn':
      return typeof o.on === 'boolean' ? { t: 'horn', on: o.on } : null;
    case 'emote': {
      const text = sanitizeEmote(o.text);
      return text ? { t: 'emote', text } : null;
    }
    case 'raceOpen': {
      const settings = parseSettings(o.settings);
      return settings ? { t: 'raceOpen', settings } : null;
    }
    case 'raceReady':
      return typeof o.ready === 'boolean' && typeof o.car === 'string' ? { t: 'raceReady', ready: o.ready, car: o.car.slice(0, 16) } : null;
    case 'raceStart':
      return { t: 'raceStart' };
    case 'raceFinish':
      return finite(o.seq) && finite(o.time) && o.time > 0 && o.time < 3600 ? { t: 'raceFinish', seq: o.seq, time: o.time } : null;
    case 'raceCancel':
      return { t: 'raceCancel' };
    case 'map':
      return finite(o.map) ? { t: 'map', map: Math.trunc(o.map) } : null;
    case 'ping':
      return finite(o.time) ? { t: 'ping', time: o.time } : null;
    default:
      return null;
  }
}
