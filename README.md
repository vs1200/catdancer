# catdancer

猫が見て楽しむための全画面 Web アプリです。画面内をオブジェクト（ネズミ・猫じゃらし・おもちゃ・虫など）が動き回り、動きに連動した効果音（SE）で猫の狩猟本能を刺激します。PixiJS v8 + Vite + TypeScript で実装しています。

## 概要

ブラウザを全画面表示にして猫の前に置く用途を想定した、単一ページのアプリです。2 つのモードを備えます。

- **マウス操作モード（`manual`）**: 1 体のネズミがマウスカーソル（タッチ位置）へ俊敏に追従します。
- **猫用動画モード（`auto`）**: オブジェクトが一定間隔で自動的に画面外から現れ、画面内を動き回り、やがて画面外へ退場します。

設定はオプション画面から変更でき、`localStorage` と `IndexedDB` に永続化されるためリロードで復元されます。

## 機能

### モード

- **マウス操作モード**: ネズミがカーソルへ追従します。追従は臨界減衰スムージング（SmoothDamp）で、オーバーシュートせず素早く寄ります。進行方向へ 360 度回頭し（左半分は鏡像反転で上下を自然に保つ）、本物のテクスチャ（`mouse-tail.webp`）を使ったワールド空間の物理トレイル尻尾（Verlet 質点鎖）が後方に流れます。カーソルが画面外へ出るとネズミも画面外へ走り去り、戻ると再び画面内へ現れます。
- **猫用動画モード**: 登録済みの種別を重み付き乱択で選び、画面外（world 端）から出現させます。種別ごとの動きで画面内を動き、world 外へ抜けると自動的に消滅（despawn）します。同時出現数は上限（既定 12 体）で頭打ちします。

### オブジェクト種別

| 種別 | 表示名 | 猫用動画モードでの動き | 向きの表現 | SE |
|------|--------|------------------------|------------|----|
| `mouse` | ネズミ | 横断（Cross、上下ドリフト＋揺らぎ） | 360 度回転（rotate） | 鳴き声（チュー、断続）＋走行音（速度連動ループ） |
| `foxtail` | 猫じゃらし | 縁から出入りしつつ支点まわりに大きく揺れる（Dangle） | 水平反転なし（回転 sway が主） | なし |
| `toys` | おもちゃ | 縁から出入りしつつ揺れる（Dangle） | 水平反転なし（回転 sway が主） | なし |
| `insect` | 虫 | 不規則ダッシュ（Erratic、進入→高速ダッシュ／短い停止→急旋回→退場） | 360 度回転（rotate） | 羽音（速度連動ループ、鳴き声なし） |
| カスタム | ユーザー任意画像 | 横断（Cross） | 水平反転のみ（上下反転はしない） | なし |

- 向きの表現は 2 方式です。`rotate`（速度方向へ全方位回頭）と `flip`（進行方向で水平反転）。
- SE はオブジェクト種別ごとにルーティングされ、その種別が画面上に居るときだけ鳴ります（虫だけの時にネズミの鳴き声が混ざる、といったことは起きません）。走行音・羽音は移動速度に連動して音量が上下します。

### 捕獲フィードバック

猫用動画モードで画面（キャンバス）をタップ／クリックすると、当たった中で最も近いオブジェクトが素早く逃走（一定速度で直進して画面外へ→消滅）し、反応 SE を鳴らします。鳴き声を持つ種別はその声を、持たない種別は汎用のキャッチ SE を再生します。マウス操作モードやオプション画面を開いている間は無効です。

### 背景・オプション・永続化

- **背景**: 単色（カラーピッカー）またはユーザー画像を選べます。画像はアスペクト比を保って画面全体を覆う cover-fit で表示されます。
- **オプション画面**: 右下の歯車ボタンから開き、モード／出現間隔（猫用動画モードのみ有効）／背景（色・画像）／オブジェクト画像（カスタム画像クリッターの設定・削除）／出現する種類の ON/OFF／音量を設定できます。
- **永続化**: 設定値（モード・出現間隔・背景の種類/色/画像 ID・音量・カスタム画像 ID・無効化種別）は `localStorage` に、画像バイナリは `IndexedDB`（背景用・クリッター用の 2 ストア）に保存します。
- **画像取り込みの堅牢化**: 受理する画像形式は `png` / `jpeg` / `webp` に限定します。デコード後の画素寸法が上限（最大辺 2048px）を超える画像は自動的に等比縮小してから使用します（VRAM の肥大を防止）。

### 効果音

効果音はすべて Web Audio API で合成しています（音声ファイルは持ちません）。ブラウザの自動再生制限に対応し、最初のユーザー操作（`pointerdown` / `keydown` / `touchstart`）で `AudioContext` を resume します。マスタ音量を持ち、context 生成に失敗した環境では全 API が安全な no-op になります。

## 必要環境 / セットアップ

- **Node.js**（動作確認: v26 系）
- **pnpm**（動作確認: v10 系。リポジトリに `pnpm-lock.yaml` を同梱）

依存関係をインストールします。

```bash
pnpm install
```

## 開発 / ビルド / 品質

