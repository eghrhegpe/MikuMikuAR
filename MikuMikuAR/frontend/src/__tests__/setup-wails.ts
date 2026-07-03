// Global test setup: mock @wailsio/runtime to suppress ECONNREFUSED warnings.
// Tests don't run inside a Wails app, so the runtime's connection attempts are noise.

import { vi } from 'vitest';

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
