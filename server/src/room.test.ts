import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS, PROTOCOL_VERSION, type RaceState, type ServerMessage } from '../../src/net/protocol';
import {
  type Connection,
  HELLO_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  RACE_TIMEOUT_MS,
  type RoomStore,
  closeIdle,
  handleClose,
  handleMessage,
  newActivity,
} from './room';

class FakeConnection implements Connection {
  info: Connection['info'] = null;
  activity = newActivity(0);
  inbox: ServerMessage[] = [];
  closed: string | null = null;
  send(m: ServerMessage) {
    this.inbox.push(m);
  }
  close(_code: number, reason: string) {
    this.closed = reason;
  }
  take() {
    return this.inbox.splice(0);
  }
}

function createRoom() {
  let map = 0;
  let race: RaceState | null = null;
  const store: RoomStore = { getMap: () => map, setMap: (m) => (map = m), getRace: () => race, setRace: (r) => (race = r) };
  const all: FakeConnection[] = [];
  const connect = () => {
    const c = new FakeConnection();
    all.push(c);
    return c;
  };
  const clock = { now: 0 };
  const send = (c: FakeConnection, m: object) => handleMessage(c, all, JSON.stringify(m), store, clock.now);
  const hello = (c: FakeConnection, name: string, mapIndex = 0) =>
    send(c, { t: 'hello', v: PROTOCOL_VERSION, name, car: 'standard', map: mapIndex });
  const disconnect = (c: FakeConnection) => {
    handleClose(c, all, store);
    all.splice(all.indexOf(c), 1);
  };
  return { all, store, clock, connect, send, hello, disconnect };
}

describe('room relay', () => {
  it('welcomes players, tells others about them and relays car states', () => {
    const room = createRoom();
    const a = room.connect();
    room.hello(a, 'あや', 1);
    expect(a.take()).toEqual([{ t: 'welcome', id: 1, color: 0, players: [], map: 1, race: null }]);

    const b = room.connect();
    // 後から入った人のマップではなく、部屋のマップに合わせる
    room.hello(b, 'ぼく', 0);
    expect(b.take()).toEqual([
      { t: 'welcome', id: 2, color: 1, players: [{ id: 1, name: 'あや', car: 'standard', color: 0, lights: false }], map: 1, race: null },
    ]);
    expect(a.take()).toEqual([{ t: 'join', player: { id: 2, name: 'ぼく', car: 'standard', color: 1, lights: false } }]);

    room.send(a, { t: 'state', time: 100, s: [1, 2, 0.5, 3, 0.1, 4] });
    expect(b.take()).toEqual([{ t: 'state', id: 1, time: 100, s: [1, 2, 0.5, 3, 0.1, 4] }]);
    expect(a.take()).toEqual([]);
  });

  it('ignores states from connections that have not said hello, and rejects broken messages', () => {
    const room = createRoom();
    const a = room.connect();
    room.hello(a, 'a');
    a.take();
    const lurker = room.connect();
    room.send(lurker, { t: 'state', time: 1, s: [0, 0, 0, 0, 0, 0] });
    expect(a.take()).toEqual([]);
    handleMessage(lurker, room.all, '{not json', room.store);
    room.send(a, { t: 'state', time: 1, s: [0, 0, 0, 'x', 0, 0] });
    expect(lurker.take()).toEqual([{ t: 'error', reason: 'badRequest' }]);
    expect(a.take()).toEqual([{ t: 'error', reason: 'badRequest' }]);
  });

  it('announces leaving players and reuses ids and colors', () => {
    const room = createRoom();
    const a = room.connect();
    const b = room.connect();
    room.hello(a, 'a');
    room.hello(b, 'b');
    room.disconnect(a);
    expect(b.take().at(-1)).toEqual({ t: 'leave', id: 1 });
    const c = room.connect();
    room.hello(c, 'c');
    expect(c.take()[0]).toMatchObject({ t: 'welcome', id: 3 });
    expect(c.info?.color).toBe(0);
  });

  it('shares map changes and profile changes', () => {
    const room = createRoom();
    const a = room.connect();
    const b = room.connect();
    room.hello(a, 'a');
    room.hello(b, 'b');
    a.take();
    b.take();
    room.send(a, { t: 'map', map: 1 });
    expect(room.store.getMap()).toBe(1);
    expect(b.take()).toEqual([{ t: 'map', map: 1, by: 1 }]);
    room.send(b, { t: 'profile', car: 'sport' });
    expect(a.take()).toEqual([{ t: 'profile', player: { id: 2, name: 'b', car: 'sport', color: 1, lights: false } }]);
  });

  it('refuses players when the room is full or the version differs', () => {
    const room = createRoom();
    for (let i = 0; i < MAX_PLAYERS; i++) room.hello(room.connect(), `p${i}`);
    const late = room.connect();
    room.hello(late, 'late');
    expect(late.take()).toEqual([{ t: 'error', reason: 'full' }]);
    expect(late.closed).toBe('full');

    const old = createRoom();
    const o = old.connect();
    old.send(o, { t: 'hello', v: 0, name: 'o', car: 'standard', map: 0 });
    expect(o.closed).toBe('version');
  });

  it('sanitizes names', () => {
    const room = createRoom();
    const a = room.connect();
    room.send(a, { t: 'hello', v: PROTOCOL_VERSION, name: '<b>とてもながいなまえですよほんとうに</b>', car: 'x', map: 0 });
    expect(a.info?.name).toBe('bとてもながいなまえ');
    const b = room.connect();
    room.send(b, { t: 'hello', v: PROTOCOL_VERSION, name: '   ', car: 'x', map: 0 });
    expect(b.info?.name).toBe('ゲスト');
  });
});