| コマンド | 内容 |
|----------|------|
| `pnpm dev` | Vite 開発サーバを起動します（HMR。既定ポート 5173）。 |
| `pnpm build` | 型チェック（`tsc --noEmit`）後に本番ビルド（`vite build`）を行います。 |
| `pnpm preview` | ビルド成果物（`dist/`）をローカルでプレビュー配信します。 |
| `pnpm test` | Vitest で単体テストを実行します。 |
| `pnpm lint` | Biome で静的解析（lint / format チェック）を実行します。 |
| `pnpm format` | Biome でコードを整形して書き込みます。 |

Vite は `base: "./"`（相対パス基準）で設定しているため、サブパス配信の静的ホスティングでも動作します。

## アーキテクチャ

コードは **純ロジック層** と **PixiJS 描画層** に分離しています。

- **純ロジック層**（PixiJS / DOM 非依存）: ベクトル演算、world 境界、動きの戦略、SE のパラメータ写像、設定の正規化など。副作用を持たない純関数・純データとして書かれており、Vitest で単体テストしています。
- **PixiJS 描画層**: `Application` / `Container` / `Sprite` / `MeshRope` などの描画と、純ロジック層の状態（`CritterState`）を表示へ同期する処理。

主要な設計は次の通りです。

- **Critter = view + state**: 純データの `CritterState`（位置・速度・向き・回転・heading）と、それを描画へ同期する `Critter`（PixiJS）を分けています。
- **Movement（Strategy パターン）**: 動きは差し替え可能な戦略として実装します（`MouseFollowMovement` / `CrossMovement` / `DangleMovement` / `ErraticMovement` / `FleeMovement`）。同じ種別をモードごとに別の動きで使い回せます。
- **CritterType（レジストリ）**: オブジェクト種別は「型定義 1 つ＋アセット」で追加できます。テクスチャ・サイズ・向きの表現方式・SE・尻尾/揺れ設定・出現計画をまとめて持ちます。
- **Mode（出現方針）**: `ManualMode` / `AutoMode` が critter・入力配線・SE の確保/解放（start/stop）と毎フレーム更新を担います。
- **world 座標と画面外バッファ**: critter は中心座標で管理し、画面（viewport）に各辺 margin を足した world 領域内を動けるため、画面外へ完全に隠れられます。margin は登録種別の到達距離（本体＋尻尾/揺れ）から動的に算出します。
- **SE と永続化**: Web Audio によるワンショット/ループ SE のバンク登録と種別別ルーティング、`localStorage` + `IndexedDB` による設定・画像の永続化。

### ディレクトリ構成（主要のみ）

```
catdancer/
├─ index.html                 # 全画面 #app へマウント（module script で src/main.ts）
├─ src/
│  ├─ main.ts                 # 起動フロー（bootstrap: App→種別登録→Scene→モード配線）
│  ├─ app/                    # PixiJS 描画層（CatDancerApp / Scene / PointerInput / Background*）
│  ├─ core/                   # 純ロジック基盤（vec2 / worldBounds）
│  ├─ critters/               # Critter / CritterState / CritterType / registry / types/* / tail/*
│  ├─ movement/               # 動きの戦略（MouseFollow / Cross / Dangle / Erratic / Flee）
│  ├─ modes/                  # 表示モード（ManualMode / AutoMode / spawnScheduler / weightedChoice）
│  ├─ audio/                  # Web Audio SE（AudioManager / synth / sounds / 種別別ルーティング）
│  ├─ settings/               # 設定モデル・永続化（settingsData / SettingsStore / imageStore）
│  └─ ui/                     # オプション画面（OptionsButton / OptionsPanel / optionsStyles）
├─ public/assets/critters/    # webp アセット（mouse-body / mouse-tail / foxtail / toys / insect）
├─ tests/                     # Vitest（純ロジックの単体テスト）
├─ vite.config.ts             # Vite / Vitest 設定
├─ tsconfig.json              # TypeScript 設定（strict / noEmit）
└─ biome.json                 # Biome（lint / format）設定
```

## 技術スタック

`package.json` に基づく実バージョンです。

- [PixiJS](https://pixijs.com/) v8（`pixi.js` `^8.19.0`）
- [Vite](https://vite.dev/) （`^8.1.5`）
- [TypeScript](https://www.typescriptlang.org/) （`^7.0.2`）
- [Biome](https://biomejs.dev/) （`@biomejs/biome` `^2.5.4`、lint / format）
- [Vitest](https://vitest.dev/) （`^4.1.10`、テスト環境は `node`）

## 実動作確認（QA）

本リポジトリでは、実際の描画と音の動作確認に agent-browser CLI をヘッドレスで用いる方針です。描画（スクリーンショット）に加え、音は master 出力の RMS / peak を取得して客観的に確認します。

そのための **DEV フック**（`__catScene` / `__catAudio` / `__catSettings` / `__catBg`）を、開発サーバでのみ `window` に露出しています（`import.meta.env.DEV` ガード内で定義しているため、本番ビルドでは tree-shake され残りません）。critter 数・モード・強制 spawn・座標取得・音量/RMS・ポインタ/タップの注入などを、これらのフック経由で観測・操作できます。
