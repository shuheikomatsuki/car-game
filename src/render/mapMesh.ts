import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BARRIER_HEIGHT, type BoxObstacle, type MapObstacles } from '../map/obstacles';
import { type Shortcut, shortcutPoint } from '../map/shortcuts';
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
  shortcut: 0xa9a59b,
  water: 0x2f6f9a,
  bank: 0x8a8478,
  city: 0x6b6d70,
  concrete: 0xc4c2bb,
  deck: 0x9a9890,
  lamp: 0xffc46b,
};

/** 川の水面の深さ（地面からの高さの差）[m] */
const WATER_DEPTH = 3;
/** 橋・高架の床の厚さ [m] */
const DECK_THICKNESS = 1.4;

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
  // 車線の境目（中央からのずれ）。高架の道路は車線の数で区切り、それ以外は中央の1本
  const lanes = map.def.highway?.lanes ?? 2;
  const dividers = Array.from({ length: lanes - 1 }, (_, i) => -roadWidth / 2 + (roadWidth * (i + 1)) / lanes);
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
      for (const d of dividers) centerLines.push(flatArc(cx, cz, sx, sz, half + d - lineW / 2, half + d + lineW / 2, LINE_Y));
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
      // 破線のセンターライン（車線の境目）
      for (const d of dividers) {
        for (const offset of [-half / 2, half / 2]) {
          centerLines.push(
            alongX
              ? flatRect(x + offset, z + d, 4, lineW, LINE_Y)
              : flatRect(x + d, z + offset, lineW, 4, LINE_Y),
          );
        }
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

  // 外側の地面と、マップ内の草地。高架のマップは地面（街・海）が下にあり、川のあるマップは水の所に穴をあける
  const highway = map.def.highway;
  const hasWater = map.tiles.some((t) => t.kind === 'water' || t.bridge);
  const lowY = highway ? -highway.depth : -WATER_DEPTH;
  const outsideY = terrain ? terrain.grid.ground.reduce((a, b) => Math.min(a, b), Infinity) - 2 : highway ? lowY - 0.05 : -0.02;
  const outsideMat = new THREE.MeshLambertMaterial({ color: highway ? COLORS.city : COLORS.outside });
  if (hasWater && !highway && !terrain) {
    // マップの周りだけを囲む（水面を覆わないように）
    const big = 2000;
    for (const [cx, cz, sx, sz] of [
      [centerX, centerZ - depth / 2 - big / 2, big + width, big],
      [centerX, centerZ + depth / 2 + big / 2, big + width, big],
      [centerX - width / 2 - big / 2, centerZ, big, depth],
      [centerX + width / 2 + big / 2, centerZ, big, depth],
    ]) {
      const m = new THREE.Mesh(flatRect(cx, cz, sx, sz, outsideY), outsideMat);
      m.receiveShadow = true;
      group.add(m);
    }
  } else {
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), outsideMat);
    outside.position.set(centerX, outsideY, centerZ);
    outside.receiveShadow = true;
    group.add(outside);
  }

  const isWet = (t: Tile | undefined) => t !== undefined && (t.kind === 'water' || t.bridge);
  let grassGeo: THREE.BufferGeometry;
  if (terrain) grassGeo = terrainGeometry(terrain);
  else if (highway) grassGeo = flatRect(centerX, centerZ, width, depth, lowY);
  else if (hasWater) {
    grassGeo = mergeGeometries(
      map.tiles.filter((t) => !isWet(t)).map((t) => {
        const c = tileCenter(map, t.col, t.row);
        return flatRect(c.x, c.z, tileSize, tileSize, 0);
      }),
    );
  } else grassGeo = flatRect(centerX, centerZ, width, depth, 0);
  const grass = new THREE.Mesh(
    grassGeo,
    terrain
      ? new THREE.MeshLambertMaterial({ vertexColors: true })
      : new THREE.MeshLambertMaterial({ color: highway ? COLORS.city : COLORS.grass }),
  );
  grass.receiveShadow = true;
  group.add(grass);
  if (!terrain && (hasWater || highway)) group.add(buildWaterAndDecks(map, lowY, isWet));

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
      // 高架（高速道路）の車線の境目は白
      new THREE.Mesh(roads.centerLines, new THREE.MeshBasicMaterial({ color: highway ? COLORS.line : COLORS.centerLine, ...layer(2) })),
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
  const barriers: THREE.BufferGeometry[] = [];
  for (const b of obstacles.boxes) {
    if (b.kind === 'guardrail') {
      group.add(createGuardrail(b, railMat, postMat, terrain));
      continue;
    }
    if (b.kind === 'barrier') {
      const g = new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2);
      g.rotateY(b.yaw ?? 0);
      g.translate(b.x, b.y, b.z);
      barriers.push(g);
      continue;
    }
    // 高架のマップでは、マップの外周の壁は見せない（下の街の上に浮いて見えるので）
    if (b.kind === 'wall' && highway) continue;
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

  if (barriers.length) {
    const mesh = new THREE.Mesh(mergeGeometries(barriers), new THREE.MeshLambertMaterial({ color: COLORS.concrete }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (highway) group.add(buildStreetLamps(map));

  // 木
  const trunkMat = new THREE.MeshLambertMaterial({ color: COLORS.trunk });
  const leavesMat = new THREE.MeshLambertMaterial({ color: COLORS.leaves, flatShading: true });
  for (const t of obstacles.trees) {
    const trunkH = t.height * 0.4;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(t.trunkRadius, t.trunkRadius, trunkH, 8), trunkMat);
    // 坂の上でも浮かないよう、根元を少し埋める
    const base = terrain ? heightAt(t.x, t.z) - 0.5 : highway ? lowY : 0;
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

/** 角 (cornerX, cornerZ) を中心にした 1/4 円弧の板（カーブの橋・高架の床）。上面が top */
function arcSlab(cornerX: number, cornerZ: number, sx: number, sz: number, inner: number, outer: number, top: number, thickness: number): THREE.BufferGeometry {
  // flatArc と同じ角度の範囲を XY 平面で作り、厚さの向き（+Z）を上（+Y）に向ける
  const a0 = Math.atan2(sz, -sx) - Math.PI / 4;
  const a1 = a0 + Math.PI / 2;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, a0, a1, false);
  shape.absarc(0, 0, inner, a1, a0, true);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 16 });
  g.rotateX(-Math.PI / 2);
  g.translate(cornerX, top - thickness, cornerZ);
  return g;
}

