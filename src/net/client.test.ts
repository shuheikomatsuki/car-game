import { describe, expect, it } from 'vitest';
import { roomSocketUrl } from './client';

describe('roomSocketUrl', () => {
  it('turns the server URL into the room WebSocket URL', () => {
    expect(roomSocketUrl('https://car-game-server.example.workers.dev', 'ABCD')).toBe(
      'wss://car-game-server.example.workers.dev/rooms/ABCD',
    );
    expect(roomSocketUrl('http://localhost:8787/', 'WXYZ')).toBe('ws://localhost:8787/rooms/WXYZ');
  });
});
