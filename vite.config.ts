/// <reference types="node" />
import { createReadStream, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** 顔の形の読み取り（MediaPipe）の WASM。node_modules から、このサイトの mediapipe/ に置いて配る */
const MEDIAPIPE_WASM = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];
const mediapipeDir = fileURLToPath(new URL('./node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url));

function mediapipeWasm(): Plugin {
  return {
    name: 'mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0].match(/\/mediapipe\/([\w.]+)$/)?.[1];
        if (!name || !MEDIAPIPE_WASM.includes(name)) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(mediapipeDir + name).pipe(res);
      });
    },
    generateBundle() {
      for (const name of MEDIAPIPE_WASM) {
        this.emitFile({ type: 'asset', fileName: `mediapipe/${name}`, source: readFileSync(mediapipeDir + name) });
      }
    },
  };
}

export default defineConfig({
  // GitHub Pages のサブパス配下でも動くよう相対パスで出力する
  base: './',
  plugins: [mediapipeWasm()],
  build: {
    // Rapier の WASM がバンドルに埋め込まれるため大きめになる
    chunkSizeWarningLimit: 6000,
  },
  test: {
    environment: 'node',
  },
});
