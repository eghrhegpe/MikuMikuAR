// Global test setup: mock modules that cause parse errors on CI.
//
// Problem: @babylonjs/core/Engines/engine contains _renderLoops (class field)
// that esbuild on CI (Ubuntu/Node 20) cannot parse. When vi.mock() is hoisted
// and Vitest resolves module paths, esbuild tries to parse the real source.
//
// Solution: Mock the Engine module here (global setup) so the mock is registered
// BEFORE any test file's vi.mock() calls are processed. This prevents esbuild
// from ever loading the real Engine source file.
//
// Only Engine needs mocking — Scene/Mesh/Material etc. are left as real Babylon.js.
// environment-integration.test.ts uses NullEngine (separate from Engine) and real
// Scene/MeshBuilder, so those work fine.

// [fix:test-locale] happy-dom 的 navigator.language 默认为 en-US，而项目以中文为
// 基准语言，大量未显式 setLang('zh-CN') 的用例会因此拿到英文标签而失败。在模块
// 加载前把 localStorage 写为 zh-CN，让 locale.ts 的 loadLang() 读到正确默认值。
if (typeof localStorage !== 'undefined') {
    localStorage.setItem('uiLang', 'zh-CN');
}

import { vi } from 'vitest';

// ── Wails Runtime ────────────────────────────────────────
vi.mock('@wailsio/runtime', () => ({
    Call: {
        ByID: vi.fn().mockResolvedValue(null),
    },
    Events: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
    },
    // Create is used by auto-generated bindings (models.js / app.js) to construct
    // serializable types. The mock provides the same surface: Nullable, Array, Map, Any.
    Create: {
        Nullable: vi.fn((type) => type),
        Array: vi.fn((type) => type),
        Map: vi.fn((_keyType, _valueType) => ({})),
        Any: 'any',
        Events: Object.freeze({}),
    },
    Window: {
        SetTitle: vi.fn(),
        SetBackgroundColour: vi.fn(),
        SetAlwaysOnTop: vi.fn(),
        SetPosition: vi.fn(),
        SetSize: vi.fn(),
        Center: vi.fn(),
        SetDraggable: vi.fn(),
        ToggleMaximise: vi.fn(),
        minimise: vi.fn(),
        maximise: vi.fn(),
        close: vi.fn(),
        hide: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
        minimis: vi.fn(),
        isMaximised: vi.fn().mockResolvedValue(false),
        isMinimised: vi.fn().mockResolvedValue(false),
        isNormal: vi.fn().mockResolvedValue(true),
        isFullscreen: vi.fn().mockResolvedValue(false),
        isVisible: vi.fn().mockResolvedValue(true),
        isFocused: vi.fn().mockResolvedValue(true),
        screen: vi.fn().mockResolvedValue({ size: { width: 1920, height: 1080 } }),
        getScreen: vi.fn().mockResolvedValue({ size: { width: 1920, height: 1080 } }),
    },
}));

// ── ADR-176: Wails 桥标记注入 ────────────────────────────
// resolveBackend() 以 window.wails 判定 go/browser。本 setup 已 mock
// @wailsio/runtime（Call.ByID 秒回 null），语义等价「Go 后端在场」，故显式注入
// 桥标记让选型器立即选 goAdapter——否则 awaitWailsBridge 空等 3s 后误降级
// browser-adapter（happy-dom 无 indexedDB，直接爆错）。
// 需要测试 browser 路径的单测（backend.test.ts）可自行 delete window.wails 覆盖。
if (typeof window !== 'undefined' && typeof (window as { wails?: unknown }).wails === 'undefined') {
    (window as unknown as { wails: { platform: () => string } }).wails = {
        platform: () => 'windows',
    };
}

// ── [doc:adr-219] Phase 2 spike：idb 模块全局 mock ──
// 根因：isolate=false 下 `./idb` 全 worker 只 mock 一次，browser-adapter 单例
// 绑定首个加载者的 mock；文件级 vi.mock 无法重新绑定已加载单例→穿透
// 真实 idb。在全局 setup mock 一次，使全 worker 共享同一 mock，从源头消除顺序
// 敏感。内存实现用双层 store Map（与真实 idb 的 store 分桶语义一致）。
// 有特殊语义的文件（如 config-store 用 spy 断言、chat-store 用自己的桶）可在
// 文件内自己 vi.mock('.../idb') 覆盖——文件级 vi.mock 优先级高于 setup。
const __idbGlobalStore = new Map<string, Map<string, unknown>>();
function __idbBucket(store: string): Map<string, unknown> {
    let b = __idbGlobalStore.get(store);
    if (!b) {
        b = new Map();
        __idbGlobalStore.set(store, b);
    }
    return b;
}
vi.mock('@/core/backend/idb', () => ({
    idbGet: vi.fn(async (store: string, key: string) => __idbBucket(store).get(key)),
    idbSet: vi.fn(async (store: string, key: string, val: unknown) => {
        __idbBucket(store).set(key, val);
    }),
    idbDelete: vi.fn(async (store: string, key: string) => {
        __idbBucket(store).delete(key);
    }),
    idbBatchSet: vi.fn(async (store: string, entries: [string, unknown][]) => {
        for (const [k, v] of entries) {
            __idbBucket(store).set(k, v);
        }
    }),
    idbKeys: vi.fn(async (store: string) => Array.from(__idbBucket(store).keys())),
    openDB: vi.fn(async () => ({}) as unknown),
    closeIDB: vi.fn(),
}));

// ── Babylon.js Engine (root cause of _renderLoops parse error) ──
// The real Engine class has _renderLoops as a class field that esbuild on CI
// cannot parse. Mocking it here prevents the parse error during vi.mock hoisting.
// Individual test files can override with their own vi.mock() for more specific behavior.
vi.mock('@babylonjs/core/Engines/engine', () => ({
    Engine: class {
        _renderLoops = [];
        _features = {};
        runRenderLoop(cb) {
            if (cb) {
                this._renderLoops.push(cb);
            }
        }
        stopRenderLoop() {
            this._renderLoops = [];
        }
        getRenderWidth() {
            return 800;
        }
        getRenderHeight() {
            return 600;
        }
        resize() {}
        clear() {}
        getClassName() {
            return 'Engine';
        }
        setHardwareScalingLevel() {}
        getHardwareScalingLevel() {
            return 1;
        }
        createRenderPassId() {
            return 0;
        }
        releaseRenderPassId() {}
    },
}));
