# car-game

ブラウザ向け3Dドライビングゲーム（個人開発）。
現在は第1段階（MVP）：小さな街を自分で運転できる。

- 設計提案: [docs/design-proposal.md](docs/design-proposal.md)

## 遊び方

| キー | 操作 |
|---|---|
| `W` / `↑` | アクセル |
| `S` / `↓` / `Space` | ブレーキ（停止中に押し続けると後退） |
| `A` `D` / `←` `→` | ハンドル |
| `C` | カメラ切替（三人称 近／遠） |
| `R` | スタート地点に戻る |
| `H` | 操作説明の表示切替 |

## 開発

Node.js 22 以降。

```sh
npm install
npm run dev        # 開発サーバー（http://localhost:5173）
npm test           # 単体テスト（Vitest）
npm run build      # 型チェック + 本番ビルド（dist/）
```

### 構成

| ディレクトリ | 役割 |
|---|---|
| `src/core/` | 固定タイムステップのゲームループ、キーボード入力 |
| `src/sim/` | 車両モデル（`vehicle.ts`、描画非依存）、Rapier 物理ワールド、車 |
| `src/map/` | タイルマップ定義（`maps.ts`）と解析、障害物配置 |
| `src/render/` | Three.js のシーン、マップ・車のメッシュ、追従カメラ |
| `src/ui/` | HUD（速度・ギア・操作説明） |

- 車の挙動の調整は `src/sim/vehicle.ts` の `DEFAULT_VEHICLE_PARAMS`。
- マップは `src/map/maps.ts` の文字グリッドを書き換えるだけで変更できる（凡例は `src/map/tilemap.ts`）。

### 公開

`main` ブランチへ push すると GitHub Actions がテスト・ビルドし、GitHub Pages に公開する。
初回のみ、リポジトリの Settings → Pages → Source を **GitHub Actions** に設定する。
