/**
 * マルチプレイの通信内容（クライアントとサーバーで共有する）。
 * クライアント権威: 各プレイヤーが自分の車を計算し、状態を送り合う。サーバーは部屋ごとに中継するだけ。
 */

export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 8;
export const MAX_NAME_LENGTH = 12;
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
}

/**
 * 車の状態（JSON を小さくするため配列）。
 * [x, z, yaw, forwardSpeed, steerAngle, wheelSpin]
 */
export type CarState = [number, number, number, number, number, number];

export type ClientMessage =
  | { t: 'hello'; v: number; name: string; car: string; map: number }
  /** time: 送信側の時計 [ms]（受信側で補間に使う） */
  | { t: 'state'; time: number; s: CarState }
  | { t: 'profile'; car: string }
  | { t: 'map'; map: number }
  | { t: 'ping'; time: number };

export type ServerMessage =
  | { t: 'welcome'; id: number; color: number; players: PlayerInfo[]; map: number }
  | { t: 'join'; player: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'profile'; player: PlayerInfo }
  | { t: 'state'; id: number; time: number; s: CarState }
  | { t: 'map'; map: number; by: number }
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

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
      return { t: 'hello', v: o.v, name: sanitizeName(o.name), car: o.car.slice(0, 16), map: Math.trunc(o.map) };
    case 'state': {
      const s = o.s;
      if (!finite(o.time) || !Array.isArray(s) || s.length !== 6 || !s.every(finite)) return null;
      return { t: 'state', time: o.time, s: s as CarState };
    }
    case 'profile':
      return typeof o.car === 'string' ? { t: 'profile', car: o.car.slice(0, 16) } : null;
    case 'map':
      return finite(o.map) ? { t: 'map', map: Math.trunc(o.map) } : null;
    case 'ping':
      return finite(o.time) ? { t: 'ping', time: o.time } : null;
    default:
      return null;
  }
}
