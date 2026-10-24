import { defineConfig } from 'vitest/config';
export default defineConfig({
  // GitHub Pages のサブパス配下でも動くよう相対パスで出力する
  base: './',
  build: {
    // Rapier の WASM がバンドルに埋め込まれるため大きめになる
    chunkSizeWarningLimit: 6000,
  },
  test: {
    environment: 'node',
    // 重い NPC のシミュレーション（*.sim.test.ts）を CPU の数だけ並列に走らせる（既定は1つ少ない）
    maxWorkers: '100%',
  },
});
