# 🎵 MikuMikuAR

> 基於 Wails v3 + Babylon.js / babylon-mmd 的跨平台 MMD 桌面播放器——
> PMX 模型檢視、VMD 動作播放、即時換裝、程式化舞蹈、AR 相機、卡通化渲染，一站式搞定。

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

| 平台 | 狀態 |
|------|------|
| 🪟 Windows | ✅ 已验证 |
| 🤖 Android | ✅ 已验证（c-shared + WebView） |
| 🍎 iOS / 🐧 Linux | 🟡 理論相容（Wails v3 任務已配置，未實測） |

| 🌐 語言 |
|----------|
| [简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [**繁體中文**](README.zh-TW.md) |

---

## ✨ 功能

### 🎭 渲染與模型

- **PMX/PMD 載入** — 完整 babylon-mmd 渲染管線，支援 SDEF / IK 骨骼 / Grant 權重
- **多模型同場** — 多個 PMX 共享場景，6 種陣型排列，焦點切換
- **縮圖預覽** — 模型載入後自動截圖，庫卡片即用即看
- **逐材質調參** — 按部位（皮膚/頭髮/眼睛/服裝/配件/道具）批量調整 + 單材質覆蓋
- **智慧材質分類** — 自動檢測皮膚/頭髮/眼睛/服裝/配件/道具，支援自訂正則規則
- **模型預設** — 材質/表情/變換快照，庫級管理，一鍵套用
- **服裝變體** — `outfits.json` 描述紋理/mesh 變體，自動發現 + 一鍵換裝
- **卡通化渲染** — 一鍵 Cel-shading 後處理模式（exposure/contrast/ACES/bloom/fxaa 預設快照）
- **Pose Studio** — 構圖輔助、景深、T-pose/A-pose 轉換、批次截圖、浮水印

---

### 💃 動作與音訊

- **VMD 動作播放** — 多模型獨立綁定，進度拖曳 / 循環 / 鍵盤控制
- **程式化動作** — `Idle`（呼吸眨眼）、`AutoDance`（節拍驅動律動）、`Lifelike`（微動疊加）
- **VPD 姿勢匯入** — 文字解析 → VMD 影格，一鍵擺拍（支援 UTF-8/Shift-JIS 自動識別）
- **相機 VMD 軌道** — 載入相機 VMD，多模式自由切換
- **程式化運鏡** — 8 種自動相機預設，節拍驅動閉環
- **LipSync** — 振幅 → 口型 morph 權重，多口型驅動（あ/い/う/え + 中/英/日候選名）
- **節拍檢測** — Web Audio 能量峰值法即時 BPM，支援多軌道
- **Motion Layers** — 雙 VMD 圖層混合 + boneFilter 骨骼過濾
- **Motion Override** — 逐骨骼旋轉/位移覆寫，程式化動作與 VMD 共存

---

### ⚙️ 物理

- **WASM Bullet 物理** — MMD 原生剛體 / 關節 / 柔體，與時間軸同步

---

### 🌍 環境

- **水面** — Gerstner 波（4 層）+ 焦散 + 漣漪 + 水下過渡 + 反射 RenderTarget
- **體積雲** — 3D 雜訊 ray-marching + 風場驅動
- **粒子系統** — 櫻/雨/雪/煙火/螢火蟲/落葉/水花 7 種，與風場連動
- **程式化地形** — FBM 雜訊高度圖 + 坡度紋理滾動 + 鏡面反射 + 法線貼圖 + 高程著色
- **燈光與後處理** — Bloom / DOF / SSAO / SSR / 邊緣渲染 / 色調映射 / FXAA，效能自動降級

---

### 📚 庫與工具

- **模型庫管理** — 遞迴掃描、zip 內省、標籤/收藏/搜尋、下載目錄監聽 + 自動匯入
- **zip 容器** — 不解壓直接載入 PMX/VMD，SHA-256 cache 惰性復用
- **Scene Bundle** — 場景打包為 zip（含所有引用資源），跨裝置匯入/匯出
- **Blender 喚起** — 自動檢測 / 手動設定路徑，點 ✏️ 在 Blender 中編輯 PMX（需 [mmd_tools](https://github.com/powroupi/blender_mmd_tools) 外掛）

---

### 👁️ 角色感知

- **視線追蹤** — Eye Contact 眼神接觸，無 VMD 也能讓模型「活起來」
- **頭部追蹤** — 頭部跟隨相機/使用者，增強生命力

---

### 📷 AR 相機

- **視訊透傳 + 模型疊加** — 攝影機畫面作為場景背景，模型渲染在視訊之上
- **前置/後置切換** — 行動端自動選後置，桌面端預設前置
- **Gaze 協同** — AR 模式下自動開啟視線追蹤，增強與真人眼神接觸
- **螢幕截圖合成** — 視訊背景 + 3D 模型一鍵合成
- **Android 權限** — CAMERA 執行時期權限原生橋接

---

### 🌐 國際化

- **5 種語言** — 简体中文 / English / 日本語 / 한국어 / 繁體中文，熱切換

---

## ⌨️ 鍵盤快捷鍵

| 快捷鍵 | 行為 |
|--------|------|
| Ctrl+1~5 | 切換 5 個底部導航彈窗（模型/動作/場景/環境/設定） |
| Ctrl+6 | 切換 AR 相機模式 |
| Space | 播放/暫停 |
| Escape | 關閉所有彈窗 |
| ←/→ | seek ±5s |
| ↑/↓ | 選單項導航（彈窗內） |
| Enter/→ | 啟用選中項（彈窗內） |
| ←（彈窗內） | 返回上層 |
| WASD | 自由飛行相機（需開啟 Freefly 模式） |

---

## 📖 文件

| 文件 | 內容 |
|------|------|
| [專案現狀](docs/status.md) | 當前狀態 + 已完成功能 |
| [架構方案](docs/architecture.md) | 全功能彙總 |
| [設計決策](docs/adr/) | 80+ ADR 技術思路 |
| [需求與選型](docs/requirements.md) | P0-P4 優先級 + 技術選型理由 |
| [競品分析](docs/competitive-analysis.md) | 23 個專案調研 |
| [編碼奇譚](novel/README.md) | 100+ 章節程式碼演化敘事 |
| [AI 工作流規則](AGENTS.md) | AI 協作指南 |

---

## 🚀 快速開始

### 前置依賴

| 依賴 | 版本 | 說明 | 安裝檢查 |
|------|------|------|---------|
| **Go** | 1.25+ | 後端編譯 | `go version` |
| **Node.js** | 24+ | 前端建構 | `node --version` |
| **npm** | 11+ | 套件管理 | `npm --version` |
| **Wails v3 CLI** | 最新 | 熱重載開發必需 | `wails3 version` → `go install github.com/wailsapp/wails/v3/cmd/wails3@latest` |
| **PowerShell 7** | — | Windows 建構腳本（可選） | `pwsh --version` |
| **GitHub CLI** | — | 發版流程（可選） | `gh --version` |

> **E2E 測試：** 安裝 Playwright 瀏覽器
> ```bash
> cd frontend && npx playwright install chromium
> ```
>
> **WASM Bullet 物理引擎（可選）：** 如需本地編譯，安裝 [Rust](https://rustup.rs/)
> ```bash
> rustc --version   # 查看是否已安裝
> ```

**Linux 額外依賴**（建構桌面應用）：
```bash
sudo apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev libglib2.0-dev \
  libsoup-3.0-dev libgdk-pixbuf-2.0-dev libpango1.0-dev libcairo2-dev \
  libatk1.0-dev libgirepository1.0-dev
```

### 開發執行

```bash
# 克隆後初始化前端
cd frontend && npm install

# 啟動熱重載開發（Go 後端 + Vite 前端同時跑）
wails3 dev -config ./build/config.yml -port 9245
```

#### 進階：手動拆分（最大控制力）

若想要前端完全獨立熱更新、且 Go 程序長期常駐，可把前後端拆成兩個終端跑：

```bash
# 終端 1 — 前端（Vite HMR，改 TS 秒級刷新，不碰 Go）
cd frontend && npm run dev          # 等價於 npx vite --port 9245

# 終端 2 — 後端（編譯一次後常駐；僅改 Go 時才需要重跑這兩步）
wails3 build DEV=true
wails3 task run
```

- 改 **TS / HTML / CSS** → 僅終端 1 的 Vite 自動重新整理，應用視窗不重建。
- 改 **Go** → 回到終端 2 重跑 `wails3 build DEV=true && wails3 task run` 重啟後端。
- 手動拆分時 `wails3 dev` 不參與，需自行保證 Vite 連接埠（預設 `9245`）與後端載入的 dev URL 一致。

### 測試

```bash
cd frontend

# 型別檢查（改完必跑）
npm run check

# 單元測試（Vitest）
npm run test
npm run test:watch     # 監聽模式

# E2E 測試（需先啟動 wails3 dev 或 5173+9222 連接埠）
npm run test:e2e
npm run test:e2e:headed   # 有介面除錯

# 驗證 116 個 Go 綁定函式存在性 + FNV-1a method ID
npm run test -- src/__tests__/bindings/app.contract.test.ts
```

### 生產建構

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1 -Production

# Linux
bash scripts/build-linux.sh --production
```

---

## 🤖 AI 協作工具鏈

本專案由 **多個 AI 共同維護**，各司其職：

| 終端 | 模型 | 角色 |
|---------|------|------|
| **Trae** | GLM5.2+doubao2.1 | 首席架構師 · 程式碼生成 · 審查 |
| **Workbuddy** | hy3 | 任務規劃 · 進度追蹤 · 技能輔助 |
| **OpenCode** | NVidia/mistral-small-4 | 前端 UI 開發 · 後端除錯 |
| **Reasonix** | Deepseek-v4-flash | git push |
| **Mimocode** | Mimo-v2.5 | 文件生成 · 推理分析 · 問題定位 |

---

## 📁 專案結構

```
MikuMikuAR/
├── main.go / main_android.gen.go   # Wails 應用入口（桌面 + Android）
├── internal/               # Go 內部套件
│   ├── app/               # 核心業務（檔案IO / HTTP伺服器 / 掃描 / 下載 / Blender / 預設 / 縮圖）
│   ├── dialogs/           # 檔案對話框
│   ├── thumbnail/         # 縮圖生成
│   └── util/              # 工具（pmx 解析 / hash / errors / safecall）
├── build/                  # 各平台建構設定（windows/darwin/linux/ios/android）
├── scripts/                # 建構 / E2E 腳本
├── frontend/src/
│   ├── core/               # 入口 / 共享狀態 / 檔案URL / 圖示 / 響應式 / i18n
│   ├── scene/              # 3D 場景編排
│   │   ├── ar/             # AR 相機模式
│   │   ├── camera/         # 相機模式
│   │   ├── motion/         # VMD 橋接 / 程式化動作 / LipSync / 播放控制
│   │   ├── manager/        # ModelManager / 材質 / 載入 / 操作
│   │   ├── env/            # 環境（天空/水面/雲/粒子/光照/風場）
│   │   ├── pose/           # Pose Studio / 構圖輔助
│   │   └── render/         # 渲染管線 / 燈光 / 效能降級
│   ├── menus/              # SlideMenu 彈窗系統（庫/模型/動作/環境/設定）
│   ├── motion-algos/       # 動作演算法（無 Babylon 依賴，供 scene/motion/ 呼叫）
│   ├── outfit/             # 換裝系統 + 音訊
│   └── __tests__/          # 單元測試 + 綁定契約測試
└── docs/                   # 專案文件（架構 / 狀態 / ADR / 修復流程）
```

---

## ⚠️ 已知限制

- **貼圖相容性** — 部分 PMX 貼圖路徑不標準（`../tex/` vs `textures/`），已用 `basenameFallbackFS` 兜底，但不保證 100% 覆蓋
- **Blender 編輯** — 需使用者自行安裝 [mmd_tools](https://github.com/powroupi/blender_mmd_tools) 外掛，否則 Blender 無法開啟 PMX
- **Android 實驗** — `main_android.gen.go` 用 c-shared 模式 + WebView，檔案存取受 Scoped Storage 約束
- **跨平台路徑** — Blender 自動檢測僅覆蓋 Windows，macOS/Linux 需在設定中手動設定
- **SSS 次表面散射** — 依賴 babylon-mmd 支援 PBR 材質，上游阻塞中
- **Windows 目錄選擇** — Wails v3 `CanChooseDirectories` 缺陷，實際彈出檔案選擇器

---

## 🔍 競品分析

詳見 [docs/competitive-analysis.md](docs/competitive-analysis.md)（23 個專案調研），簡要：

**渲染引擎 / 檢視器**
- [babylon-mmd](https://github.com/noname0310/babylon-mmd) — Babylon.js MMD 渲染引擎（本專案基於此）
- [mmd-viewer-js](https://github.com/pixiставь/mmd-viewer-js) — 零依賴 JS WebGL 檢視器，Toon 著色 + 影片錄製
- [Saba](https://github.com/mmd不开心/Saba) — C++ 輕量檢視器，Lua 腳本/多後端/巨集命令

**桌面播放器**
- [DanceXR](https://github.com/Chewhern/DanceXR) — 動作組合/角色在場/離線渲染/VR（主要對標）
- [Coocoo3D](https://github.com/hkrn/coocoo3d) — C#+DX12，光線追蹤/GI/SSAO/Decal
- [flowerMiku](https://github.com/miku333/flowerMiku) — C++/Vulkan，PBR 材質

**DCC 工具鏈**
- [mmd_tools](https://github.com/powroupi/blender_mmd_tools) — Blender PMX 外掛（本專案 Blender 整合依賴）
- [MMD Bridge](https://github.com/mmd-bridge/MMDBridge) — Alembic 匯出/Python 腳本

**AR / XR**
- [ar-mmd](https://github.com/code4fukui/ar-mmd) — WebXR AR 空間 MMD 模型播放示範
- [MikuMikuMixed](https://github.com/importantimport/mikumikumixed) — Experimental WebXR MMD Viewer（React-Three-Fiber + WebXR）
- [web-mmd](https://github.com/culdo/web-mmd) — 瀏覽器 MMD 播放器，含 AR 模式（手機相機控制）

**框架**
- [Wails](https://wails.io) — Go + WebView 桌面框架（本專案選型）

## 📜 許可

[MIT](LICENSE) — 本專案程式碼自由使用。

> ⚠️ 本工具不主張任何模型 / 動作 / 貼圖檔案的版權。使用者載入的 PMX / VMD / 貼圖檔案可能受其各自創作者的許可限制，與本專案無關。