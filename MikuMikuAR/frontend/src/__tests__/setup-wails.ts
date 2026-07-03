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

// ── Babylon.js Engine (root cause of _renderLoops parse error) ──
// The real Engine class has _renderLoops as a class field that esbuild on CI
// cannot parse. Mocking it here prevents the parse error during vi.mock hoisting.
// Individual test files can override with their own vi.mock() for more specific behavior.
vi.mock('@babylonjs/core/Engines/engine', () => ({
    Engine: class {
        _renderLoops = [];
        _features = {};
        runRenderLoop(cb) { if (cb) this._renderLoops.push(cb); }
        stopRenderLoop() { this._renderLoops = []; }
        getRenderWidth() { return 800; }
        getRenderHeight() { return 600; }
        resize() {}
        clear() {}
        getClassName() { return 'Engine'; }
        setHardwareScalingLevel() {}
        getHardwareScalingLevel() { return 1; }
        createRenderPassId() { return 0; }
        releaseRenderPassId() {}
    },
}));
