# ADR-178: 能力矩阵补全宿主级键（四端统一收口）

> **状态**: Proposed（草案，待架构审核）
> **日期**: 2026-07-24
> **关联**: ADR-176（前端 Backend 适配器双实现）、ADR-177（Web Loader 与主应用统一路径）、ADR-017（安卓适配，platform 探测范式）、ADR-133（安卓 MPR 物理缺口）、ADR-093（声明式菜单 Schema）
> **前置**: ADR-176/177 已落地（`BackendService` 双适配器 + `getCapabilities()`/`getCachedCapabilities()` 能力缓存）
> **审核记录**: 无（首版草案）

## 背景

用户诉求：四端（网页模式 / 桌面应用 / 网页模式安卓 / 安卓应用）是否该统一。

核查结论：**四端不是四个代码库，而是一个前端代码库 ×（2 种 Backend 适配器 × 2 类宿主）的 2×2 矩阵**。代码复用层已被 ADR-176/177 的适配器模式解决，不存在"合并代码"问题，故不触发重写。

| | **桌面宿主** | **安卓宿主** |
|---|---|---|
| **Wails 原生（go-adapter）** | 桌面应用 ✅ | 安卓应用 ✅（ADR-017） |
| **纯网页（browser-adapter）** | 网页模式 ✅（ADR-176/177） | 网页模式安卓（同一 browser-adapter，仅多安卓浏览器怪癖） |

但现状有两处不闭环，导致"四端差异"仍靠散落判定而非能力层表达：

1. **`BackendCapabilities`（13 键）只覆盖后端原生能力**，缺宿主运行时能力。安卓应用 vs 桌面应用、网页模式 vs 网页模式安卓之间的真正差异是三位宿主级标志，矩阵里完全没有：
   - `crossOriginIsolated` —— MPR 多线程物理（ADR-133）的唯一功能性断点：仅网页模式与桌面应用为 `true`，**安卓应用 WebView 恒 `false`**。
   - `clipboardReliable` —— 安卓应用 WebView 与部分安卓浏览器剪贴板 API 可能缺失（即 ADR-017 A2-06 根因）。
   - `arScope` —— 矩阵现有 `ar: boolean` 只标"原生独占"，但实际只有**安卓应用**（ARCore）能跑；网页模式安卓（WebXR）未接通，桌面/网页模式也应有别。
2. **散落 `isAndroidPlatform()` 直接判定 11+ 处**（已核实）：`fileservice.ts:63`、`virtual-skirt.ts:238`、`ar-camera.ts:151`、`settings-appearance.ts:476`、`settings-resources.ts:162/412`、`library-setup.ts:96/119/138`、`plaza-browser.ts:695`、`platform.ts:72/92`、`init.ts:328/464` 等。其中与"能力"相关的应改走 `getCachedCapabilities()`，否则能力矩阵形同虚设。

## 决策

在 `BackendCapabilities` 新增 **3 个宿主级键**，让两 adapter 的 `capabilities()` **如实自报运行时**，UI 一律查 `getCachedCapabilities()`，逐步消除散落 `isAndroidPlatform()`。不引入第四种代码路径、不碰 139 个契约函数。

核心洞见：`go-adapter` 同时服务桌面应用与安卓应用，三者差异**不能硬编码**，必须读运行时自报——
- `crossOriginIsolated` 读 `window.crossOriginIsolated`（桌面 Wails 为 `true`，安卓应用 WebView 为 `false`，恰是 MPR 断点本身）；
- `arScope` / `clipboardReliable` 用 `isAndroidPlatform()` 区分桌面与安卓应用。

## 精确改法（待批准）

### ① `frontend/src/core/backend/types.ts` —— `BackendCapabilities` 接口（当前 19-33 行）末尾追加

```ts
    modelScan: boolean; // 模型库扫描（FSA 授权目录替代）
    // [doc:adr-178] 宿主运行时键：区分 go-adapter 双宿主（桌面/安卓应用）与 browser-adapter 双宿主（网页模式桌面/安卓浏览器）
    crossOriginIsolated: boolean; // SharedArrayBuffer 可用（MPR 多线程物理依赖）—— 宿主运行时自报
    clipboardReliable: boolean;  // 剪贴板 API 可靠（Android WebView 部分版本不可用，见 ADR-017 A2-06）
    arScope: 'none' | 'android-app' | 'webxr'; // AR 作用域：无 / 安卓应用 ARCore / 网页 WebXR
```

### ② `frontend/src/core/backend/go-adapter.ts` —— `capabilities()`（当前 26-40 行）

导入（第 8 行后追加）：
```ts
import { isAndroidPlatform } from '../platform';
```
返回对象末尾追加（注意：`go-adapter` 同时服务桌面与安卓应用，必须读运行时）：
```ts
        modelScan: true,
        // [doc:adr-178] 宿主运行时键：go-adapter 同时服务桌面与安卓应用，禁止硬编码
        crossOriginIsolated: typeof window !== 'undefined' && window.crossOriginIsolated === true,
        clipboardReliable: !isAndroidPlatform(), // 桌面原生可靠；安卓应用 WebView 可能不可用（A2-06）
        arScope: isAndroidPlatform() ? 'android-app' : 'none', // 桌面无 AR；安卓应用走 ARCore
```

