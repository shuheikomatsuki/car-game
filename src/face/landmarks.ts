import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { type FacePoints, holeTriangles } from './shape';

/**
 * 顔写真から顔の形（特徴点）を読み取る（Google の MediaPipe を使う）。
 * 読み取り用のプログラム（約 10MB）とモデル（約 4MB）はこのサイトに置いたものを、写真を選んだときだけ読み込む。
 * 写真の処理はすべてブラウザの中で行い、どこにも送信しない。
 * このファイルは import() で必要になったときだけ読み込むこと（最初の読み込みを重くしないため）。
 */

const base = `${import.meta.env.BASE_URL}mediapipe/`;
let landmarker: Promise<FaceLandmarker> | null = null;

function load(): Promise<FaceLandmarker> {
  landmarker ??= (async () => {
    const simd = await FilesetResolver.isSimdSupported();
    const name = simd ? 'vision_wasm_internal' : 'vision_wasm_nosimd_internal';
    return FaceLandmarker.createFromOptions(
      { wasmLoaderPath: `${base}${name}.js`, wasmBinaryPath: `${base}${name}.wasm` },
      { baseOptions: { modelAssetPath: `${base}face_landmarker.task`, delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 1 },
    );
  })();
  // 読み込みに失敗したら、次に呼ばれたときにやり直す
  landmarker.catch(() => (landmarker = null));
  return landmarker;
}

/** 写真を選んだ時点で読み込みを始めておく（決定を押したときに待たせないため） */
export function preload(): void {
  void load().catch(() => undefined);
}

/** 切り抜いた顔は画面いっぱいに写っていて見つけにくいので、周りにこの割合の余白を足してから読み取る */
const PADDING = 0.5;

/** 顔の特徴点を読み取る（座標は渡した画像の上での位置）。顔が見つからなければ null */
export async function detectFacePoints(image: HTMLCanvasElement): Promise<FacePoints | null> {
  const pad = Math.round(image.width * PADDING);
  const canvas = document.createElement('canvas');
  canvas.width = image.width + pad * 2;
  canvas.height = image.height + pad * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, pad, pad);
  const face = (await load()).detect(canvas).faceLandmarks[0];
  if (!face) return null;
  // 余白を足した画像での位置を、元の画像での位置に戻す（z は横幅に比例する尺度なので横の倍率で直す）
  const kx = canvas.width / image.width;
  const ky = canvas.height / image.height;
  return face.flatMap((p) => [p.x * kx - pad / image.width, p.y * ky - pad / image.height, p.z * kx]);
}

/** 顔の立体の三角形（特徴点の番号を3つずつ）。目と口の穴もふさぐ */
export function faceTriangles(): number[] {
  return [...FaceLandmarker.FACE_LANDMARKS_TESSELATION.map((c) => c.start), ...holeTriangles()];
}