describe('idle connections', () => {
  const state = (x: number) => ({ t: 'state', time: 0, s: [x, 0, 0, 0, 0, 0] });

  it('drops connections that never say hello', () => {
    const room = createRoom();
    const a = room.connect();
    expect(closeIdle(room.all, HELLO_TIMEOUT_MS - 1)).toBe(1);
    expect(a.closed).toBeNull();
    expect(closeIdle(room.all, HELLO_TIMEOUT_MS)).toBe(0);
    expect(a.closed).toBe('noHello');
  });

  it('drops players whose car has not moved, and tells the others', () => {
    const room = createRoom();
    const a = room.connect();
    const b = room.connect();
    room.hello(a, 'あや');
    room.hello(b, 'ぼく');
    room.send(a, state(0));
    room.send(b, state(0));

    // a は運転し続け、b は止まったまま位置を送り続ける
    for (let t = 1; t <= 10; t++) {
      room.clock.now = (IDLE_TIMEOUT_MS / 10) * t;
      room.send(a, state(t * 5));
      room.send(b, state(0.1));
    }
    a.take();
    expect(closeIdle(room.all, room.clock.now)).toBe(1);
    expect(a.closed).toBeNull();
    expect(b.closed).toBe('idle');
    expect(b.take().at(-1)).toEqual({ t: 'error', reason: 'idle' });
    expect(a.take()).toEqual([{ t: 'leave', id: 2 }]);
  });

  it('counts changing the car or the map as activity', () => {
    const room = createRoom();
    const a = room.connect();
    room.hello(a, 'あや');
    room.clock.now = IDLE_TIMEOUT_MS - 1;
    room.send(a, { t: 'profile', car: 'sport' });
    expect(closeIdle(room.all, IDLE_TIMEOUT_MS + 1)).toBe(1);
  });

  it('relays lights, horns and emotes, and limits how often they can be sent', () => {
    const room = createRoom();
    const a = room.connect();
    const b = room.connect();
    room.hello(a, 'a');
    room.hello(b, 'b');
    a.take();
    b.take();
    room.send(a, { t: 'profile', lights: true });
    expect(b.take()).toEqual([{ t: 'profile', player: { id: 1, name: 'a', car: 'standard', color: 0, lights: true } }]);
    room.send(a, { t: 'horn', on: true });
    room.send(a, { t: 'horn', on: false });
    room.send(a, { t: 'horn', on: true });
    expect(b.take()).toEqual([
      { t: 'horn', id: 1, on: true },
      { t: 'horn', id: 1, on: false },
    ]);
    room.send(a, { t: 'emote', text: 'よろしく！' });
    room.send(a, { t: 'emote', text: 'お先に！' });
    // 自分にも返る。続けて送った分は捨てる
    expect(a.take()).toEqual([{ t: 'emote', id: 1, text: 'よろしく！' }]);
    expect(b.take()).toEqual([{ t: 'emote', id: 1, text: 'よろしく！' }]);
    room.clock.now += 2000;
    room.send(a, { t: 'emote', text: 'お先に！' });
    expect(b.take()).toEqual([{ t: 'emote', id: 1, text: 'お先に！' }]);
  });
});

