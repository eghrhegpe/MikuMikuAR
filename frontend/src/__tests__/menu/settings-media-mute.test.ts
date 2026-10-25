// menu/settings-media-mute.test.ts — [audit:fix 2026-10] P2⑥ media:mute 音量恢复回归测试
// 修复前：取消静音固定写 volume=1（音量跳 100%）。
// 修复后：静音前缓存 uiState.volume（>0 才缓存），取消静音恢复缓存值，
// 缓存丢失/为 0 时回 0.7 默认（对齐 defaultUIState.volume）。
// renderToggle 契约：set() 先写 uiState，随后 onChange 运行（测试按此顺序模拟）。
import { describe, it, expect, vi } from 'vitest';
import { uiState } from '../../core/config';
import { setVolume } from '../../core/audio';

const hooks = vi.hoisted(() => ({
    schemas: [] as unknown[][],
}));

vi.mock('../../core/config', () => ({
    uiState: {},
    setUIState: vi.fn(),
    cardContainer: (container: HTMLElement, fn: (c: HTMLElement) => (() => void) | void): (() => void) | void => {
        const card = document.createElement('div');
        card.className = 'lcard';
        container.appendChild(card);
        return fn(card);
    },
}));
vi.mock('../../core/feedback', () => ({ feedbackInfo: vi.fn() }));
vi.mock('../../core/toast', () => ({ showInfoToast: vi.fn() }));
vi.mock('../../core/i18n/t', () => ({ t: (k: string) => k }));
vi.mock('../../core/i18n/goerr', () => ({ translateGoError: (e: unknown) => String(e) }));
vi.mock('../../core/ui-helpers', () => ({
    // slideRow 返回真实元素：settings-media 的 format 卡片会对返回值写 dataset.formatKey
    slideRow: (..._args: unknown[]) => document.createElement('div'),
    addSectionTitle: vi.fn(),
}));
vi.mock('../../menus/menu', () => ({ getCurrentRenderingMenu: vi.fn(() => null) }));
vi.mock('../../core/wails-bindings', () => ({ SelectDir: vi.fn(), OpenScreenshotDir: vi.fn() }));
vi.mock('../../core/audio', () => ({
    setVolume: vi.fn(),
    setAudioOffset: vi.fn(),
    setRepeatMode: vi.fn(),
    getRepeatModeStr: () => 'loop',
}));
vi.mock('../../core/audio-bus', () => ({
    setSfxEnabled: vi.fn(),
    setSfxVolume: vi.fn(),
    setFootstepEnabled: vi.fn(),
    setFootstepVolume: vi.fn(),
}));
vi.mock('../../scene/motion/proc-motion-bridge', () => ({ setBpmQuantizeEnabled: vi.fn() }));
vi.mock('../../menus/settings-shared', () => ({
    setAutoLoadCompanionAudio: vi.fn(),
    truncatePath: (p: string) => p,
}));
vi.mock('../../core/backend', () => ({ getCachedCapabilities: () => ({ systemDirOpen: false }) }));
// renderMenu 假实现：捕获 schema 并就地展开 custom 节点（使 audio-card 回调真实运行）
vi.mock('../../menus/render-menu', () => ({
    renderMenu: (schema: unknown[], container: unknown) => {
        hooks.schemas.push(schema);
        for (const n of schema as { kind?: string; renderCustom?: (c: unknown) => unknown }[]) {
            if (n.kind === 'custom') {
                n.renderCustom?.(container as never);
            }
        }
        return () => {};
    },
}));

interface MuteControl {
    set: (muted: boolean) => number;
    onChange: (muted: boolean) => void;
}
interface MuteNode {
    id?: string;
    control?: MuteControl;
}

/** 构建媒体 level 并展开到 media:mute 节点的 control */
async function getMuteControl(): Promise<MuteControl> {
    const { buildSettingsMediaLevel } = await import('../../menus/settings-media');
    const level = buildSettingsMediaLevel(() => null as never);
    const container = document.createElement('div');
    level.renderCustom?.(container);
    const audioSchema = hooks.schemas.find((s) =>
        (s as MuteNode[]).some((n) => n.id === 'media:mute')
    ) as MuteNode[] | undefined;
    const mute = audioSchema?.find((n) => n.id === 'media:mute');
    if (!mute?.control) {
        throw new Error('media:mute control not found in rendered schema');
    }
    return mute.control;
}

describe('settings-media — media:mute 音量恢复（[audit:fix 2026-10]）', () => {
    it('取消静音恢复静音前音量，不写固定 1', async () => {
        const control = await getMuteControl();
        uiState.volume = 0.4;

        // 静音开：set() 写入 0（渲染契约：set 先写 uiState，再跑 onChange）
        const muted = control.set(true);
        expect(muted).toBe(0);
        uiState.volume = muted;
        control.onChange(true);
        expect(setVolume).toHaveBeenLastCalledWith(0);

        // 取消静音：恢复缓存的 0.4（修复前此处返回 1 → 音量跳 100%）
        const restored = control.set(false);
        expect(restored).toBe(0.4);
        uiState.volume = restored;
        control.onChange(false);
        expect(setVolume).toHaveBeenLastCalledWith(0.4);
    });

    it('静音前音量为 0/无缓存时，取消静音回 0.7 默认', async () => {
        const control = await getMuteControl();
        uiState.volume = 0;
        expect(control.set(true)).toBe(0); // 0 不进缓存
        expect(control.set(false)).toBe(0.7); // 缓存缺失 → 默认
        expect(control.set(false)).toBe(0.7); // 连续取消静音同样回默认
    });
});
