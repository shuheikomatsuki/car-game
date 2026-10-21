import { describe, expect, it } from 'vitest';
import { RemoteTrack } from './interpolation';
import type { CarState } from './protocol';

const state = (x: number, yaw = 0, speed = 10): CarState => [x, 0, yaw, speed, 0, 0];

describe('RemoteTrack', () => {
  it('returns nothing before the first state', () => {
    expect(new RemoteTrack().sample(0)).toBeNull();
  });

  it('interpolates between received states, a little in the past', () => {
    const track = new RemoteTrack(100);
    // 送信側の時計は 5000ms 進んでいて、届くまで 30ms かかる
    for (let i = 0; i <= 10; i++) track.push(5000 + i * 50, state(i), 30 + i * 50);
    // いま 530ms → 送信側の 5500 - 100 = 5400 → x = 8
    const s = track.sample(530)!;
    expect(s[0]).toBeCloseTo(8);
    expect(track.sample(555)![0]).toBeCloseTo(8.5);
  });

  it('estimates the clock offset from the fastest packets despite jitter', () => {
    const track = new RemoteTrack(100);
    const jitter = [40, 0, 25, 10, 35, 5, 30, 0, 20, 15];
    jitter.forEach((j, i) => track.push(i * 50, state(i), 20 + i * 50 + j));
    // ずれは 20ms と推定されるはず: いま 470 → 送信側の 450 - 100 = 350 → x = 7
    expect(track.sample(470)![0]).toBeCloseTo(7, 1);
  });

  it('drops out-of-order states', () => {
    const track = new RemoteTrack(0);
    track.push(100, state(2), 100);
    track.push(50, state(1), 101);
    expect(track.sample(100)![0]).toBe(2);
  });

  it('wraps yaw through ±π when interpolating', () => {
    const track = new RemoteTrack(0);
    track.push(0, state(0, Math.PI - 0.1), 0);
    track.push(100, state(0, -Math.PI + 0.1), 100);
    const yaw = track.sample(50)![2];
    expect(Math.abs(Math.abs(yaw) - Math.PI)).toBeLessThan(1e-6);
  });

  it('extrapolates from the last speed for a short while when states stop arriving', () => {
    const track = new RemoteTrack(0, 300);
    track.push(0, state(0, Math.PI / 2, 10), 0);
    track.push(100, state(1, Math.PI / 2, 10), 100);
    // 200ms 後 → 東（+X）へ 10m/s で 0.1s → x = 2
    expect(track.sample(200)![0]).toBeCloseTo(2);
    // 予測は 300ms まで
    expect(track.sample(2000)![0]).toBeCloseTo(4);
    expect(track.silenceMs(2000)).toBe(1900);
  });
});
