import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BoxObstacle, MapObstacles } from '../map/obstacles';
import type { Terrain } from '../map/terrain';
import { type ParsedMap, type Tile, DIR_OFFSET, roadShape, tileCenter } from '../map/tilemap';
import { CONE_HALF_SIZE } from '../sim/physics';
import { SignFactory } from './signs';

const COLORS = {
  grass: 0x7fb069,
  rock: 0x8a7f72,
  outside: 0x5f8a4f,
  road: 0x4a4e57,
  line: 0xf2f2f2,
  centerLine: 0xf2c94c,
  wall: 0xb8b8b0,
  outerWall: 0x8d8d86,
  trunk: 0x7a5236,
  leaves: 0x3f8f4a,
  cone: 0xff7a1a,
  buildings: [0xe8d8c3, 0xc9d6df, 0xf0c5a8, 0xd9d2e9],
  roof: 0x6b6f78,
  guardrail: 0xe6e8ea,
  guardrailPost: 0x8c9196,
};

const ROAD_Y = 0.01;
const LINE_Y = 0.02;

/** XZ 平面上の長方形（y は高さ） */
function flatRect(cx: number, cz: number, sx: number, sz: number, y: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(sx, sz);
  g.rotateX(-Math.PI / 2);
  g.translate(cx, y, cz);
  return g;
}

/** 角 (cornerX, cornerZ) を中心に、タイル内側へ向かう 1/4 円弧の帯 */
function flatArc(
  cornerX: number,
  cornerZ: number,
  sx: number,
  sz: number,
  inner: number,
  outer: number,
  y: number,
): THREE.BufferGeometry {
  // RingGeometry は XY 平面。rotateX(-90°) で (x, y) → (x, 0, -y) になるので、
  // XZ 上の方向 (a, b) は XY 上の角度 atan2(-b, a) に対応する
  const diagonal = Math.atan2(sz, -sx);
  const g = new THREE.RingGeometry(inner, outer, 24, 1, diagonal - Math.PI / 4, Math.PI / 2);
  g.rotateX(-Math.PI / 2);
  g.translate(cornerX, y, cornerZ);
  return g;
}

function buildRoadGeometry(map: ParsedMap) {
  const { tileSize, roadWidth } = map.def;
  const half = tileSize / 2;
  const rw = roadWidth / 2;
  const road: THREE.BufferGeometry[] = [];
  const edgeLines: THREE.BufferGeometry[] = [];
  const centerLines: THREE.BufferGeometry[] = [];
  const lineW = 0.18;
  const edgeInset = 0.5;

  const addTile = (tile: Tile) => {
    const { x, z } = tileCenter(map, tile.col, tile.row);
    const shape = roadShape(tile);

    if (shape === 'curve') {
      const sx = tile.connections.includes('E') ? 1 : -1;
      const sz = tile.connections.includes('S') ? 1 : -1;
      const cx = x + sx * half;
      const cz = z + sz * half;
      road.push(flatArc(cx, cz, sx, sz, half - rw, half + rw, ROAD_Y));
      const inner = half - rw + edgeInset;
      const outer = half + rw - edgeInset;
      edgeLines.push(flatArc(cx, cz, sx, sz, inner - lineW / 2, inner + lineW / 2, LINE_Y));
      edgeLines.push(flatArc(cx, cz, sx, sz, outer - lineW / 2, outer + lineW / 2, LINE_Y));
      centerLines.push(flatArc(cx, cz, sx, sz, half - lineW / 2, half + lineW / 2, LINE_Y));
      return;
    }

    // 中央の正方形 + つながっている方向への腕
    road.push(flatRect(x, z, roadWidth, roadWidth, ROAD_Y));
    const armLen = half - rw;
    for (const d of tile.connections) {
      const { dc, dr } = DIR_OFFSET[d];
      const ax = x + dc * (rw + armLen / 2);
      const az = z + dr * (rw + armLen / 2);
      road.push(flatRect(ax, az, dc ? armLen : roadWidth, dr ? armLen : roadWidth, ROAD_Y));
    }

    if (shape === 'straight') {
      const alongX = tile.connections.includes('E');
      const edge = rw - edgeInset;
      for (const s of [-1, 1]) {
        edgeLines.push(
          alongX
            ? flatRect(x, z + s * edge, tileSize, lineW, LINE_Y)
            : flatRect(x + s * edge, z, lineW, tileSize, LINE_Y),
        );
      }
      // 破線のセンターライン
      for (const offset of [-half / 2, half / 2]) {
        centerLines.push(
          alongX
            ? flatRect(x + offset, z, 4, lineW, LINE_Y)
            : flatRect(x, z + offset, lineW, 4, LINE_Y),
        );
      }
    }
  };

  for (const tile of map.tiles) if (tile.kind === 'road') addTile(tile);

  return {
    road: mergeGeometries(road),
    edgeLines: edgeLines.length ? mergeGeometries(edgeLines) : null,
    centerLines: centerLines.length ? mergeGeometries(centerLines) : null,
  };
}

