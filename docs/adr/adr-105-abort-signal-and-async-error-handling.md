# ADR-105: AbortSignal 传递规范与异步异常处理基线

**状态**: 实施中（Phase 1 完成 2026-07-14，P2/P3 待续）

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-14

---

## 背景

2026-07-14 代码质量审计发现前端 224 个 TypeScript 文件中存在以下问题：

| 问题类型 | 数量 | 比例 |
|---------|------|------|
| async 函数总数 | 1256 | 100% |
| 使用 AbortSignal | 8 | 0.6% |
| 有 try/catch 保护 | 0 | 0.0% |
| 未保护的 await 点 | 382 | - |
| **发现问题总数** | **1494** | - |

典型场景：用户快速切换模型时，旧加载任务无法取消，导致：
1. **资源竞争** — 多个模型同时加载，CPU/GPU 争抢
2. **UI 状态混乱** — 进度条显示已放弃任务的进度
3. **内存泄漏** — 已取消的 `ArrayBuffer` 未释放
4. **未处理异常** — 异步错误静默丢失，用户无感知

---

## 决策

### D1: AbortSignal 透传规范

**所有涉及 I/O 的 async 函数必须接受 `signal?: AbortSignal` 参数，并在每个 await 点前检查 `signal?.aborted`。**

#### 适用场景（必须）

- 文件读取：`fetch()`、`fs.readFile()`、`ImportMeshAsync()`
- 网络请求：`fetch()`、`XMLHttpRequest`
- 复杂计算：`WASM` 调用、大数组处理
- 资源加载：`loadPMXFile`、`loadVMDMotion`、`loadOutfits`

#### 不适用场景（可选）

- 纯计算、无副作用的同步/异步函数
- 已有并发控制（如 `_loadingOutfitsGuard`）的函数
- UI 状态更新（无 I/O）

#### 签名规范

```typescript
// ✅ 正确：显式 signal 参数
async function loadPMXFile(
    filePath: string,
    asStage?: boolean,
    skipAutoApply?: boolean,
    libraryPath?: string,
    innerPath?: string,
    signal?: AbortSignal  // ← 必须
): Promise<string | null> {
    if (signal?.aborted) return null;  // ← 每个 await 前检查

    const resp = await fetch(url, { signal });  // ← 透传给底层
}

// ❌ 错误：隐式 AbortController
async function loadPMXFile(filePath: string, ...) {
    const ctrl = new AbortController();  // ← 内部创建，调用方无法控制
}
```

### D2: 异常处理分层

**顶层 async 函数必须有 try/catch；内部 async 函数可依赖调用方处理。**

#### 分层原则

```
┌─────────────────────────────────────────┐
│  UI 层（菜单回调、事件处理器）            │  ← 必须 try/catch + 用户提示
├─────────────────────────────────────────┤
│  业务层（loadPMXFile、loadVMDMotion）    │  ← 必须 try/catch + 状态回滚
├─────────────────────────────────────────┤
│  工具层（fetchArrayBuffer、resolveFileUrl）│  ← 可选 try/catch，依赖调用方
└─────────────────────────────────────────┘
```

#### 错误处理模板

```typescript
// UI 层（必须）
async function handleLoadModel(filePath: string) {
    try {
        setStatus(t('scene.loader.loading'), false);
        const id = await loadPMXFile(filePath);
        if (id) {
            setStatus(t('scene.loader.success'), true);
        }
    } catch (err) {
        setStatus(t('scene.loader.failed', { err }), false);
        logError('handleLoadModel', err);
    }
}

// 业务层（必须）
async function loadPMXFile(filePath: string, signal?: AbortSignal) {
    try {
        if (signal?.aborted) return null;
        const { url, data } = await fetchArrayBuffer(filePath, signal);
        // ... 业务逻辑
    } catch (err) {
        // 清理已分配资源
        disposeMeshes(loadedMeshes);
        throw err;  // ← 重新抛出，调用方需要知道失败
    }
}

// 工具层（可选）
async function fetchArrayBuffer(filePath: string, signal?: AbortSignal) {
    const { url } = await resolveFileUrl(filePath);
    const resp = await fetch(url, { signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return { url, data: await resp.arrayBuffer() };
}
```

### D3: 并发控制与取消语义

**切换操作时，旧任务必须被取消；取消后必须清理已分配资源。**

#### 取消语义

