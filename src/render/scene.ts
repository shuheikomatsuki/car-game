import * as THREE from 'three';

const SKY = 0xa9d4f5;
/** 影を描く範囲（車の周りだけ影を計算して軽くする） */
const SHADOW_EXTENT = 50;
const SUN_OFFSET = new THREE.Vector3(-30, 60, -20);

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private readonly sun: THREE.DirectionalLight;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 150, 450);

    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x5b7a4a, 1.6));

    this.sun = new THREE.DirectionalLight(0xfff3dc, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_EXTENT;
    cam.right = SHADOW_EXTENT;
    cam.top = SHADOW_EXTENT;
    cam.bottom = -SHADOW_EXTENT;
    cam.near = 1;
    cam.far = 200;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
  }

  /** 太陽光（影の範囲）を注目点に追従させる */
  followTarget(x: number, z: number): void {
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + SUN_OFFSET.x, SUN_OFFSET.y, z + SUN_OFFSET.z);
  }

  resize(camera: THREE.PerspectiveCamera): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }
}