/** 平らに作ったジオメトリ（ワールド座標）の各頂点を、地形の高さだけ持ち上げる */
function liftGeometry(g: THREE.BufferGeometry, terrain: Terrain): THREE.BufferGeometry {
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + terrain.heightAt(pos.getX(i), pos.getZ(i)));
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** 地形の格子をそのままメッシュにする */
function terrainGeometry(terrain: Terrain): THREE.BufferGeometry {
  const { minX, minZ, step, nx, nz, ground } = terrain.grid;
  const w = (nx - 1) * step;
  const d = (nz - 1) * step;
  const g = new THREE.PlaneGeometry(w, d, nx - 1, nz - 1);
  g.rotateX(-Math.PI / 2);
  g.translate(minX + w / 2, 0, minZ + d / 2);
  // PlaneGeometry の頂点は、回転後に x が小さい順・z が小さい順に並ぶ
  const pos = g.attributes.position;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) pos.setY(j * nx + i, ground[j * nx + i]);
  }
  g.computeVertexNormals();
  // 急な斜面（道路の外の崖）は岩の色にして、落ちる場所だとわかるようにする
  const normal = g.attributes.normal;
  const colors = new Float32Array(normal.count * 3);
  const grass = new THREE.Color(COLORS.grass);
  const rock = new THREE.Color(COLORS.rock);
  const c = new THREE.Color();
  for (let k = 0; k < normal.count; k++) {
    const steep = Math.min(1, Math.max(0, (0.93 - normal.getY(k)) / 0.2));
    c.copy(grass).lerp(rock, steep).toArray(colors, k * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

export function buildMapMesh(map: ParsedMap, obstacles: MapObstacles, terrain: Terrain | null = null): THREE.Group {
  const group = new THREE.Group();
  const heightAt = (x: number, z: number) => (terrain ? terrain.heightAt(x, z) : 0);
  const lift = (g: THREE.BufferGeometry) => (terrain ? liftGeometry(g, terrain) : g);
  const { tileSize } = map.def;
  const half = tileSize / 2;
  const width = map.cols * tileSize;
  const depth = map.rows * tileSize;
  const centerX = width / 2 - half;
  const centerZ = depth / 2 - half;

  // 外側の地面と、マップ内の草地
  const outside = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: COLORS.outside }),
  );
  outside.position.set(centerX, terrain ? terrain.grid.ground.reduce((a, b) => Math.min(a, b), Infinity) - 2 : -0.02, centerZ);
  outside.receiveShadow = true;
  group.add(outside);

  const grass = new THREE.Mesh(
    terrain ? terrainGeometry(terrain) : flatRect(centerX, centerZ, width, depth, 0),
    terrain ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshLambertMaterial({ color: COLORS.grass }),
  );
  grass.receiveShadow = true;
  group.add(grass);

  // 道路と白線
  const roads = buildRoadGeometry(map);
  lift(roads.road);
  if (roads.edgeLines) lift(roads.edgeLines);
  if (roads.centerLines) lift(roads.centerLines);
  // 草地・道路・白線は高さの差が小さいので、ポリゴンオフセットで手前に描いてちらつきを防ぐ
  const layer = (n: number) => ({ polygonOffset: true, polygonOffsetFactor: -n, polygonOffsetUnits: -n });
  const roadMesh = new THREE.Mesh(
    roads.road,
    new THREE.MeshLambertMaterial({ color: COLORS.road, ...layer(1) }),
  );
  roadMesh.receiveShadow = true;
  group.add(roadMesh);
  if (roads.edgeLines) {
    group.add(
      new THREE.Mesh(roads.edgeLines, new THREE.MeshBasicMaterial({ color: COLORS.line, ...layer(2) })),
    );
  }
  if (roads.centerLines) {
    group.add(
      new THREE.Mesh(roads.centerLines, new THREE.MeshBasicMaterial({ color: COLORS.centerLine, ...layer(2) })),
    );
  }

  // 建物・壁
  const roofMat = new THREE.MeshLambertMaterial({ color: COLORS.roof });
  const buildingMats = COLORS.buildings.map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const wallMats = [
    new THREE.MeshLambertMaterial({ color: COLORS.wall }),
    new THREE.MeshLambertMaterial({ color: COLORS.outerWall }),
  ];
  const railMat = new THREE.MeshLambertMaterial({ color: COLORS.guardrail });
  const postMat = new THREE.MeshLambertMaterial({ color: COLORS.guardrailPost });
  for (const b of obstacles.boxes) {
    if (b.kind === 'guardrail') {
      group.add(createGuardrail(b, railMat, postMat, terrain));
      continue;
    }
    const mat = b.kind === 'building' ? buildingMats[b.variant % buildingMats.length] : wallMats[b.variant];
    if (b.kind === 'wall' && terrain) {
      // 長い壁は、地形に沿うよう短く区切って並べる
      for (const part of splitWall(b)) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(part.hx * 2, part.hy * 2 + 4, part.hz * 2), mat);
        mesh.position.set(part.x, part.y - 2 + heightAt(part.x, part.z), part.z);
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      continue;
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2), mat);
    mesh.position.set(b.x, b.y + heightAt(b.x, b.z), b.z);
    mesh.rotation.y = b.yaw ?? 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (b.kind === 'building') {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2 + 0.4, 0.4, b.hz * 2 + 0.4), roofMat);
      roof.position.set(b.x, b.y + b.hy + 0.2 + heightAt(b.x, b.z), b.z);
      roof.castShadow = true;
      group.add(roof);
    }
  }

  // 木
  const trunkMat = new THREE.MeshLambertMaterial({ color: COLORS.trunk });
  const leavesMat = new THREE.MeshLambertMaterial({ color: COLORS.leaves, flatShading: true });
  for (const t of obstacles.trees) {
    const trunkH = t.height * 0.4;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(t.trunkRadius, t.trunkRadius, trunkH, 8), trunkMat);
    // 坂の上でも浮かないよう、根元を少し埋める
    const base = terrain ? heightAt(t.x, t.z) - 0.5 : 0;
    trunk.position.set(t.x, base + trunkH / 2, t.z);
    trunk.castShadow = true;
    group.add(trunk);
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(t.height * 0.35, t.height * 0.7, 8), leavesMat);
    leaves.position.set(t.x, base + trunkH + t.height * 0.3, t.z);
    leaves.castShadow = true;
    group.add(leaves);
  }

  const signs = new SignFactory();
  for (const sign of obstacles.signs) {
    const mesh = signs.create(sign);
    mesh.position.y += heightAt(sign.x, sign.z);
    group.add(mesh);
  }

  return group;
}

