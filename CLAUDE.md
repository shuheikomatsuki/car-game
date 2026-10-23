# prefix-d

ブラウザ向け3Dドライビングゲーム（Vite + TypeScript + Three.js + Rapier）。設計方針は `docs/design-proposal.md`。

## 開発

- オーナーへの回答は日本語で書く。

- `npm test`（Vitest）、`npm run build`（型チェック + ビルド）を通してからコミットする。
- 車両モデル・マップ解析など描画に依存しないロジックには単体テストを書く。
- マルチプレイのサーバーは `server/`（Cloudflare Workers + Durable Objects）。`npm run server:dev` で手元に起動し、ゲームは `?server=http://127.0.0.1:8787` を付けて開く。
- ブラウザでの確認は `npm run build && npx vite preview` で起動し、`?debug` を付けると `window.__game` から状態を操作できる。

## プルリクエスト

- PR の作成から `main` へのマージまで、確認なしで進めてよい（オーナー了承済み）。
- PR はタイトルのみで、本文は書かない。
- マージ前に CI（`build` ジョブ）が通っていることを確認する。
