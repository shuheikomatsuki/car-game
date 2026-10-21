import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS, PROTOCOL_VERSION, type ServerMessage } from '../../src/net/protocol';
import { type Connection, type RoomStore, handleClose, handleMessage } from './room';

class FakeConnection implements Connection {
  info: Connection['info'] = null;
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
  const store: RoomStore = { getMap: () => map, setMap: (m) => (map = m) };
  const all: FakeConnection[] = [];
  const connect = () => {
    const c = new FakeConnection();
    all.push(c);
    return c;
  };
  const send = (c: FakeConnection, m: object) => handleMessage(c, all, JSON.stringify(m), store);
  const hello = (c: FakeConnection, name: string, mapIndex = 0) =>
    send(c, { t: 'hello', v: PROTOCOL_VERSION, name, car: 'standard', map: mapIndex });
  const disconnect = (c: FakeConnection) => {
    handleClose(c, all);
    all.splice(all.indexOf(c), 1);
  };
  return { all, store, connect, send, hello, disconnect };
}

describe('room relay', () => {
  it('welcomes players, tells others about them and relays car states', () => {
    const room = createRoom();
    const a = room.connect();
    room.hello(a, 'あや', 1);
    expect(a.take()).toEqual([{ t: 'welcome', id: 1, color: 0, players: [], map: 1 }]);

    const b = room.connect();
    // 後から入った人のマップではなく、部屋のマップに合わせる
    room.hello(b, 'ぼく', 0);
    expect(b.take()).toEqual([
      { t: 'welcome', id: 2, color: 1, players: [{ id: 1, name: 'あや', car: 'standard', color: 0 }], map: 1 },
    ]);
    expect(a.take()).toEqual([{ t: 'join', player: { id: 2, name: 'ぼく', car: 'standard', color: 1 } }]);

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
    expect(a.take()).toEqual([{ t: 'profile', player: { id: 2, name: 'b', car: 'sport', color: 1 } }]);
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
    expect(a.info?.name).toBe('bとてもながいなまえです');
    const b = room.connect();
    room.send(b, { t: 'hello', v: PROTOCOL_VERSION, name: '   ', car: 'x', map: 0 });
    expect(b.info?.name).toBe('ゲスト');
  });
});