/**
 * 水面・川岸と、橋・高架の床と柱。高架のマップはすべての道路が、それ以外は橋のタイルが対象。
 * lowY は下の地面（水面・街）の高さ
 */
function buildWaterAndDecks(map: ParsedMap, lowY: number, isWet: (t: Tile | undefined) => boolean): THREE.Group {
  const group = new THREE.Group();
  const { tileSize, roadWidth } = map.def;
  const half = tileSize / 2;
  const highway = map.def.highway;
  const water: THREE.BufferGeometry[] = [];
  const banks: THREE.BufferGeometry[] = [];
  const decks: THREE.BufferGeometry[] = [];
  const pillars: THREE.BufferGeometry[] = [];
  const deckHalf = roadWidth / 2 + 1;
  const deckTop = -0.03;
  for (const t of map.tiles) {
    const { x, z } = tileCenter(map, t.col, t.row);
    if (isWet(t)) {
      // 高架のマップの水面は、下の地面の少し上
      water.push(flatRect(x, z, tileSize, tileSize, lowY + (highway ? 0.15 : 0.6)));
      if (!highway) {
        // 陸との境目の岸（縦の面）
        for (const { dc, dr } of Object.values(DIR_OFFSET)) {
          if (isWet(map.tileAt(t.col + dc, t.row + dr))) continue;
          const g = new THREE.PlaneGeometry(tileSize, -lowY);
          if (dc !== 0) g.rotateY(Math.PI / 2);
          g.translate(x + dc * half, lowY / 2, z + dr * half);
          banks.push(g);
        }
      }
    }
    if (t.kind !== 'road' || !(highway || t.bridge)) continue;
    const pillarH = deckTop - DECK_THICKNESS - lowY;
    let px = x;
    let pz = z;
    if (roadShape(t) === 'curve') {
      const sx = t.connections.includes('E') ? 1 : -1;
      const sz = t.connections.includes('S') ? 1 : -1;
      decks.push(arcSlab(x + sx * half, z + sz * half, sx, sz, half - deckHalf, half + deckHalf, deckTop, DECK_THICKNESS));
      px = x + sx * half - sx * half * Math.SQRT1_2;
      pz = z + sz * half - sz * half * Math.SQRT1_2;
    } else {
      const alongX = t.connections.includes('E') || t.connections.includes('W');
      const g = new THREE.BoxGeometry(alongX ? tileSize : deckHalf * 2, DECK_THICKNESS, alongX ? deckHalf * 2 : tileSize);
      g.translate(x, deckTop - DECK_THICKNESS / 2, z);
      decks.push(g);
    }
    const p = new THREE.CylinderGeometry(1.1, 1.3, pillarH, 10);
    p.translate(px, lowY + pillarH / 2, pz);
    pillars.push(p);
  }
  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, shadow = true) => {
    if (!geos.length) return;
    // 押し出した板（インデックスなし）と箱（インデックスあり）を混ぜるので、そろえてからまとめる
    const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g))), mat);
    mesh.receiveShadow = true;
    mesh.castShadow = shadow;
    group.add(mesh);
  };
  add(water, new THREE.MeshPhongMaterial({ color: COLORS.water, shininess: 40, specular: 0x30485a }), false);
  add(banks, new THREE.MeshLambertMaterial({ color: COLORS.bank, side: THREE.DoubleSide }), false);
  add(decks, new THREE.MeshLambertMaterial({ color: COLORS.deck }));
  add(pillars, new THREE.MeshLambertMaterial({ color: COLORS.deck }));
  return group;
}

