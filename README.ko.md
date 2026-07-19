# 🎵 MikuMikuAR

> Wails v3 + Babylon.js / babylon-mmd 기반의 크로스플랫폼 MMD 데스크톱 플레이어 —
> PMX 모델 뷰잉, VMD 애니메이션 재생, 즉시 의상 변경, 절차적 댄스, AR 카메라, 카툰 렌더링, 한 곳에서 모두 처리.

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

| 플랫폼 | 상태 |
|--------|------|
| 🪟 Windows | ✅ 확인됨 |
| 🤖 Android | ✅ 확인됨 (c-shared + WebView) |
| 🍎 iOS / 🐧 Linux | 🟡 이론적 호환 (Wails v3 태스크 구성됨, 미테스트) |

| 🌐 언어 |
|----------|
| [简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [**한국어**](README.ko.md) · [繁體中文](README.zh-TW.md) |

---

## ✨ 기능

### 🎭 렌더링 및 모델

- **PMX/PMD 로딩** — 완전한 babylon-mmd 렌더링 파이프라인, SDEF / IK 본 / Grant 가중치 지원
- **멀티모델 동시** — 여러 PMX 모델이 씬 공유, 6가지 진형 배치, 포커스 전환
- **썸네일 미리보기** — 모델 로드 후 자동 스크린샷, 라이브러리 카드에서 바로 확인
- **재질별 조정** — 부위별 (피부/머리카락/눈/의상/악세서리/소품) 일괄 조정 + 개별 재질 덮어쓰기
- **스마트 재질 분류** — 피부/머리카락/눈/의상/악세서리/소품 자동 감지, 사용자 정의 정규식 규칙 지원
- **모델 프리셋** — 재질/표정/변환 스냅샷, 라이브러리 수준 관리, 원클릭 적용
- **의상 변형** — `outfits.json` 으로 텍스처/mesh 변형 기술, 자동 발견 + 원클릭 교체
- **카툰 렌더링** — 원클릭 Cel-shading 후처리 모드 (exposure/contrast/ACES/bloom/fxaa 프리셋 스냅샷)
- **Pose Studio** — 구도 보조, 피사계 심도, T-pose/A-pose 변환, 일괄 스크린샷, 워터마크

---

### 💃 애니메이션 및 오디오

- **VMD 애니메이션 재생** — 모델별 독립 바인딩, 진행 드래그 / 루프 / 키보드 제어
- **절차적 애니메이션** — `Idle` (호흡/눈 깜빡임), `AutoDance` (비트 기반 움직임), `Lifelike` (미세 움직임 오버레이)
- **VPD 포즈 가져오기** — 텍스트 파싱 → VMD 프레임, 원클릭 포즈 (UTF-8/Shift-JIS 자동 인식)
- **카메라 VMD 트랙** — 카메라 VMD 로드, 멀티모드 자유 전환
- **절차적 카메라워크** — 8가지 자동 카메라 프리셋, 비트 기반 폐루프
- **LipSync** — 진폭 → 입술 morph 가중치, 다중 입술 구동 (あ/い/う/え + 중/영/일 후보명)
- **비트 감지** — Web Audio 에너지 피크법 실시간 BPM, 멀티트랙 지원
- **Motion Layers** — 이중 VMD 레이어 블렌딩 + boneFilter 본 필터링
- **Motion Override** — 본별 회전/이동 덮어쓰기, 절차적 애니메이션과 VMD 공존

---

### ⚙️ 물리

- **WASM Bullet 물리** — MMD 네이티브 강체 / 관절 / 연체, 타임라인과 동기화

---

### 🌍 환경

- **수면** — Gerstner 파 (4 레이어) + 코스틱 + 잔물결 + 수중 전환 + 반사 RenderTarget
- **볼류메트릭 구름** — 3D 노이즈 ray-marching + 바람장 구동
- **파티클 시스템** — 7종 (벚꽃/비/눈/불꽃/반딧불/낙엽/물보라), 바람장 연동
- **절차적 지형** — FBM 노이즈 높이맵 + 경사 텍스처 롤링 + 정반사 + 법선맵 + 고도 착색
- **조명 및 후처리** — Bloom / DOF / SSAO / SSR / 림 렌더링 / 톤 매핑 / FXAA, 성능 자동 저하

---

### 📚 라이브러리 및 도구

- **모델 라이브러리 관리** — 재귀 스캔, zip 내부 검사, 태그/즐겨찾기/검색, 다운로드 디렉토리 감시 + 자동 가져오기
- **Zip 컨테이너** — 압축 해제 없이 PMX/VMD 직접 로드, SHA-256 캐시 지연 재사용
- **Scene Bundle** — 씬을 zip으로 패키징 (참조 리소스 전체 포함), 기기 간 가져오기/내보내기
- **Blender 실행** — 자동 감지 / 수동 경로 설정, ✏️ 클릭으로 Blender에서 PMX 편집 ([mmd_tools](https://github.com/powroupi/blender_mmd_tools) 플러그인 필요)

---

### 👁️ 캐릭터 인식

- **시선 추적** — Eye Contact 응시, VMD 없이도 모델을 "살아있게"
- **머리 추적** — 머리가 카메라/사용자 추종, 생동감 향상

---

### 📷 AR 카메라

- **비디오 투과 + 모델 오버레이** — 카메라 영상을 씬 배경으로, 모델을 비디오 위에 렌더링
- **전면/후면 전환** — 모바일 자동 후면 선택, 데스크톱 기본 전면
- **Gaze 협동** — AR 모드에서 자동 시선 추적 활성화, 실물과의 시선 접촉 강화
- **스크린샷 합성** — 비디오 배경 + 3D 모델 원클릭 합성
- **Android 권한** — CAMERA 런타임 권한 네이티브 브리지

---

### 🌐 국제화

- **5개 언어** — 简体中文 / English / 日本語 / 한국어 / 繁體中文, 핫 스위치

---

## ⌨️ 키보드 단축키

| 단축키 | 동작 |
|--------|------|
| Ctrl+1~5 | 5개 하단 탐색 팝업 전환 (모델/애니메이션/씬/환경/설정) |
| Ctrl+6 | AR 카메라 모드 전환 |
| Space | 재생/일시정지 |
| Escape | 모든 팝업 닫기 |
| ←/→ | seek ±5초 |
| ↑/↓ | 메뉴 항목 탐색 (팝업 내) |
| Enter/→ | 선택 항목 활성화 (팝업 내) |
| ← (팝업 내) | 상위로 돌아가기 |
| WASD | 자유 비행 카메라 (Freefly 모드 활성화 필요) |

---

## 📖 문서

| 문서 | 내용 |
|------|------|
| [프로젝트 현황](docs/status.md) | 현재 상태 + 완료된 기능 |
| [아키텍처](docs/architecture.md) | 전체 기능 요약 |
| [설계 결정](docs/adr/) | 80+ ADR 기술 접근 방식 |
| [요구사항 및 선정](docs/requirements.md) | P0-P4 우선순위 + 기술 선정 이유 |
| [경쟁 분석](docs/competitive-analysis.md) | 23개 프로젝트 조사 |
| [코딩 기담](novel/README.md) | 100+ 챕터 코드 진화 이야기 |
| [AI 워크플로 규칙](AGENTS.md) | AI 협업 가이드 |

---

## 🚀 빠른 시작

### 사전 요구사항

| 의존성 | 버전 | 설명 | 확인 방법 |
|--------|------|------|---------|
| **Go** | 1.25+ | 백엔드 컴파일 | `go version` |
| **Node.js** | 24+ | 프론트엔드 빌드 | `node --version` |
| **npm** | 11+ | 패키지 관리 | `npm --version` |
| **Wails v3 CLI** | 최신 | 핫 리로드 개발 필수 | `wails3 version` → `go install github.com/wailsapp/wails/v3/cmd/wails3@latest` |
| **PowerShell 7** | — | Windows 빌드 스크립트 (선택) | `pwsh --version` |
| **GitHub CLI** | — | 릴리스 워크플로 (선택) | `gh --version` |

> **E2E 테스트:** Playwright 브라우저 설치
> ```bash
> cd frontend && npx playwright install chromium
> ```
>
> **WASM Bullet 물리 (선택):** 로컬 컴파일을 위해 [Rust](https://rustup.rs/) 설치
> ```bash
> rustc --version   # 설치 확인
> ```

**Linux 추가 의존성** (데스크톱 앱 빌드):
```bash
sudo apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev libglib2.0-dev \
  libsoup-3.0-dev libgdk-pixbuf-2.0-dev libpango1.0-dev libcairo2-dev \
  libatk1.0-dev libgirepository1.0-dev
```

### 개발 실행

```bash
# 클론 후 프론트엔드 초기화
cd frontend && npm install

# 핫 리로드 개발 시작 (Go 백엔드 + Vite 프론트엔드 동시 실행)
wails3 dev -config ./build/config.yml -port 9245
```

#### 고급: 수동 분할 (최대 제어력)

프론트엔드를 완전히 독립적으로 핫 리로드하고 Go 프로세스를 장기 상주시키려면 두 터미널로 분할:

```bash
# 터미널 1 — 프론트엔드 (Vite HMR, TS 변경 시 초 단위 리프레시, Go 비접촉)
cd frontend && npm run dev          # npx vite --port 9245 와 동일

# 터미널 2 — 백엔드 (한 번 컴파일 후 상주; Go 변경 시에만 재실행)
wails3 build DEV=true
wails3 task run
```

- **TS / HTML / CSS** 변경 → 터미널 1의 Vite만 자동 리프레시, 앱 창 재구성 없음.
- **Go** 변경 → 터미널 2로 돌아가 `wails3 build DEV=true && wails3 task run` 재실행으로 백엔드 재시작.
- 수동 분할 시 `wails3 dev` 는 관여하지 않음; Vite 포트 (기본 `9245`)와 백엔드 dev URL 일치를 직접 보장해야 함.

### 테스트

```bash
cd frontend

# 타입 검사 (변경 후 필수 실행)
npm run check

# 단위 테스트 (Vitest)
npm run test
npm run test:watch     # 감시 모드

# E2E 테스트 (wails3 dev 또는 5173+9222 포트를 먼저 실행해야 함)
npm run test:e2e
npm run test:e2e:headed   # 헤드 디버그

# 116개 Go 바인딩 함수 존재 여부 + FNV-1a method ID 검증
npm run test -- src/__tests__/bindings/app.contract.test.ts
```

### 프로덕션 빌드

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1 -Production

# Linux
bash scripts/build-linux.sh --production
```

---

## 🤖 AI 협업 툴체인

본 프로젝트는 **여러 AI가 공동으로 유지 관리**하며, 각 도구가 역할을 분담합니다:

| 터미널 | 모델 | 역할 |
|---------|------|------|
| **Trae** | GLM5.2+doubao2.1 | 수석 아키텍트 · 코드 생성 · 리뷰 |
| **Workbuddy** | hy3 | 태스크 계획 · 진행 추적 · 스킬 보조 |
| **OpenCode** | NVidia/mistral-small-4 | 프론트엔드 UI 개발 · 백엔드 디버깅 |
| **Reasonix** | Deepseek-v4-flash | git push |
| **Mimocode** | Mimo-v2.5 | 문서 생성 · 추론 분석 · 문제 위치 파악 |

---

## 📁 프로젝트 구조

```
MikuMikuAR/
├── main.go / main_android.gen.go   # Wails 앱 진입점 (데스크톱 + Android)
├── internal/               # Go 내부 패키지
│   ├── app/               # 핵심 비즈니스 (파일 IO / HTTP 서버 / 스캔 / 다운로드 / Blender / 프리셋 / 썸네일)
│   ├── dialogs/           # 파일 다이얼로그
│   ├── thumbnail/         # 썸네일 생성
│   └── util/              # 유틸리티 (pmx 파싱 / hash / errors / safecall)
├── build/                  # 플랫폼 빌드 설정 (windows/darwin/linux/ios/android)
├── scripts/                # 빌드 / E2E 스크립트
├── frontend/src/
│   ├── core/               # 진입점 / 공유 상태 / 파일 URL / 아이콘 / 반응형 / i18n
│   ├── scene/              # 3D 씬 오케스트레이션
│   │   ├── ar/             # AR 카메라 모드
│   │   ├── camera/         # 카메라 모드
│   │   ├── motion/         # VMD 브리지 / 절차적 애니메이션 / LipSync / 재생 제어
│   │   ├── manager/        # ModelManager / 재질 / 로딩 / 작업
│   │   ├── env/            # 환경 (하늘/수면/구름/파티클/조명/바람)
│   │   ├── pose/           # Pose Studio / 구도 보조
│   │   └── render/         # 렌더링 파이프라인 / 조명 / 성능 저하
│   ├── menus/              # SlideMenu 팝업 시스템 (라이브러리/모델/애니메이션/환경/설정)
│   ├── motion-algos/       # 애니메이션 알고리즘 (Babylon 미종속, scene/motion/ 에서 호출)
│   ├── outfit/             # 의상 시스템 + 오디오
│   └── __tests__/          # 단위 테스트 + 바인딩 계약 테스트
└── docs/                   # 프로젝트 문서 (아키텍처 / 현황 / ADR / 수정 플로우)
```

---

## ⚠️ 알려진 제한사항

- **텍스처 호환성** — 일부 PMX 텍스처 경로가 비표준 (`../tex/` vs `textures/`), `basenameFallbackFS` 로 폴백하지만 100% 커버리지는 보장되지 않음
- **Blender 편집** — 사용자가 [mmd_tools](https://github.com/powroupi/blender_mmd_tools) 플러그인을 직접 설치해야 함, 그렇지 않으면 Blender에서 PMX를 열 수 없음
- **Android 실험적** — `main_android.gen.go` 는 c-shared 모드 + WebView 사용, Scoped Storage 제약 존재
- **크로스플랫폼 경로** — Blender 자동 감지는 Windows만 지원; macOS/Linux는 설정에서 수동 구성 필요
- **SSS 서브서피스 산란** — babylon-mmd PBR 재질 지원에 의존, 상류 차단 중
- **Windows 디렉토리 선택** — Wails v3 `CanChooseDirectories` 결함, 실제로 파일 선택기가 표시됨

---

## 🔍 경쟁 분석

자세한 내용은 [docs/competitive-analysis.md](docs/competitive-analysis.md) (23개 프로젝트 조사) 참조. 개요:

**렌더링 엔진 / 뷰어**
- [babylon-mmd](https://github.com/noname0310/babylon-mmd) — Babylon.js MMD 렌더링 엔진 (본 프로젝트 기반)
- [mmd-viewer-js](https://github.com/pixiставь/mmd-viewer-js) — 제로 의존 JS WebGL 뷰어, Toon 쉐이딩 + 비디오 녹화
- [Saba](https://github.com/mmd不开心/Saba) — C++ 경량 뷰어, Lua 스크립팅 / 멀티 백엔드 / 매크로 명령

**데스크톱 플레이어**
- [DanceXR](https://github.com/Chewhern/DanceXR) — 애니메이션 합성 / 캐릭터 동시 존재 / 오프라인 렌더링 / VR (주요 벤치마크)
- [Coocoo3D](https://github.com/hkrn/coocoo3d) — C#+DX12, 레이 트레이싱 / GI / SSAO / Decal
- [flowerMiku](https://github.com/miku333/flowerMiku) — C++/Vulkan, PBR 재질

**DCC 툴체인**
- [mmd_tools](https://github.com/powroupi/blender_mmd_tools) — Blender PMX 플러그인 (본 프로젝트의 Blender 통합 의존)
- [MMD Bridge](https://github.com/mmd-bridge/MMDBridge) — Alembic 내보내기 / Python 스크립트

**AR / XR**
- [ar-mmd](https://github.com/code4fukui/ar-mmd) — WebXR AR 공간 MMD 모델 재생 데모
- [MikuMikuMixed](https://github.com/importantimport/mikumikumixed) — Experimental WebXR MMD Viewer (React-Three-Fiber + WebXR)
- [web-mmd](https://github.com/culdo/web-mmd) — 브라우저 MMD 플레이어, AR 모드 포함 (폰 카메라 제어)

**프레임워크**
- [Wails](https://wails.io) — Go + WebView 데스크톱 프레임워크 (본 프로젝트 선정)

## 📜 라이선스

[MIT](LICENSE) — 본 프로젝트의 코드는 자유롭게 사용할 수 있습니다.

> ⚠️ 본 도구는 모델 / 애니메이션 / 텍스처 파일의 저작권을 주장하지 않습니다. 사용자가 로드하는 PMX / VMD / 텍스처 파일은 각 창작자의 라이선스 제한을 받을 수 있으며, 본 프로젝트와 무관합니다.