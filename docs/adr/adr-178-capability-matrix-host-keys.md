# ADR-178: 能力矩阵补全宿主级键（四端统一收口）

> **状态**: 已完成（Phase 1-3 全部落地 2026-07-24/07-25——virtual-skirt.ts/fileservice.ts/settings-resources.ts:412 三处已迁移至能力层，其中 settings-resources.ts:412 配套修正 go-adapter `watchDir` 改为 `!isAndroidPlatform()` 自报（修复 ADR 草案宿主盲点）；其余 5 处判定为平台特有逻辑保留不动；Phase 3 已落地 2026-07-26——CI 四端制品矩阵固化：e2e-web-smoke job 跑 @web smoke（web-smoke.spec.ts + web-resources.spec.ts），验证浏览器能力门控、PMX/ZIP/VMD 加载闭环；桌面/安卓构建保留在 release.yml；网页部署由 web-pages.yml 自动触发）
> **日期**: 2026-07-24
> **关联**: ADR-176（前端 Backend 适配器双实现）、ADR-177（Web Loader 与主应用统一路径）、ADR-017（安卓适配，platform 探测范式）、ADR-133（安卓 MPR 物理缺口）、ADR-093（声明式菜单 Schema）
> **前置**: ADR-176/177 已落地（`BackendService` 双适配器 + `getCapabilities()`/`getCachedCapabilities()` 能力缓存）
> **审核记录**: 2026-07-26 审核通过（66→67 单测）。补 browser-adapter 宿主键断言（P3，原草案 ④ 指定但未落地）；无其余风险项

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
   - `arScope` —— 矩阵现有 `ar: boolean` 标"AR 相机透视"（getUserMedia camera passthrough，**桌面/安卓应用均可用**，由 `motion-camera-levels.ts:96`/`ar-camera.ts` 实际消费）；而**原生 AR 路由作用域**缺位：`arScope` 才是 ARCore/Vuforia/WebXR 原生独占标记，仅安卓应用为 `android-app`。（审核修正：原草案误将 `ar` 当"原生独占"，已纠正——`ar` 保持 `true` 正确）
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

### ③ `frontend/src/core/backend/browser-adapter.ts` —— `_cap()`（已落地，79-99 行）

返回对象末尾追加（browser-adapter 同时服务网页模式桌面与网页模式安卓，两者宿主运行时一致）：
```ts
        modelScan: fsAccess,
        // [doc:adr-178] 宿主运行时键：browser-adapter 服务网页模式（桌面+安卓浏览器）
        crossOriginIsolated:
            typeof window !== 'undefined' &&
            (window as { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
        clipboardReliable: typeof navigator !== 'undefined' && !!navigator.clipboard,
        arScope: typeof navigator !== 'undefined' && 'xr' in navigator ? 'webxr' : 'none',
```
> 落地偏差（相对草案）：`clipboardReliable` 由硬编码 `true` 改为运行时检测 `!!navigator.clipboard`（更诚实，不依赖调用点手势假设）；`arScope` 由硬编码 `'none'` 改为 `navigator.xr` 检测（WebXR 可用即 `webxr`）。二者均属能力如实自报，且 `arScope` 当前无 UI 消费（阶段 2 才接入），不引发行为变化。

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
| ar（相机透视 getUserMedia，非原生 ARCore 独占） | true | true | false |
| externalApps | true | false | false |
| fsAccess | false | false | 检测 FSA |
| storageMode | true | true | FSA 检测 |
| …（其余 13 键不变） | 全开 | 全开（除 externalApps/ar） | 浏览器实情 |

> 要点：网页模式安卓与网页模式桌面共享同一 browser-adapter，宿主运行时键取值一致（这是正确的——安卓浏览器与桌面浏览器在 `crossOriginIsolated`/剪贴板上行为相同）；其独有怪癖（如 A2-06 个别版本）由 `clipboardReliable` 在调用点兜底覆盖。

## 迁移计划

- **阶段 1（本 ADR 范围）**：加 3 键 + 两 adapter `capabilities()` 自报 + 单测。编译通过、契约测试 139 函数不受影响。
- **阶段 2（后续，可独立提交）**：散落 `isAndroidPlatform()` 中与"能力"相关的改走 `getCachedCapabilities()`：
  - ✅ `virtual-skirt.ts:238` 品质降级 → 已迁移至 `!getCachedCapabilities().crossOriginIsolated`（2026-07-25）
  - ✅ `fileservice.ts:63` → 已迁移至 `backend.kind === 'browser' || !getCachedCapabilities().crossOriginIsolated`（2026-07-25）
  - `ar-camera.ts:136` 的 `isAndroidPlatform()` **保留**（那是相机权限判定，非能力，不应并入能力层）；
  - 其余 6 处逐项判定结果（2026-07-25）：
    - `library-setup.ts:96/119` — **保留**（`selectResourceRoot`/`selectOverridePath` 依赖 `SelectDir` Go 桥，安卓无此桥，属平台特有 UI 限制）
    - `library-setup.ts:138` — **保留**（`switchStorageMode` 仅安卓有 private/shared 存储概念，桌面无此区分）
    - `settings-appearance.ts:476` — **保留**（屏幕常亮 `setKeepAwake` 是安卓桥函数，桌面无此功能）
    - `settings-resources.ts:162` — **保留**（`buildStorageSchema` 中安卓用 `GetStorageMode`+自定义渲染，非安卓用 `SelectDir` 路径选择器，属平台特有 UI 差异）
    - `settings-resources.ts:412` — ✅ **已迁移至 `getCachedCapabilities().watchDir`**（2026-07-25）。配套修正：go-adapter 原 `watchDir: true` 硬编码对桌面/安卓应用统一返回 true，导致安卓应用误报可监听目录；改为 `watchDir: !isAndroidPlatform()` 自报，使下载监听卡片在安卓应用继续正确隐藏。此为 ADR 草案迁移判断的宿主盲点修正。
    - `plaza-browser.ts:695` — **保留**（打开模式选项差异：安卓仅"系统浏览器"，桌面有"内嵌页"+"独立窗口"；`plazaWindow` 能力已独立表达，此处属布局差异）
    - `init.ts:328` — **保留**（默认性能模式：安卓 `balanced`，桌面 `auto`，属平台默认配置策略）
    - `init.ts:464` — **保留**（`checkAndroidStoragePermission` 安卓存储权限弹窗，仅安卓需要）