```typescript
// loadPMXFile 内部已有此模式（ADR-096 复用收敛）
let _loadAbortController: AbortController | null = null;

export async function loadPMXFile(filePath: string, signal?: AbortSignal) {
    // 1. 取消之前的加载
    if (_loadAbortController) {
        _loadAbortController.abort();
    }
    const abortCtrl = new AbortController();
    _loadAbortController = abortCtrl;

    // 2. 合并外部 signal（允许外部取消）
    const effectiveSignal = signal ?? abortCtrl.signal;

    // 3. 每个 await 前检查
    if (effectiveSignal.aborted) return null;

    try {
        const result = await ImportMeshAsync(url, _scene, { onProgress });
        if (effectiveSignal.aborted) {
            // 4. 取消后清理资源
            result.meshes.forEach(m => m.dispose());
            return null;
        }
    } catch (err) {
        // 5. 异常时也清理
        disposeMeshes(loadedMeshes);
        throw err;
    }
}
```

---

## 受影响文件

### P2 — AbortSignal 缺失（18 处）

| 文件 | 函数 | 优先级 |
|------|------|--------|
| `core/fileservice.ts` | `fetchArrayBuffer` | 🔴 P1 | ✅ 已完成（2026-07-14） |
| `scene/manager/model-loader.ts` | `loadPMXFile` | 🔴 P1 | ✅ 已完成（2026-07-14，合并外部 signal 与内部 abortCtrl） |
| `scene/motion/vmd-loader.ts` | `loadVMDMotion` | 🔴 P1 | ✅ 已完成（2026-07-14） |
| `scene/motion/vmd-loader.ts` | `loadVMDFromPath` | 🔴 P1 | ✅ 已完成（2026-07-14） |
| `scene/motion/vmd-loader.ts` | `loadCameraVmdFromPath` | 🔴 P1 | ✅ 已完成（2026-07-14） |
| `scene/motion/vmd-loader.ts` | `loadVPDPose` | 🔴 P1 | ✅ 已完成（2026-07-14） |
| `scene/env/props.ts` | `loadProp` | 🟠 P2 |
| `outfit/outfit.ts` | `loadOutfits` | 🟠 P2 |
| `outfit/audio.ts` | `loadAudioFile` | 🟠 P2 |
| `outfit/outfit-overlay.ts` | `loadOverlay` | 🟠 P2 |
| `scene/scene-bundle.ts` | `exportSceneBundle` | 🟠 P2 |
| `menus/library-core.ts` | `_loadThumbnailsForLevel` | 🟠 P2 |
| `menus/library-core.ts` | `reloadConfig` | 🟠 P2 |
| `menus/plaza.ts` | `handlePlazaDownload` | 🟠 P2 |
| `menus/scene-render-levels.ts` | `_loadPresetScene` | 🟠 P2 |
| `menus/scene-render-presets.ts` | `loadUserPresets` | 🟠 P2 |
| `menus/settings-shared.ts` | `preloadAutoImportState` | 🟠 P2 |
| `menus/settings-shared.ts` | `preloadDownloadWatchState` | 🟠 P2 |

### P3 — try/catch 缺失（按模块统计）

| 模块 | 问题数 | 建议修复顺序 |
|------|--------|-------------|
| `core/` | ~50 | 1（基础设施） |
| `scene/` | ~80 | 2 |
| `menus/` | ~120 | 3 |
| `outfit/` | ~30 | 4 |
| `motion-algos/` | ~20 | 5 |

---

## 实施计划

### Phase 1: P1 核心函数（已完成 2026-07-14）

1. ✅ `core/fileservice.ts` — `fetchArrayBuffer` 添加 `signal` 参数（入口检查 + 透传 `fetch(url, { signal })`）
2. ✅ `scene/manager/model-loader.ts` — `loadPMXFile` 暴露 `signal` 参数（合并外部 signal 与内部 abortCtrl.signal 为 effectiveSignal）
3. ✅ `scene/motion/vmd-loader.ts` — 4 个加载函数添加 `signal` 参数并透传至 `fetchArrayBuffer` / `loadVMDMotion`

### Phase 2: P2 加载函数（3-5 天）

批量修改剩余 14 个函数，统一添加 `signal?: AbortSignal` 参数。

### Phase 3: P3 try/catch 补全（持续）

按模块分批修复，从 `core/` 开始。

---

## 验收标准

1. **AbortSignal 覆盖率**：所有 I/O async 函数 100% 支持 `signal` 参数
2. **异常处理覆盖率**：顶层 async 函数 100% 有 try/catch
3. **构建通过**：`npm run build` 无错误
4. **E2E 测试通过**：`npm run test:e2e` 无回归

---

## 相关 ADR

- [ADR-096: 通用辅助函数收敛](adr-096-general-helper-consolidation.md) — `fetchArrayBuffer` 统一入口
- [ADR-057: Shift-JIS URL Base64 修复](adr-057-shift-jis-url-base64.md) — 文件路径编码规范

---

## 弃用说明

无。

---

*本 ADR 由联邦 AI 审计系统自动生成，2026-07-14*