describe('room race', () => {
  const settings = { map: 3, time: 'night', weather: 'rain' };
  const lastRace = (c: FakeConnection) => c.take().filter((m) => m.t === 'race').at(-1) as Extract<ServerMessage, { t: 'race' }> | undefined;

  function threePlayers() {
    const room = createRoom();
    const [a, b, c] = [room.connect(), room.connect(), room.connect()];
    room.hello(a, 'a');
    room.hello(b, 'b');
    room.hello(c, 'c');
    for (const x of [a, b, c]) x.take();
    return { room, a, b, c };
  }

  it('opens an entry, lets players get ready with their own car, and starts', () => {
    const { room, a, b, c } = threePlayers();
    room.send(a, { t: 'raceOpen', settings });
    expect(room.store.getMap()).toBe(3);
    expect(lastRace(b)?.race).toMatchObject({ phase: 'entry', settings, host: 1, entrants: [], seq: 1 });
    room.send(b, { t: 'raceReady', ready: true, car: 'fd3s' });
    room.send(a, { t: 'raceReady', ready: true, car: 'ae86' });
    // エントリー中に他の人は条件を変えられず、コースも変えられない
    room.send(c, { t: 'raceOpen', settings: { ...settings, map: 1 } });
    room.send(c, { t: 'map', map: 5 });
    expect(room.store.getMap()).toBe(3);
    const msgs = c.take();
    expect(msgs.find((m) => m.t === 'profile')).toEqual({ t: 'profile', player: { id: 2, name: 'b', car: 'fd3s', color: 1, lights: false } });
    expect((msgs.filter((m) => m.t === 'race').at(-1) as Extract<ServerMessage, { t: 'race' }>).race?.entrants).toEqual([2, 1]);
    // 全員が準備 OK になるまではスタートできない
    room.send(a, { t: 'raceStart' });
    expect(lastRace(c)).toBeUndefined();
    room.send(c, { t: 'raceReady', ready: true, car: 'ae86' });
    c.take();
    // 言い出した人だけがスタートできる
    room.send(b, { t: 'raceStart' });
    expect(lastRace(c)).toBeUndefined();
    room.clock.now = 5000;
    room.send(a, { t: 'raceStart' });
    expect(lastRace(c)).toMatchObject({ start: true, race: { phase: 'racing', entrants: [2, 1, 3], startedAt: 5000 } });
    // 対戦中は新しく言い出せない
    room.send(c, { t: 'raceOpen', settings });
    expect(lastRace(c)).toBeUndefined();
  });

  it('records finishes in order and ends when everyone has finished', () => {
    const { room, a, b, c } = threePlayers();
    room.send(a, { t: 'raceOpen', settings });
    room.send(a, { t: 'raceReady', ready: true, car: 'ae86' });
    room.send(b, { t: 'raceReady', ready: true, car: 'ae86' });
    room.send(c, { t: 'raceReady', ready: true, car: 'ae86' });
    room.send(a, { t: 'raceStart' });
    // スタートの後に来た人は見ているだけ
    const d = room.connect();
    room.hello(d, 'd');
    c.take();
    // 走っていない人・古い対戦のゴールは数えない
    room.send(d, { t: 'raceFinish', seq: 1, time: 50 });
    room.send(b, { t: 'raceFinish', seq: 0, time: 50 });
    expect(lastRace(c)).toBeUndefined();
    room.send(b, { t: 'raceFinish', seq: 1, time: 61.5 });
    expect(lastRace(c)?.race?.finished).toEqual([{ id: 2, time: 61.5 }]);
    room.send(a, { t: 'raceFinish', seq: 1, time: 63 });
    room.send(c, { t: 'raceFinish', seq: 1, time: 64 });
    const msgs = d.take().filter((m) => m.t === 'race') as Extract<ServerMessage, { t: 'race' }>[];
    expect(msgs.map((m) => m.race?.finished.length ?? null)).toEqual([1, 2, 3, null]);
    expect(room.store.getRace()).toBeNull();
  });

  it('drops players who leave, and cancels when the host leaves the entry', () => {
    const { room, a, b, c } = threePlayers();
    room.send(a, { t: 'raceOpen', settings });
    room.send(a, { t: 'raceReady', ready: true, car: 'ae86' });
    room.send(b, { t: 'raceReady', ready: true, car: 'ae86' });
    room.send(c, { t: 'raceReady', ready: true, car: 'ae86' });
    room.send(a, { t: 'raceStart' });
    room.send(a, { t: 'raceFinish', seq: 1, time: 60 });
    room.send(c, { t: 'raceFinish', seq: 1, time: 61 });
    c.take();
    // まだ走っている人が抜けたら、残りが全員ゴール済みなので終わる
    room.disconnect(b);
    expect(room.store.getRace()).toBeNull();

    room.send(c, { t: 'raceOpen', settings });
    room.send(a, { t: 'raceReady', ready: true, car: 'ae86' });
    room.send(c, { t: 'raceCancel' });
    expect(room.store.getRace()).toBeNull();
    room.send(c, { t: 'raceOpen', settings });
    room.disconnect(c);
    expect(room.store.getRace()).toBeNull();
    expect(lastRace(a)?.race).toBeNull();
  });

  it('gives up races that never end', () => {
    const { room, a, b, c } = threePlayers();
    room.send(a, { t: 'raceOpen', settings });
    for (const x of [a, b, c]) room.send(x, { t: 'raceReady', ready: true, car: 'ae86' });
    room.send(a, { t: 'raceStart' });
    b.take();
    room.clock.now = RACE_TIMEOUT_MS + 1;
    // 動いていることにする
    for (const x of room.all) x.activity = { ...x.activity, lastActive: room.clock.now };
    closeIdle(room.all, room.clock.now, room.store);
    expect(room.store.getRace()).toBeNull();
    expect(lastRace(b)?.race).toBeNull();
  });
});
