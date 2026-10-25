// menu/settings-actions.test.ts — [audit:fix 2026-10] P2① 注册竞态回归测试
// _ensureSettingsActions 保存进行中的动态 import 为 pending Promise：
//   - import 成功 → _settingsRegistered 置位（latch），后续点击不再 import；
//   - import 失败 → 复位 flag + logWarn，下一次点击可重试。
// 修复前：fire-and-forget import 后立即置 flag——首点击先于注册落地静默失败，
// 且 import reject 时 flag 永久 true，后续所有点击都静默失败。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PopupRow } from '../../core/config';

const state = vi.hoisted(() => ({
    imports: 0,
    throwNextImport: false,
    logWarns: [] as unknown[][],
}));

vi.mock('../../core/action-defs/settings-actions', () => ({
    registerSettingsActions: () => {
        state.imports += 1;
        if (state.throwNextImport) {
            state.throwNextImport = false;
            throw new Error('registerSettingsActions boom');
        }
    },
}));
vi.mock('../../core/action-executor', () => ({
    executeActionById: vi.fn(),
}));
vi.mock('../../core/logger', () => ({
    logWarn: (tag: string, message: string, err?: unknown) => {
        state.logWarns.push([tag, message, err]);
    },
}));
vi.mock('../../menus/settings-language', () => ({
    buildSettingsLanguageLevel: vi.fn(() => ({ label: 'lang', dir: '', items: [] })),
}));

const click = (mod: { handleSettingsAction: (row: PopupRow) => void }) =>
    mod.handleSettingsAction({ target: 'theme' } as unknown as PopupRow);

describe('settings-actions — _ensureSettingsActions 注册竞态（[audit:fix 2026-10]）', () => {
    beforeEach(() => {
        vi.resetModules();
        state.logWarns.length = 0;
        state.throwNextImport = false;
    });

    it('import 失败：复位 flag + logWarn，第二次点击重试成功，成功后 latch', async () => {
        state.throwNextImport = true;
        const mod = await import('../../menus/settings-actions');

        click(mod); // 首点击：触发 import（即将被 reject）
        await vi.waitFor(() => expect(state.imports).toBe(1));
        expect(state.logWarns.length).toBe(1); // 失败 → logWarn
        expect(state.logWarns[0][0]).toBe('settings-actions');

        click(mod); // flag 已复位 → 触发重试
        await vi.waitFor(() => expect(state.imports).toBe(2));
        expect(state.logWarns.length).toBe(1); // 第二次成功，无新告警

        click(mod);
        click(mod); // flag 已 latch：不再 import
        await Promise.resolve();
        await Promise.resolve();
        expect(state.imports).toBe(2);

        const { executeActionById } = await import('../../core/action-executor');
        expect(executeActionById).toHaveBeenCalledTimes(4);
        expect(executeActionById).toHaveBeenCalledWith('settings:theme', {});
    });

    it('import 成功：flag latch，重复点击不重复 import', async () => {
        const mod = await import('../../menus/settings-actions');
        const before = state.imports; // 计数跨用例累计（state 不随 resetModules 清零）

        click(mod);
        await vi.waitFor(() => expect(state.imports).toBe(before + 1));

        click(mod);
        click(mod);
        await Promise.resolve();
        await Promise.resolve();
        expect(state.imports).toBe(before + 1);
        expect(state.logWarns.length).toBe(0);
    });
});
