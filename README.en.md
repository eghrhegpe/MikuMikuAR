# 🎵 MikuMikuAR

> A cross-platform MMD desktop player built on Wails v3 + Babylon.js / babylon-mmd —
> PMX model viewing, VMD animation playback, instant outfit changes, procedural dance, AR camera, cel-shading, all in one place.

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

| Platform | Status |
|----------|--------|
| 🪟 Windows | ✅ Verified |
| 🤖 Android | ✅ Verified (c-shared + WebView) |
| 🍎 iOS / 🐧 Linux | 🟡 Theoretically compatible (Wails v3 tasks configured, not tested) |

---

## ✨ Features

### 🎭 Rendering & Models

- **PMX/PMD Loading** — Full babylon-mmd rendering pipeline, supports SDEF / IK bones / Grant weights
- **Multi-model Scene** — Multiple PMX models share a scene, 6 formation layouts, focus switching
- **Thumbnail Preview** — Auto-screenshot after model load, library cards ready to view
- **Per-material Tuning** — Batch adjust by body part (skin/hair/eyes/clothes/accessories/props) + single-material override
- **Smart Material Classification** — Auto-detect skin/hair/eyes/clothes/accessories/props, supports custom regex rules
- **Model Presets** — Material/expression/transform snapshots, library-level management, one-click apply
- **Outfit Variants** — `outfits.json` describes texture/mesh variants, auto-discovery + one-click change
- **Cel-shading** — One-click cel-shading post-processing mode (exposure/contrast/ACES/bloom/fxaa preset snapshots)
- **Pose Studio** — Composition assist, depth of field, T-pose/A-pose conversion, batch screenshot, watermark

---

### 💃 Animation & Audio

- **VMD Animation Playback** — Independent binding per model, progress scrubbing / loop / keyboard control
- **Procedural Animation** — `Idle` (breathing/blinking), `AutoDance` (beat-driven motion), `Lifelike` (micro-movement overlay)
- **VPD Pose Import** — Text parsing → VMD frames, one-click posing (UTF-8/Shift-JIS auto-detection)
- **Camera VMD Track** — Load camera VMD, multi-mode free switching
- **Procedural Camera** — 8 auto-camera presets, beat-driven closed loop
- **LipSync** — Amplitude → mouth morph weights, multi-mouth driving (あ/い/う/え + CN/EN/JP candidate names)
- **Beat Detection** — Web Audio energy peak method real-time BPM, multi-track support
- **Motion Layers** — Dual VMD layer blending + boneFilter bone filtering
- **Motion Override** — Per-bone rotation/translation override, procedural animation coexists with VMD

---

### ⚙️ Physics

- **WASM Bullet Physics** — MMD native rigid bodies / joints / soft bodies, synced with timeline

---

### 🌍 Environment

- **Water Surface** — Gerstner waves (4 layers) + caustics + ripples + underwater transition + reflection RenderTarget
- **Volumetric Clouds** — 3D noise ray-marching + wind field driven
- **Particle Systems** — 7 types (cherry blossoms/rain/snow/fireworks/fireflies/falling leaves/splash), linked with wind field
- **Procedural Terrain** — FBM noise heightmap + slope texture rolling + specular reflection + normal map + elevation coloring
- **Lighting & Post-processing** — Bloom / DOF / SSAO / SSR / rim lighting / tone mapping / FXAA, auto performance degradation

---

### 📚 Library & Tools

