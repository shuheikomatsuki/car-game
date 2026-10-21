import * as THREE from 'three';
import type { SignObstacle } from '../map/obstacles';
import type { SignType } from '../map/tilemap';
import { SIGN_POLE } from '../sim/physics';

const PLATE_SIZE = 0.9;
const TEXTURE_SIZE = 256;

type Painter = (g: CanvasRenderingContext2D, s: number) => void;

/** 標識の形（表面の絵と、裏面の灰色のシルエットで共通） */
const SHAPES: Record<SignType, (g: CanvasRenderingContext2D, s: number) => void> = {
  // 止まれ: 逆三角形
  stop: (g, s) => {
    g.beginPath();
    g.moveTo(s * 0.04, s * 0.1);
    g.lineTo(s * 0.96, s * 0.1);
    g.lineTo(s * 0.5, s * 0.92);
    g.closePath();
  },
  speed30: (g, s) => {
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.47, 0, Math.PI * 2);
  },
  speed40: (g, s) => {
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.47, 0, Math.PI * 2);
  },
};

function speedLimit(n: number): Painter {
  return (g, s) => {
    SHAPES.speed30(g, s);
    g.fillStyle = '#d42a2a';
    g.fill();
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.37, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    g.fillStyle = '#1f4fb5';
    g.font = `bold ${s * 0.42}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), s / 2, s * 0.53);
  };
}

const FACES: Record<SignType, Painter> = {
  stop: (g, s) => {
    SHAPES.stop(g, s);
    g.fillStyle = '#d42a2a';
    g.fill();
    g.lineWidth = s * 0.03;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = `bold ${s * 0.17}px 'Hiragino Sans', 'Noto Sans JP', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('止まれ', s / 2, s * 0.36);
  },
  speed30: speedLimit(30),
  speed40: speedLimit(40),
};

function canvasTexture(paint: Painter): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXTURE_SIZE;
  paint(canvas.getContext('2d')!, TEXTURE_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** 標識のメッシュを作る。テクスチャは種類ごとに使い回す */
export class SignFactory {
  private readonly faces = new Map<SignType, THREE.Material>();
  private readonly backs = new Map<SignType, THREE.Material>();
  private readonly poleMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a6 });
  private readonly poleGeo = new THREE.CylinderGeometry(SIGN_POLE.radius, SIGN_POLE.radius, SIGN_POLE.height, 8);
  private readonly plateGeo = new THREE.PlaneGeometry(PLATE_SIZE, PLATE_SIZE);

  create(sign: SignObstacle): THREE.Group {
    const group = new THREE.Group();
    group.position.set(sign.x, 0, sign.z);
    group.rotation.y = sign.yaw;

    const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
    pole.position.y = SIGN_POLE.height / 2;
    pole.castShadow = true;
    group.add(pole);

    const front = new THREE.Mesh(this.plateGeo, this.face(sign.type));
    front.position.set(0, SIGN_POLE.height - PLATE_SIZE / 2 + 0.1, SIGN_POLE.radius + 0.01);
    front.castShadow = true;
    group.add(front);

    const back = new THREE.Mesh(this.plateGeo, this.back(sign.type));
    back.position.set(0, front.position.y, SIGN_POLE.radius);
    back.rotation.y = Math.PI;
    group.add(back);
    return group;
  }

  private face(type: SignType): THREE.Material {
    let m = this.faces.get(type);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ map: canvasTexture(FACES[type]), alphaTest: 0.5 });
      this.faces.set(type, m);
    }
    return m;
  }

  private back(type: SignType): THREE.Material {
    let m = this.backs.get(type);
    if (!m) {
      const silhouette = canvasTexture((g, s) => {
        SHAPES[type](g, s);
        g.fillStyle = '#ffffff';
        g.fill();
      });
      m = new THREE.MeshLambertMaterial({ color: 0x8a9096, map: silhouette, alphaTest: 0.5 });
      this.backs.set(type, m);
    }
    return m;
  }
}