### ③ `frontend/src/core/backend/browser-adapter.ts` —— `_cap()`（当前 79-99 行）

返回对象末尾追加（browser-adapter 同时服务网页模式桌面与网页模式安卓，两者宿主运行时一致）：
```ts
        modelScan: fsAccess,
        // [doc:adr-178] 宿主运行时键：browser-adapter 服务网页模式（桌面+安卓浏览器）
        crossOriginIsolated: typeof window !== 'undefined' && window.crossOriginIsolated === true,
        clipboardReliable: true, // 标准浏览器 API 存在（手势由调用点保证，A2-06 已兜底静默 catch）
        arScope: 'none', // 网页模式安卓 WebXR 未接通；接通后改 'webxr'（不阻塞）
```

### ④ `frontend/src/core/backend/backend.test.ts` —— 同步 mock 与断言

`vi.mock('./go-adapter', …)` 的 `capabilities` 返回对象（8-22 行）补 3 键：
```ts
            modelScan: true,
            crossOriginIsolated: true,
            clipboardReliable: true,
            arScope: 'none',
```
`browserAdapter 能力矩阵` 段（63-77 行）增断言：
```ts
    it('宿主运行时键：crossOriginIsolated 读运行时、arScope 为 none', () => {
        const c = browserAdapter.capabilities();
        expect(c.crossOriginIsolated).toBe(typeof window !== 'undefined' && window.crossOriginIsolated === true);
        expect(c.clipboardReliable).toBe(true);
        expect(c.arScope).toBe('none');
    });
```

## 四端 2×2 能力快照（详表见 `docs/targets.md`）

| 能力键 | 桌面应用 (go) | 安卓应用 (go) | 网页模式 (browser) |
|--------|--------------|--------------|-------------------|
| crossOriginIsolated | `window` 值（true） | `window` 值（**false**） | `window` 值（true） |
| clipboardReliable | true | **false** | true |
| arScope | none | **android-app** | none |
| ar（原生独占） | false | true | false |
| externalApps | true | false | false |
| fsAccess | false | false | 检测 FSA |
| storageMode | true | true | FSA 检测 |
| …（其余 13 键不变） | 全开 | 全开（除 externalApps/ar） | 浏览器实情 |

> 要点：网页模式安卓与网页模式桌面共享同一 browser-adapter，宿主运行时键取值一致（这是正确的——安卓浏览器与桌面浏览器在 `crossOriginIsolated`/剪贴板上行为相同）；其独有怪癖（如 A2-06 个别版本）由 `clipboardReliable` 在调用点兜底覆盖。

## 迁移计划

- **阶段 1（本 ADR 范围）**：加 3 键 + 两 adapter `capabilities()` 自报 + 单测。编译通过、契约测试 139 函数不受影响。
- **阶段 2（后续，可独立提交）**：散落 `isAndroidPlatform()` 中与"能力"相关的改走 `getCachedCapabilities()`：
  - `virtual-skirt.ts:238` 品质降级 → 读 `crossOriginIsolated`（安卓应用自动降单线程物理，与 ADR-133 一致）；
  - `fileservice.ts:63` 已可用 `backend.kind === 'browser' || isAndroidPlatform()` 表达，后续统一为 `!crossOriginIsolated` 语义更准；
  - `ar-camera.ts:151` 的 `isAndroidPlatform()` **保留**（那是相机权限判定，非能力，不应并入能力层）；
  - `settings-*` / `library-setup.ts` 中"仅安卓显示某 UI"的，若属能力差异则改能力层，若属布局/权限则保留。
- **阶段 3（另立或并入 CI）**：`docs/targets.md` 固化为唯一真相源；CI 增四端制品矩阵（桌面三平台 + 安卓 APK + GitHub Pages 网页）各跑对应 smoke。

## 风险与边界

| 等级 | 项 | 缓解 |
|------|----|------|
| 🟠 P2 | `crossOriginIsolated` 硬编码风险 | go-adapter **必须读 `window` 运行时**，不得写死 `true`，否则安卓应用误报可开 MPR（ADR-133 根因重现） |
| 🟡 P3 | `arScope` 在网页模式安卓当前 `none` | WebXR 未接通，标 `none` 不阻塞；接通后改 `'webxr'` |
| 🟢 P4 | `clipboardReliable` 在安卓应用标 `false` 偏保守 | 仅用于调用点兜底提示（A2-06 已补 toast），不影响复制成功路径 |
| ⚪ 架构红线 | 不引入第四种代码路径 | 四端共用 `frontend/`，差异只经 `BackendService` + 能力矩阵表达 |

## 测试

- `backend.test.ts`：go-adapter mock 补 3 键；browser-adapter 增 3 键断言（见 ④）。
- 契约测试（`app.contract.test.ts`）：139 函数不变，不受影响。
- E2E：安卓应用 MPR 物理应观测到单线程降级（能力层如实反映），不引入行为退步。