- **Model Library Management** — Recursive scanning, zip introspection, tags/favorites/search, download directory watch + auto-import
- **Zip Container** — Load PMX/VMD without extraction, SHA-256 cache lazy reuse
- **Scene Bundle** — Package scene as zip (with all referenced resources), cross-device import/export
- **Blender Launch** — Auto-detect / manual config path, click ✏️ to edit PMX in Blender (requires [mmd_tools](https://github.com/powroupi/blender_mmd_tools) plugin)

---

### 👁️ Character Awareness

- **Eye Tracking** — Eye Contact gaze, models "come alive" even without VMD
- **Head Tracking** — Head follows camera/user, enhances liveliness

---

### 📷 AR Camera

- **Video Passthrough + Model Overlay** — Camera feed as scene background, model rendered on top
- **Front/Back Switch** — Mobile auto-selects rear, desktop defaults to front
- **Gaze Synergy** — Auto-enable eye tracking in AR mode, enhance real-person eye contact
- **Screenshot Composite** — Video background + 3D model one-click composite
- **Android Permissions** — CAMERA runtime permission native bridge

---

### 🌐 Internationalization

- **5 Languages** — 简体中文 / English / 日本語 / 한국어 / 繁體中文, hot-switch

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+1~5 | Switch 5 bottom navigation popups (Model/Animation/Scene/Environment/Settings) |
| Ctrl+6 | Toggle AR camera mode |
| Space | Play/Pause |
| Escape | Close all popups |
| ←/→ | Seek ±5s |
| ↑/↓ | Menu item navigation (inside popup) |
| Enter/→ | Activate selected item (inside popup) |
| ← (inside popup) | Go back to parent |
| WASD | Freefly camera (requires Freefly mode enabled) |

---

## 📖 Documentation

| Document | Content |
|----------|---------|
| [Project Status](docs/status.md) | Current status + completed features |
| [Architecture](docs/architecture.md) | Full feature summary |
| [Design Decisions](docs/adr/) | 80+ ADR technical approaches |
| [Requirements & Selection](docs/requirements.md) | P0-P4 priorities + tech selection rationale |
| [Competitive Analysis](docs/competitive-analysis.md) | 23 project research |
| [Coding Chronicles](novel/README.md) | 100+ chapter code evolution narrative |
| [AI Workflow Rules](AGENTS.md) | AI collaboration guide |

---

## 🚀 Quick Start

### Prerequisites

| Dependency | Version | Notes |
|------------|---------|-------|
| **Go** | 1.25+ | Go backend + Wails compilation |
| **Node.js** | 24+ | Frontend build |
| **npm** | 10+ | Frontend package management |
| **Git** | Any | Code clone |
| **Wails v3 CLI** | Latest | Hot-reload dev required: `go install github.com/wailsapp/wails/v3/cmd/wails3@latest` |
| **Playwright** | — | E2E testing: `cd frontend && npx playwright install --with-deps` |

**Additional Linux dependencies** (building desktop app):
```bash
sudo apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev libglib2.0-dev \
  libsoup-3.0-dev libgdk-pixbuf-2.0-dev libpango1.0-dev libcairo2-dev \
  libatk1.0-dev libgirepository1.0-dev
```

### Development Run

```bash
# Initialize frontend after clone
cd frontend && npm install

# Start hot-reload development (Go backend + Vite frontend simultaneously)
wails3 dev -config ./build/config.yml -port 9245
```

#### Advanced: Manual Split (Maximum Control)

For fully independent frontend hot-reload with a persistent Go process, split into two terminals:

```bash
# Terminal 1 — Frontend (Vite HMR, TS changes refresh in seconds, no Go touch)
cd frontend && npm run dev          # equivalent to npx vite --port 9245

# Terminal 2 — Backend (compile once, then persistent; only re-run when Go changes)
wails3 build DEV=true
wails3 task run
```

- Change **TS / HTML / CSS** → Only Terminal 1's Vite auto-refreshes, app window not rebuilt.
- Change **Go** → Return to Terminal 2, re-run `wails3 build DEV=true && wails3 task run` to restart backend.
- When manually split, `wails3 dev` is not involved; ensure Vite port (default `9245`) matches backend's dev URL.

### Testing

```bash
cd frontend

# Type check (run after every change)
npm run check

# Unit tests (Vitest)
npm run test
npm run test:watch     # Watch mode

# E2E tests (requires wails3 dev or 5173+9222 ports first)
npm run test:e2e
npm run test:e2e:headed   # Headed debug

# Verify 116 Go binding functions exist + FNV-1a method ID
npm run test -- src/__tests__/bindings/app.contract.test.ts
```

### Production Build

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1 -Production

# Linux
bash scripts/build-linux.sh --production
```

---

## 🤖 AI Collaboration Toolchain

This project is **maintained by multiple AIs**, each with distinct roles:

| Terminal | Model | Role |
|----------|-------|------|
| **Trae** | GLM5.2+doubao2.1 | Lead Architect · Code Generation · Review |
| **Workbuddy** | hy3 | Task Planning · Progress Tracking · Skill Assistance |
| **OpenCode** | NVidia/mistral-small-4 | Frontend UI Development · Backend Debugging |
| **Reasonix** | Deepseek-v4-flash | git push |
| **Mimocode** | Mimo-v2.5 | Documentation · Reasoning Analysis · Issue Localization |

---

## 📁 Project Structure

```
MikuMikuAR/
├── main.go / main_android.gen.go   # Wails app entry (desktop + Android)
├── internal/               # Go internal packages
│   ├── app/               # Core business (file IO / HTTP server / scanning / download / Blender / presets / thumbnails)
│   ├── dialogs/           # File dialogs
│   ├── thumbnail/         # Thumbnail generation
│   └── util/              # Utilities (pmx parsing / hash / errors / safecall)
├── build/                  # Platform build configs (windows/darwin/linux/ios/android)
├── scripts/                # Build / E2E scripts
├── frontend/src/
│   ├── core/               # Entry / shared state / file URL / icons / responsive / i18n
│   ├── scene/              # 3D scene orchestration
│   │   ├── ar/             # AR camera mode
│   │   ├── camera/         # Camera modes
│   │   ├── motion/         # VMD bridge / procedural animation / LipSync / playback control
│   │   ├── manager/        # ModelManager / materials / loading / operations
│   │   ├── env/            # Environment (sky/water/clouds/particles/lighting/wind)
│   │   ├── pose/           # Pose Studio / composition assist
│   │   └── render/         # Rendering pipeline / lighting / performance degradation
│   ├── menus/              # SlideMenu popup system (library/model/animation/environment/settings)
│   ├── motion-algos/       # Animation algorithms (no Babylon dependency, called by scene/motion/)
│   ├── outfit/             # Outfit system + audio
│   └── __tests__/          # Unit tests + binding contract tests
└── docs/                   # Project docs (architecture / status / ADR / fix flow)
```

---

## ⚠️ Known Limitations

- **Texture Compatibility** — Some PMX texture paths are non-standard (`../tex/` vs `textures/`), `basenameFallbackFS` fallback exists but 100% coverage not guaranteed
- **Blender Editing** — Requires user to install [mmd_tools](https://github.com/powroupi/blender_mmd_tools) plugin, otherwise Blender cannot open PMX
- **Android Experimental** — `main_android.gen.go` uses c-shared mode + WebView, file access constrained by Scoped Storage
- **Cross-platform Paths** — Blender auto-detection only covers Windows; macOS/Linux requires manual config in settings
- **SSS Subsurface Scattering** — Depends on babylon-mmd PBR material support, upstream blocked
- **Windows Directory Picker** — Wails v3 `CanChooseDirectories` defect, actually shows file picker

---

## 🔍 Competitive Analysis

See [docs/competitive-analysis.md](docs/competitive-analysis.md) (23 project research) for details. Brief:

**Rendering Engines / Viewers**
- [babylon-mmd](https://github.com/noname0310/babylon-mmd) — Babylon.js MMD rendering engine (this project is based on it)
- [mmd-viewer-js](https://github.com/pixiставь/mmd-viewer-js) — Zero-dependency JS WebGL viewer, Toon shading + video recording
- [Saba](https://github.com/mmd不开心/Saba) — C++ lightweight viewer, Lua scripting / multi-backend / macro commands

**Desktop Players**
- [DanceXR](https://github.com/Chewhern/DanceXR) — Animation composition / character presence / offline rendering / VR (primary competitor)
- [Coocoo3D](https://github.com/hkrn/coocoo3d) — C#+DX12, ray tracing / GI / SSAO / Decal
- [flowerMiku](https://github.com/miku333/flowerMiku) — C++/Vulkan, PBR materials

**DCC Toolchain**
- [mmd_tools](https://github.com/powroupi/blender_mmd_tools) — Blender PMX plugin (this project's Blender integration depends on it)
- [MMD Bridge](https://github.com/mmd-bridge/MMDBridge) — Alembic export / Python scripts

**AR / XR**
- [ar-mmd](https://github.com/code4fukui/ar-mmd) — WebXR AR spatial MMD model playback demo
- [MikuMikuMixed](https://github.com/importantimport/mikumikumixed) — Experimental WebXR MMD Viewer (React-Three-Fiber + WebXR)
- [web-mmd](https://github.com/culdo/web-mmd) — Browser MMD player with AR mode (phone camera control)

**Frameworks**
- [Wails](https://wails.io) — Go + WebView desktop framework (this project's choice)

## 📜 License

[MIT](LICENSE) — This project's code is free to use.

> ⚠️ This tool does not claim copyright over any model / animation / texture files. PMX / VMD / texture files loaded by users may be subject to their respective creators' licensing restrictions, which are unrelated to this project.