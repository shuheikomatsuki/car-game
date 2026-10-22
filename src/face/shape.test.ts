import { describe, expect, it } from 'vitest';
import { buildFaceMesh, decodeFacePoints, encodeFacePoints } from './shape';

const R = 0.1;
/** 正面を向いた簡単な「顔」: 中央（鼻）が手前に出た 3x3 の点 */
function sampleFace() {
  const points: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const nose = row === 1 && col === 1;
      points.push(0.3 + col * 0.2, 0.2 + row * 0.3, nose ? -0.08 : 0);
    }
  }
  // 時計回り・反時計回りを混ぜた三角形
  const triangles = [0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 3, 4, 7, 3, 7, 6, 4, 5, 8, 4, 8, 7];
  return { points, triangles };
}

describe('buildFaceMesh', () => {
  it('fits the face to the head height and centers it', () => {
    const { points, triangles } = sampleFace();
    const mesh = buildFaceMesh(points, triangles, R);
    const ys = [...mesh.positions].filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2 * R * 0.95);
    expect(Math.max(...ys) + Math.min(...ys)).toBeCloseTo(0);
    // 写真の右側（x が大きい）は -X
    expect(mesh.positions[2 * 3]).toBeLessThan(0);
    // 写真の上（y が小さい）は +Y
    expect(mesh.positions[1]).toBeGreaterThan(0);
  });

  it('puts the nose in front of the head and keeps every point on or outside the head', () => {
    const { points, triangles } = sampleFace();
    const mesh = buildFaceMesh(points, triangles, R);
    const z = (i: number) => mesh.positions[i * 3 + 2];
    expect(z(4)).toBeGreaterThan(R);
    for (let i = 0; i < 9; i++) {
      const [x, y] = [mesh.positions[i * 3], mesh.positions[i * 3 + 1]];
      const sphere = Math.sqrt(Math.max(0, R * R - x * x - y * y));
      expect(z(i)).toBeGreaterThanOrEqual(sphere);
    }
  });

  it('maps the photo onto the face and turns every triangle to the front', () => {
    const { points, triangles } = sampleFace();
    const mesh = buildFaceMesh(points, triangles, R);
    expect(mesh.uvs[0]).toBeCloseTo(0.3);
    expect(mesh.uvs[1]).toBeCloseTo(0.8);
    const p = mesh.positions;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = mesh.indices.slice(t, t + 3);
      const cross = (p[b * 3] - p[a * 3]) * (p[c * 3 + 1] - p[a * 3 + 1]) - (p[b * 3 + 1] - p[a * 3 + 1]) * (p[c * 3] - p[a * 3]);
      expect(cross).toBeGreaterThan(0);
    }
  });
});

describe('face points storage', () => {
  it('round-trips with rounding and rejects broken data', () => {
    const points = [0.123456, 0.5, -0.01, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
    const back = decodeFacePoints(encodeFacePoints(points))!;
    expect(back[0]).toBeCloseTo(0.1235, 4);
    expect(back.length).toBe(9);
    expect(decodeFacePoints(null)).toBeNull();
    expect(decodeFacePoints('{"a":1}')).toBeNull();
    expect(decodeFacePoints('[1,2]')).toBeNull();
    expect(decodeFacePoints('not json')).toBeNull();
  });
});