/** ガードレール: 衝突体は箱だが、見た目は帯状のレールと支柱にする */
function createGuardrail(b: BoxObstacle, railMat: THREE.Material, postMat: THREE.Material, terrain: Terrain | null): THREE.Group {
  const g = new THREE.Group();
  const yaw = b.yaw ?? 0;
  if (terrain) {
    // 両端の高さの差だけ、長さの方向（ローカル +Z）に傾ける
    const fx = Math.sin(yaw) * b.hz;
    const fz = Math.cos(yaw) * b.hz;
    const front = terrain.heightAt(b.x + fx, b.z + fz);
    const back = terrain.heightAt(b.x - fx, b.z - fz);
    g.position.set(b.x, (front + back) / 2, b.z);
    g.rotation.set(-Math.atan2(front - back, b.hz * 2), yaw, 0, 'YXZ');
  } else {
    g.position.set(b.x, 0, b.z);
    g.rotation.y = yaw;
  }
  const top = b.hy * 2;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, b.hz * 2), railMat);
  rail.position.y = top - 0.22;
  rail.castShadow = true;
  g.add(rail);
  for (const z of [-b.hz * 0.85, b.hz * 0.85]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, top, 6), postMat);
    post.position.set(-0.08, top / 2, z);
    post.castShadow = true;
    g.add(post);
  }
  return g;
}

/** 壁の箱を長い方向に約 8m ずつ区切る */
function splitWall(b: BoxObstacle): BoxObstacle[] {
  const alongX = b.hx > b.hz;
  const len = (alongX ? b.hx : b.hz) * 2;
  const n = Math.max(1, Math.round(len / 8));
  const part = len / n;
  return Array.from({ length: n }, (_, i) => {
    const offset = -len / 2 + part * (i + 0.5);
    return alongX
      ? { ...b, x: b.x + offset, hx: part / 2 + 0.05 }
      : { ...b, z: b.z + offset, hz: part / 2 + 0.05 };
  });
}

/** コーン（動く小物）のメッシュ。位置は毎フレーム物理から同期する */
export function createConeMesh(): THREE.Mesh {
  const { radius, height } = CONE_HALF_SIZE;
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(radius, height * 2, 12),
    new THREE.MeshLambertMaterial({ color: COLORS.cone }),
  );
  mesh.castShadow = true;
  return mesh;
}