- **阶段 3（已落地 2026-07-26）**：`docs/targets.md` 固化为唯一真相源；CI 增 `e2e-web-smoke` job（`@web` tag）跑 web-smoke + web-resources smoke，验证浏览器能力门控与资源加载闭环。桌面三平台 + 安卓 APK 构建保留在 `release.yml`。网页部署由 `web-pages.yml` 自动触发 GitHub Pages。

## 风险与边界

| 等级 | 项 | 缓解 |
|------|----|------|
| 🟠 P2 | `crossOriginIsolated` 硬编码风险 | go-adapter **必须读 `window` 运行时**，不得写死 `true`，否则安卓应用误报可开 MPR（ADR-133 根因重现） |
| 🟡 P3 | `arScope` 在网页模式安卓当前 `none` | WebXR 未接通，标 `none` 不阻塞；接通后改 `'webxr'` |
| 🟢 P4 | `clipboardReliable` 在安卓应用标 `false` 偏保守 | 仅用于调用点兜底提示（A2-06 已补 toast），不影响复制成功路径 |
| ⚪ 架构红线 | 不引入第四种代码路径 | 四端共用 `frontend/`，差异只经 `BackendService` + 能力矩阵表达 |

## Phase 1 落地记录（2026-07-24）

- **代码改动（4 文件 + test mock，均已落盘）**：
  - `types.ts`：`BackendCapabilities` 追加 `crossOriginIsolated` / `clipboardReliable` / `arScope` 三键；`ar` 注释纠正为"相机透视（getUserMedia），桌面/安卓可用，与 arScope 正交"。
  - `go-adapter.ts`：导入 `isAndroidPlatform`；`capabilities()` 三键运行时自报（`crossOriginIsolated` 读 `window.crossOriginIsolated`、`clipboardReliable=!isAndroidPlatform()`、`arScope=isAndroidPlatform()?'android-app':'none'`）；`ar` 保持 `true`。
  - `browser-adapter.ts`：`_cap()` 三键运行时自报（`arScope` 按 `navigator.xr` 检测）。
  - `index.ts`：`ALL_TRUE_CAPS` 兜底补三键（`crossOriginIsolated`/`clipboardReliable=true`、`arScope='none'`）。
  - `backend.test.ts`：go mock 补三键。
- **验证**：`tsc --noEmit` 全项目 **0 错误**；`backend.test.ts` **57/57 通过**；契约 139 函数不受影响。
- **审核修正已采纳**：`ar` 键语义非"原生独占"（草案误判），保持 `true`；真正不一致在文档，已在 `targets.md` + 本 ADR 纠正。
- **进度（2026-07-25）**：
  - Phase 2 已迁移 3/8 处：`virtual-skirt.ts`（`crossOriginIsolated`）、`fileservice.ts`（`crossOriginIsolated`）、`settings-resources.ts:412`（`watchDir`，配套修正 go-adapter `watchDir: !isAndroidPlatform()` 自报以修复宿主盲点）
  - Phase 2 判定完成 5 处：均保留（平台特有逻辑：library-setup.ts:96/119/138、settings-appearance.ts:476、plaza-browser.ts:695、init.ts:328/464、settings-resources.ts:162）
  - Phase 2 结论：**散落 `isAndroidPlatform()` 中与"能力"相关的已全部收口至能力层；其余属平台特有 UI/权限逻辑，明文裁定保留**
  - Phase 3（CI 四端矩阵）✅ 已落地（2026-07-26）：
    - CI 新增 `e2e-web-smoke` job，跑 `@web` tag smoke tests
    - `web-smoke.spec.ts` 验证：首屏渲染、环境菜单、快捷键门控、能力门控（AR/广场窗口隐藏）
    - `web-resources.spec.ts` 验证：PMX/ZIP/VMD 加载闭环、IndexedDB CRUD
    - 桌面/安卓构建保留在 `release.yml`，网页部署由 `web-pages.yml` 触发

## 测试

- `backend.test.ts`：go-adapter mock 补 3 键；browser-adapter 增 3 键断言（见 ④）。
- 契约测试（`app.contract.test.ts`）：139 函数不变，不受影响。
- E2E：安卓应用 MPR 物理应观测到单线程降级（能力层如实反映），不引入行为退步。
