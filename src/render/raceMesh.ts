import * as THREE from 'three';
import type { Terrain } from '../map/terrain';
import type { Course } from '../race/course';
import { CarMesh } from './carMesh';

/** スタートラインと、一本道のコースならゴールライン */
export function buildRaceLines(course: Course, terrain: Terrain | null): THREE.Group {
  const group = new THREE.Group();
  group.add(buildLine(course, course.line, terrain));
  if (!course.closed) group.add(buildLine(course, course.finishLine, terrain));
  return group;
}

/** スタート／ゴールラインの市松模様と、その上のゲート */
function buildLine(course: Course, at: { x: number; z: number; yaw: number }, terrain: Terrain | null): THREE.Group {
  const group = new THREE.Group();
  const width = course.map.def.roadWidth;
  const cell = 1;
  const columns = Math.round(width / cell);
  const canvas = document.createElement('canvas');
  canvas.width = columns * 8;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  for (let c = 0; c < columns; c++) {
    for (let r = 0; r < 2; r++) {
      ctx.fillStyle = (c + r) % 2 === 0 ? '#f4f4f4' : '#1d1d1f';
      ctx.fillRect(c * 8, r * 8, 8, 8);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(columns * cell, cell * 2),
    new THREE.MeshLambertMaterial({ map: texture }),
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 0.03;
  strip.receiveShadow = true;
  group.add(strip);

  // ゲート: 道路の両脇の柱と、上に渡した横断幕
  const postMat = new THREE.MeshLambertMaterial({ color: 0x8c9196 });
  const halfSpan = width / 2 + 1.2;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), postMat);
    post.position.set(s * halfSpan, 3, 0);
    post.castShadow = true;
    group.add(post);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 0.4, 1.2, 0.3), new THREE.MeshLambertMaterial({ map: texture }));
  banner.position.set(0, 6, 0);
  banner.castShadow = true;
  group.add(banner);

  // 横幅の向き（X）を道路の横方向に合わせる。yaw は前方 +Z からの回転なので、そのまま回せばよい
  if (terrain) {
    // 坂の途中なら、進行方向の勾配に合わせて傾ける
    const g = terrain.gradientAt(at.x, at.z);
    const slope = g.x * Math.sin(at.yaw) + g.z * Math.cos(at.yaw);
    group.position.set(at.x, terrain.heightAt(at.x, at.z), at.z);
    group.rotation.set(-Math.atan(slope), at.yaw, 0, 'YXZ');
  } else {
    group.position.set(at.x, 0, at.z);
    group.rotation.y = at.yaw;
  }
  return group;
}

/** 自己ベストの走りを再生する、半透明の車 */
export function createGhostMesh(color = 0x7fd4ff): CarMesh {
  const mesh = new CarMesh(color);
  const materials = new Map<THREE.Material, THREE.Material>();
  mesh.root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.castShadow = false;
    const swap = (m: THREE.Material) => {
      let ghost = materials.get(m);
      if (!ghost) {
        ghost = m.clone();
        ghost.transparent = true;
        ghost.opacity = 0.35;
        ghost.depthWrite = false;
        materials.set(m, ghost);
      }
      return ghost;
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(swap) : swap(obj.material);
  });
  return mesh;
}
