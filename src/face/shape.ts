/**
 * 顔写真から読み取った顔の形（MediaPipe の顔の特徴点）を、キャラクターの頭に付ける立体にする。
 * 描画に依存しない計算だけをここに置く。
 *
 * 特徴点は顔写真のテクスチャ上の位置（x, y は 0〜1、z は x と同じ尺度の奥行きで、カメラに近いほど小さい）。
 */

/** 特徴点を [x0, y0, z0, x1, y1, z1, ...] と並べたもの */
export type FacePoints = number[];

export interface FaceMeshData {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
}

/** 顔の縦の長さを、頭の直径に対してこの割合にする */
const FACE_HEIGHT_RATIO = 0.95;
/** 鼻の頭を、頭の球の表面からこれだけ前に出す（頭の半径に対する割合） */
const NOSE_OUT_RATIO = 0.14;
/** 頭の球より奥に入った部分は球の表面に沿わせる。そのつなぎ目をなめらかにする幅 [m] */
const BLEND = 0.01;
/** 顔を球の表面からわずかに浮かせて、球とちらつかないようにする [m] */
const SURFACE_GAP = 0.002;

function smoothMax(a: number, b: number, k: number): number {
  return (a + b + Math.sqrt((a - b) * (a - b) + k * k)) / 2;
}

/**
 * 特徴点と三角形（特徴点の番号を3つずつ）から、半径 radius の頭に付ける顔の立体を作る。
 * 頭の座標は +Z が顔の正面、+Y が上、正面から見て右が -X（写真の右が -X）。
 */
export function buildFaceMesh(points: FacePoints, triangles: ArrayLike<number>, radius: number): FaceMeshData {
  const n = points.length / 3;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, points[i * 3]);
    maxX = Math.max(maxX, points[i * 3]);
    minY = Math.min(minY, points[i * 3 + 1]);
    maxY = Math.max(maxY, points[i * 3 + 1]);
    minZ = Math.min(minZ, points[i * 3 + 2]);
  }
  const scale = (2 * radius * FACE_HEIGHT_RATIO) / Math.max(1e-6, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // 一番手前の点（鼻の頭）が、球の正面から少し出るように奥行きをずらす
  const front = radius * (1 + NOSE_OUT_RATIO);

  const positions = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
    const px = (cx - x) * scale;
    const py = (cy - y) * scale;
    const face = front - (z - minZ) * scale;
    const sphere = Math.sqrt(Math.max(0, radius * radius - px * px - py * py)) + SURFACE_GAP;
    positions.set([px, py, smoothMax(face, sphere, BLEND)], i * 3);
    uvs.set([x, 1 - y], i * 2);
  }

  // 三角形の向きを正面（+Z）にそろえる（表から見えるように）
  const indices = new Uint16Array(triangles.length - (triangles.length % 3));
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const abx = positions[b * 3] - positions[a * 3];
    const aby = positions[b * 3 + 1] - positions[a * 3 + 1];
    const acx = positions[c * 3] - positions[a * 3];
    const acy = positions[c * 3 + 1] - positions[a * 3 + 1];
    const facingFront = abx * acy - aby * acx >= 0;
    indices.set(facingFront ? [a, b, c] : [a, c, b], t);
  }
  return { positions, uvs, indices };
}

/** 保存用に小数を丸めて文字列にする（478 点で 10KB ほど） */
export function encodeFacePoints(points: FacePoints): string {
  return JSON.stringify(points.map((v) => Math.round(v * 10000) / 10000));
}

/** 保存したものを読み戻す。形がおかしければ null */
export function decodeFacePoints(text: string | null): FacePoints | null {
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text);
    if (!Array.isArray(v) || v.length < 9 || v.length % 3 !== 0) return null;
    if (!v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
    return v as number[];
  } catch {
    return null;
  }
}
