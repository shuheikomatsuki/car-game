# car-game

ブラウザ向け3Dドライビングゲーム（個人開発）。
現在は第2段階：2つのマップを運転席視点・三人称視点で運転でき、効果音とゲームパッドに対応。

- 設計提案: [docs/design-proposal.md](docs/design-proposal.md)

## 遊び方

| キー | ゲームパッド | 操作 |
|---|---|---|
| `W` / `↑` | RT（または A） | アクセル |
| `S` / `↓` / `Space` | LT | ブレーキ（停止中に押し続けると後退） |
| `A` `D` / `←` `→` | 左スティック | ハンドル |
| `C` | Y | カメラ切替（三人称 近／遠・運転席） |
| `N` | BACK | マップ切替（小さな街／教習所コース） |
| `R` | START | スタート地点に戻る |
| `M` | | サウンド ON/OFF |
| `H` | | 操作説明の表示切替 |

URL に `?map=1` を付けると教習所コースから始まる。`?debug` を付けると開発者ツールから `window.__game` で状態を触れる。

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
| `src/core/` | 固定タイムステップのゲームループ、キーボード・ゲームパッド入力 |
| `src/game/` | マップ1つ分（物理ワールド・車・描画物）の生成と破棄 |
| `src/audio/` | Web Audio API で合成する効果音（エンジン・スキール・衝突） |
| `src/sim/` | 車両モデル（`vehicle.ts`、描画非依存）、Rapier 物理ワールド、車 |
| `src/map/` | タイルマップ定義（`maps.ts`）と解析、障害物配置 |
| `src/render/` | Three.js のシーン、マップ・車・標識のメッシュ、カメラ |
| `src/ui/` | HUD（速度・ギア・操作説明・通知） |

- 車の挙動の調整は `src/sim/vehicle.ts` の `DEFAULT_VEHICLE_PARAMS`。
- マップは `src/map/maps.ts` の文字グリッドを書き換えるだけで変更・追加できる（凡例は `src/map/tilemap.ts`）。標識やカーブのガードレールもここで指定する。

### 公開

`main` ブランチへ push すると GitHub Actions がテスト・ビルドし、GitHub Pages に公開する。
初回のみ、リポジトリの Settings → Pages → Source を **GitHub Actions** に設定する。
