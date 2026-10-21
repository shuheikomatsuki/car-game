# car-game

ブラウザ向け3Dドライビングゲーム（Vite + TypeScript + Three.js + Rapier）。設計方針は `docs/design-proposal.md`。

## 開発

- `npm test`（Vitest）、`npm run build`（型チェック + ビルド）を通してからコミットする。
- 車両モデル・マップ解析など描画に依存しないロジックには単体テストを書く。
- ブラウザでの確認は `npm run build && npx vite preview` で起動し、`?debug` を付けると `window.__game` から状態を操作できる。

## プルリクエスト

- PR の作成から `main` へのマージまで、確認なしで進めてよい（オーナー了承済み）。
- PR はタイトルのみで、本文は書かない。
- マージ前に CI（`build` ジョブ）が通っていることを確認する。
