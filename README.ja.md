# 🎵 MikuMikuAR

> Wails v3 + Babylon.js / babylon-mmd 基于的クロスプラットフォーム MMD デスクトッププレーヤー——
> PMX モデル表示、VMD アニメーション再生、即座衣装変更、プログラム生成ダンス、AR カメラ、セリアライズレンダリング、すべて一括で。

[![CI](https://img.shields.io/github/actions/workflow/status/eghrhegpe/MikuMikuAR/ci.yml?logo=github)](https://github.com/eghrhegpe/MikuMikuAR/actions)
[![Release](https://img.shields.io/github/v/release/eghrhegpe/MikuMikuAR?logo=github)](https://github.com/eghrhegpe/MikuMikuAR/releases)
[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go)](https://go.dev/)
[![Wails](https://img.shields.io/badge/Wails-v3-DF0000?logo=wails)](https://wails.io)
[![Babylon.js](https://img.shields.io/badge/Babylon.js-9.14-AD1F23?logo=babylondotjs)](https://babylonjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs)](https://nodejs.org/)
[![Android SDK](https://img.shields.io/badge/Android%20SDK-API%2034-34A853?logo=android)](https://developer.android.com/studio)
[![babylon-mmd](https://img.shields.io/badge/babylon--mmd-1.2.0-FF6F00?logo=babylondotjs)](https://github.com/noname0310/babylon-mmd)
[![Vite](https://img.shields.io/badge/Vite-6.4-646CFF?logo=vite)](https://vitejs.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-729B1A?logo=vitest)](https://vitest.dev/)
[![WebView2](https://img.shields.io/badge/WebView2-Windows-0078D4?logo=microsoft)](https://learn.microsoft.com/edge/webview2/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

| プラットフォーム | ステータス |
|------------------|------------|
| 🪟 Windows | ✅ 検証済み |
| 🤖 Android | ✅ 検証済み（c-shared + WebView） |
| 🍎 iOS / 🐧 Linux | 🟡 理論上互換（Wails v3 タスク設定済み、未テスト） |

| 🌐 言語 |
|----------|
| [简体中文](README.md) · [English](README.en.md) · [**日本語**](README.ja.md) · [한국어](README.ko.md) · [繁體中文](README.zh-TW.md) |

---

## ✨ 機能

### 🎭 レンダリングとモデル

- **PMX/PMD ローディング** — 完全な babylon-mmd レンダリングパイプライン、SDEF / IK ボーン / Grant 重み対応
- **複数モデル同場** — 複数の PMX がシーンを共有、6 種類の陣形配置、フォーカス切替
- **サムネイルプレビュー** — モデル読み込み後自動スクリーンショット、ライブラリカードですぐに確認
- **マテリアル別調整** — 部位別（肌/髪/目/衣装/アクセサリー/小道具）一括調整 + 単一マテリアル上書き
- **スマートマテリアル分類** — 肌/髪/目/衣装/アクセサリー/小道具の自動検出、カスタム正規表現ルール対応
- **モデルプリセット** — マテリアル/表情/変換スナップショット、ライブラリレベル管理、ワンクリック適用
- **衣装バリアント** — `outfits.json` でテクスチャ/mesh バリアントを記述、自動検出 + ワンクリック変更
- **セリアライズレンダリング** — ワンクリック セリアライズ後処理モード（exposure/contrast/ACES/bloom/fxaa プリセットスナップショット）
- **Pose Studio** — 構図補助、被写界深度、T-pose/A-pose 変換、一括スクリーンショット、透かし

---

### 💃 アニメーションとオーディオ

- **VMD アニメーション再生** — モデルごとに独立バインディング、進捗ドラッグ / ループ / キーボード制御
- **プログラム生成アニメーション** — `Idle`（呼吸・瞬き）、`AutoDance`（ビート駆動律動）、`Lifelike`（微動重ね合わせ）
- **VPD ポーズインポート** — テキスト解析 → VMD フレーム、ワンクリック構図（UTF-8/Shift-JIS 自動認識対応）
- **カメラ VMD トラック** — カメラ VMD を読み込み、複数モード自由切替
- **プログラム生成カメラワーク** — 8 種類の自動カメラプリセット、ビート駆動クローズドループ
- **LipSync** — 振幅 → 口型 morph 重み、複数口型駆動（あ/い/う/え + 中/英/日候補名）
- **ビート検出** — Web Audio エネルギーピーク法リアルタイム BPM、マルチトラック対応
- **Motion Layers** — 二重 VMD レイヤー混合 + boneFilter ボーンフィルタリング
- **Motion Override** — ボーン別回転/移動上書き、プログラム生成アニメーションと VMD の共存

---

### ⚙️ 物理

- **WASM Bullet 物理** — MMD ネイティブ剛体 / ジョイント / 軟体、タイムラインと同期

---

### 🌍 環境

- **水面** — Gerstner 波（4 レイヤー）+ 焦げ + 波紋 + 水中遷移 + 反射 RenderTarget
- **ボリュームクラウド** — 3D ノイズ ray-marching + 風場駆動
- **パーティクルシステム** — 桜/雨/雪/花火/蛍/紅葉/水しぶき 7 種類、風場と連動
- **プログラム生成地形** — FBM ノイズ高さマップ + 勾配テクスチャローリング + 鏡面反射 + 法線マップ + 標高着色
- **ライティングと後処理** — Bloom / DOF / SSAO / SSR / エッジレンダリング / トーンマッピング / FXAA、パフォーマンス自動デグレード

---

### 📚 ライブラリとツール

- **モデルライブラリ管理** — 再帰スキャン、zip 内省、タグ/お気に入り/検索、ダウンロードディレクトリ監視 + 自動インポート
- **zip コンテナ** — 展開せずに PMX/VMD を直接読み込み、SHA-256 cache 遅延再利用
- **Scene Bundle** — シーンを zip にパッケージ化（参照リソース含む）、デバイス間インポート/エクスポート
- **Blender 起動** — 自動検出 / 手動設定パス、✏️ をクリックして Blender で PMX を編集（[mmd_tools](https://github.com/powroupi/blender_mmd_tools) プラグインが必要）

---

### 👁️ キャラクター認識

- **視線追跡** — Eye Contact 視線接触、VMD なしでもモデルを「生き生き」と
- **頭部追跡** — 頭部がカメラ/ユーザーを追従、生命力を強化

---

### 📷 AR カメラ

- **ビデオ透過 + モデル重ね合わせ** — カメラ映像をシーン背景として、モデルを映像上にレンダリング
- **フロント/リア切替** — モバイルは自動でリア、デスクトップはデフォルトフロント
- **Gaze 協調** — AR モードで自動視線追跡を有効化、実人との視線接触を強化
- **スクリーンショット合成** — ビデオ背景 + 3D モデル ワンクリック合成
- **Android 権限** — CAMERA ランタイム権限ネイティブブリッジ

---

### 🌐 国際化

- **5 言語** — 简体中文 / English / 日本語 / 한국어 / 繁體中文、ホット切替

---

## ⌨️ キーボードショートカット

| ショートカット | 動作 |
|----------------|------|
| Ctrl+1~5 | 5 つの下部ナビゲーションポップアップ切替（モデル/アニメーション/シーン/環境/設定） |
| Ctrl+6 | AR カメラモード切替 |
| Space | 再生/一時停止 |
| Escape | すべてのポップアップを閉じる |
| ←/→ | seek ±5s |
| ↑/↓ | メニュー項目ナビゲーション（ポップアップ内） |
| Enter/→ | 選択項目をアクティブ（ポップアップ内） |
| ←（ポップアップ内） | 上位に戻る |
| WASD | フリーフライカメラ（Freefly モード有効化が必要） |

---

## 📖 ドキュメント

| ドキュメント | 内容 |
|--------------|------|
| [プロジェクト状況](docs/status.md) | 現在の状況 + 完了機能 |
| [アーキテクチャ](docs/architecture.md) | 全機能サマリー |
| [設計決定](docs/adr/) | 80+ ADR 技術的アプローチ |
| [要件と選定](docs/requirements.md) | P0-P4 優先度 + 技術選定理由 |
| [競合分析](docs/competitive-analysis.md) | 23 プロジェクト調査 |
| [コーディング奇譚](novel/README.md) | 100+ 章 コード進化物語 |
| [AI ワークフロー規則](AGENTS.md) | AI 協業ガイド |

---

## 🚀 クイックスタート

### 前提条件

| 依存 | バージョン | 説明 | 確認方法 |
|------|-----------|------|---------|
| **Go** | 1.25+ | バックエンドコンパイル | `go version` |
| **Node.js** | 24+ | フロントエンドビルド | `node --version` |
| **npm** | 11+ | パッケージ管理 | `npm --version` |
| **Wails v3 CLI** | 最新 | ホットリロード開発必須 | `wails3 version` → `go install github.com/wailsapp/wails/v3/cmd/wails3@latest` |
| **PowerShell 7** | — | Windows ビルドスクリプト（オプション） | `pwsh --version` |
| **GitHub CLI** | — | リリースワークフロー（オプション） | `gh --version` |

> **E2E テスト：** Playwright ブラウザをインストール
> ```bash
> cd frontend && npx playwright install chromium
> ```
>
> **WASM Bullet 物理（オプション）：** ローカルコンパイルには [Rust](https://rustup.rs/) が必要
> ```bash
> rustc --version   # インストール確認
> ```

**Linux 追加依存**（デスクトップアプリビルド）：
```bash
sudo apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev libglib2.0-dev \
  libsoup-3.0-dev libgdk-pixbuf-2.0-dev libpango1.0-dev libcairo2-dev \
  libatk1.0-dev libgirepository1.0-dev
```

### 開発実行

```bash
# クローン後フロントエンドを初期化
cd frontend && npm install

# ホットリロード開発開始（Go バックエンド + Vite フロントエンド同時実行）
wails3 dev -config ./build/config.yml -port 9245
```

#### 上級：手動分割（最大制御力）

フロントエンドを完全に独立してホットリロードし、Go プロセスを長期常駐させる場合、2 つのターミナルに分割可能：

```bash
# ターミナル 1 — フロントエンド（Vite HMR、TS 変更で秒単位リフレッシュ、Go は触らない）
cd frontend && npm run dev          # npx vite --port 9245 と同等

# ターミナル 2 — バックエンド（1 回コンパイル後常駐；Go 変更時のみ再実行）
wails3 build DEV=true
wails3 task run
```

- **TS / HTML / CSS** を変更 → ターミナル 1 の Vite のみ自動リフレッシュ、アプリウィンドウは再構築されない。
- **Go** を変更 → ターミナル 2 に戻り `wails3 build DEV=true && wails3 task run` を再実行してバックエンドを再起動。
- 手動分割時は `wails3 dev` は参加せず、Vite ポート（デフォルト `9245`）とバックエンドの dev URL が一致することを自分で保証する必要がある。

### テスト

```bash
cd frontend

# 型チェック（変更後は必ず実行）
npm run check

# ユニットテスト（Vitest）
npm run test
npm run test:watch     # 監視モード

# E2E テスト（wails3 dev または 5173+9222 ポートを先に起動する必要あり）
npm run test:e2e
npm run test:e2e:headed   # ヘッド付きデバッグ

# 116 個の Go バインディング関数の存在確認 + FNV-1a method ID
npm run test -- src/__tests__/bindings/app.contract.test.ts
```

### 本番ビルド

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1 -Production

# Linux
bash scripts/build-linux.sh --production
```

---

## 🤖 AI 協業ツールチェーン

本プロジェクトは **複数の AI が共同で維持**しており、各ツールが役割分担しています：

| ターミナル | モデル | 役割 |
|------------|--------|------|
| **Trae** | GLM5.2+doubao2.1 | 首席アーキテクト · コード生成 · レビュー |
| **Workbuddy** | hy3 | タスク計画 · 進捗追跡 · スキル補助 |
| **OpenCode** | NVidia/mistral-small-4 | フロントエンド UI 開発 · バックエンドデバッグ |
| **Reasonix** | Deepseek-v4-flash | git push |
| **Mimocode** | Mimo-v2.5 | ドキュメント生成 · 推論分析 · 問題特定 |

---

## 📁 プロジェクト構造

```
MikuMikuAR/
├── main.go / main_android.gen.go   # Wails アプリエントリ（デスクトップ + Android）
├── internal/               # Go 内部パッケージ
│   ├── app/               # コアビジネス（ファイル IO / HTTP サーバー / スキャン / ダウンロード / Blender / プリセット / サムネイル）
│   ├── dialogs/           # ファイルダイアログ
│   ├── thumbnail/         # サムネイル生成
│   └── util/              # ユーティリティ（pmx 解析 / hash / errors / safecall）
├── build/                  # プラットフォームビルド設定（windows/darwin/linux/ios/android）
├── scripts/                # ビルド / E2E スクリプト
├── frontend/src/
│   ├── core/               # エントリ / 共有状態 / ファイル URL / アイコン / レスポンシブ / i18n
│   ├── scene/              # 3D シーンオーケストレーション
│   │   ├── ar/             # AR カメラモード
│   │   ├── camera/         # カメラモード
│   │   ├── motion/         # VMD ブリッジ / プログラム生成アニメーション / LipSync / 再生制御
│   │   ├── manager/        # ModelManager / マテリアル / ローディング / 操作
│   │   ├── env/            # 環境（空/水/雲/パーティクル/照明/風場）
│   │   ├── pose/           # Pose Studio / 構図補助
│   │   └── render/         # レンダリングパイプライン / 照明 / パフォーマンスデグレード
│   ├── menus/              # SlideMenu ポップアップシステム（ライブラリ/モデル/アニメーション/環境/設定）
│   ├── motion-algos/       # アニメーションアルゴリズム（Babylon 依存なし、scene/motion/ から呼び出し）
│   ├── outfit/             # 衣装システム + オーディオ
│   └── __tests__/          # ユニットテスト + バインディング契約テスト
└── docs/                   # プロジェクトドキュメント（アーキテクチャ / 状況 / ADR / 修復フロー）
```

---

## ⚠️ 既知の制限

- **テクスチャ互換性** — 一部の PMX テクスチャパスが非標準（`../tex/` vs `textures/`）、`basenameFallbackFS` でフォールバックするが 100% カバーは保証しない
- **Blender 編集** — ユーザーが [mmd_tools](https://github.com/powroupi/blender_mmd_tools) プラグインをインストールする必要がある、そうでないと Blender で PMX が開けない
- **Android 実験的** — `main_android.gen.go` は c-shared モード + WebView を使用、Scoped Storage の制約を受ける
- **クロスプラットフォームパス** — Blender 自動検出は Windows のみ対応、macOS/Linux は設定で手動設定が必要
- **SSS サブサーフェス散乱** — babylon-mmd の PBR マテリアルサポートに依存、上流ブロック中
- **Windows ディレクトリ選択** — Wails v3 `CanChooseDirectories` の不具合、実際はファイル選択画面が表示される

---

## 🔍 競合分析

詳細は [docs/competitive-analysis.md](docs/competitive-analysis.md)（23 プロジェクト調査）を参照。概要：

**レンダリングエンジン / ビューアー**
- [babylon-mmd](https://github.com/noname0310/babylon-mmd) — Babylon.js MMD レンダリングエンジン（本プロジェクトはこれに基づく）
- [mmd-viewer-js](https://github.com/pixiставь/mmd-viewer-js) — ゼロ依存 JS WebGL ビューアー、Toon シェーディング + ビデオ録画
- [Saba](https://github.com/mmd不开心/Saba) — C++ 軽量ビューアー、Lua スクリプティング / マルチバックエンド / マクロコマンド

**デスクトッププレーヤー**
- [DanceXR](https://github.com/Chewhern/DanceXR) — アニメーション合成 / キャラクター同在 / オフラインレンダリング / VR（主要対抗）
- [Coocoo3D](https://github.com/hkrn/coocoo3d) — C#+DX12、レイトレーシング / GI / SSAO / Decal
- [flowerMiku](https://github.com/miku333/flowerMiku) — C++/Vulkan、PBR マテリアル

**DCC ツールチェーン**
- [mmd_tools](https://github.com/powroupi/blender_mmd_tools) — Blender PMX プラグイン（本プロジェクトの Blender 連携に必要）
- [MMD Bridge](https://github.com/mmd-bridge/MMDBridge) — Alembic エクスポート / Python スクリプト

**AR / XR**
- [ar-mmd](https://github.com/code4fukui/ar-mmd) — WebXR AR 空間 MMD モデル再生デモ
- [MikuMikuMixed](https://github.com/importantimport/mikumikumixed) — Experimental WebXR MMD Viewer（React-Three-Fiber + WebXR）
- [web-mmd](https://github.com/culdo/web-mmd) — ブラウザ MMD プレーヤー、AR モード対応（スマホカメラ制御）

**フレームワーク**
- [Wails](https://wails.io) — Go + WebView デスクトップフレームワーク（本プロジェクトの選定）

## 📜 ライセンス

[MIT](LICENSE) — 本プロジェクトのコードは自由に使用できます。

> ⚠️ 本ツールはモデル / アニメーション / テクスチャファイルの著作権を主張しません。ユーザーが読み込む PMX / VMD / テクスチャファイルはそれぞれのクリエイターのライセンス制限を受ける場合があり、本プロジェクトとは無関係です。