/** 高架の道路の街灯（直線の壁の上に、1枚おきのタイルに左右交互に立てる） */
function buildStreetLamps(map: ParsedMap): THREE.Group {
  const group = new THREE.Group();
  const { roadWidth } = map.def;
  const poles: THREE.BufferGeometry[] = [];
  const lamps: THREE.BufferGeometry[] = [];
  const off = roadWidth / 2 + 0.55;
  const height = 9;
  for (const t of map.tiles) {
    if (t.kind !== 'road' || roadShape(t) !== 'straight' || (t.col + t.row) % 2 !== 0) continue;
    const { x, z } = tileCenter(map, t.col, t.row);
    const alongX = t.connections.includes('E');
    const s = (t.col + t.row) % 4 === 0 ? 1 : -1;
    // 柱の位置と、道路の内側へ向かう向き
    const bx = alongX ? x : x + s * off;
    const bz = alongX ? z + s * off : z;
    const ix = alongX ? 0 : -s;
    const iz = alongX ? -s : 0;
    const pole = new THREE.CylinderGeometry(0.12, 0.16, height, 6);
    pole.translate(bx, BARRIER_HEIGHT + height / 2, bz);
    poles.push(pole);
    const arm = new THREE.BoxGeometry(ix ? 2.2 : 0.14, 0.14, iz ? 2.2 : 0.14);
    arm.translate(bx + ix * 1.1, BARRIER_HEIGHT + height, bz + iz * 1.1);
    poles.push(arm);
    const lamp = new THREE.BoxGeometry(ix ? 0.9 : 0.4, 0.18, iz ? 0.9 : 0.4);
    lamp.translate(bx + ix * 2.2, BARRIER_HEIGHT + height - 0.15, bz + iz * 2.2);
    lamps.push(lamp);
  }
  if (poles.length) group.add(new THREE.Mesh(mergeGeometries(poles), new THREE.MeshLambertMaterial({ color: 0x7d8186 })));
  if (lamps.length) group.add(new THREE.Mesh(mergeGeometries(lamps), new THREE.MeshBasicMaterial({ color: COLORS.lamp })));
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
/**
 * ヘアピンの内側の近道の帯（コンクリートの面）。地形に沿わせ、道路と重なる所は描かない
 */
export function buildShortcutMesh(shortcuts: readonly Shortcut[], terrain: Terrain, onRoad: (x: number, z: number) => boolean): THREE.Mesh {
  const STEP = 1;
  const positions: number[] = [];
  for (const sc of shortcuts) {
    const nu = Math.ceil((2 * sc.uMax) / STEP);
    const nw = Math.ceil((sc.wMax - sc.wMin) / STEP);
    const point = (i: number, j: number) => {
      const p = shortcutPoint(sc, -sc.uMax + (2 * sc.uMax * i) / nu, sc.wMin + ((sc.wMax - sc.wMin) * j) / nw);
      return [p.x, terrain.heightAt(p.x, p.z) + 0.02, p.z];
    };
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nw; j++) {
        const c = shortcutPoint(sc, -sc.uMax + (2 * sc.uMax * (i + 0.5)) / nu, sc.wMin + ((sc.wMax - sc.wMin) * (j + 0.5)) / nw);
        if (onRoad(c.x, c.z)) continue;
        const a = point(i, j);
        const b = point(i + 1, j);
        const d = point(i, j + 1);
        const e = point(i + 1, j + 1);
        positions.push(...a, ...b, ...e, ...a, ...e, ...d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  // 三角形の向きは帯の向きで変わるので、両面を描く
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshLambertMaterial({ color: COLORS.shortcut, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

export function createConeMesh(): THREE.Mesh {
  const { radius, height } = CONE_HALF_SIZE;
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(radius, height * 2, 12),
    new THREE.MeshLambertMaterial({ color: COLORS.cone }),
  );
  mesh.castShadow = true;
  return mesh;
}
