// @vitest-environment node
// ui-action-bridge.test.ts — [doc:adr-238] UI 行为注入桥 register/unregister 契约
//
// 覆盖 code_review P3 建议：register→get、unregister→get-undefined、
// 覆盖后 unregister 不误删新注册、重复 unregister 安全；
// 另补 token 幂等、未注册 key 幂等、getUiActions 兼容层返回普通对象视图。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    registerUiAction,
    unregisterUiAction,
    getUiAction,
    getUiActions,
} from '@/core/ui-action-bridge';
import type { UiActions } from '@/core/ui-action-bridge';

// 本测试会操作模块级全局 Map；beforeEach/afterEach 都清掉用到的键，避免污染其他用例/文件。
// register/unregister 契约用测试专用键，避免误删生产模块可能已注册的 getMotionMenu。
const TEST_KEY = '__test_only_ui_action__' as unknown as keyof UiActions;
const CLEANUP_KEYS = [TEST_KEY, 'closeAllOverlays', 'screenshotCurrent'] as const;

describe('ui-action-bridge register/unregister 契约', () => {
    const KEY = TEST_KEY;

    beforeEach(() => {
        for (const key of CLEANUP_KEYS) {
            unregisterUiAction(key);
        }
    });

    afterEach(() => {
        for (const key of CLEANUP_KEYS) {
            unregisterUiAction(key);
        }
    });

    it('register → get 返回注册的 fn，且返回注销 token', () => {
        const fn = () => 'a';
        const unregister = registerUiAction(KEY, fn);
        expect(unregister).toBeTypeOf('function');
        expect(getUiAction(KEY)).toBe(fn);
    });

    it('unregister → get 返回 undefined（缺失时返回 undefined 契约）', () => {
        registerUiAction(KEY, (() => 'a'));
        unregisterUiAction(KEY);
        expect(getUiAction(KEY)).toBeUndefined();
    });

    it('覆盖后旧 token 注销不误删新注册（identity-based）', () => {
        const oldFn = () => 'old';
        const newFn = () => 'new';
        const unregisterOld = registerUiAction(KEY, oldFn);
        registerUiAction(KEY, newFn); // 覆盖
        unregisterOld(); // 旧 token 注销——不得删掉新注册
        expect(getUiAction(KEY)).toBe(newFn);
    });

    it('当前注册的 token 注销生效（新注册后 token 可删）', () => {
        const fn = () => 'a';
        const unregister = registerUiAction(KEY, fn);
        unregister();
        expect(getUiAction(KEY)).toBeUndefined();
    });

    it('重复 unregister 安全（幂等）', () => {
        registerUiAction(KEY, (() => 'a'));
        unregisterUiAction(KEY);
        unregisterUiAction(KEY); // 不抛错
        expect(getUiAction(KEY)).toBeUndefined();
    });

    it('register 返回的 token 重复调用安全（幂等）', () => {
        const fn = () => 'a';
        const unregister = registerUiAction(KEY, fn);
        unregister();
        expect(() => unregister()).not.toThrow();
        expect(getUiAction(KEY)).toBeUndefined();
    });

    it('unregister 未注册 key 安全（未知 key 幂等）', () => {
        expect(() => unregisterUiAction(KEY)).not.toThrow();
        expect(getUiAction(KEY)).toBeUndefined();
    });

    it('unregister 后重新 register 可恢复', () => {
        registerUiAction(KEY, (() => 'a'));
        unregisterUiAction(KEY);
        const fn2 = () => 'b';
        registerUiAction(KEY, fn2);
        expect(getUiAction(KEY)).toBe(fn2);
    });

    it('getUiActions 任一必需 key 未注册时返回 null', () => {
        registerUiAction('closeAllOverlays', () => {});
        expect(getUiActions()).toBeNull();
    });

    it('getUiActions 两必需 key 均注册时返回普通对象视图（非 Map）', () => {
        const close = () => {};
        const shot = () => {};
        registerUiAction('closeAllOverlays', close);
        registerUiAction('screenshotCurrent', shot);

        const actions = getUiActions();
        expect(actions).not.toBeNull();
        expect(actions).not.toBeInstanceOf(Map);
        expect(actions).toHaveProperty('closeAllOverlays', close);
        expect(actions).toHaveProperty('screenshotCurrent', shot);
        actions!.closeAllOverlays();
        actions!.screenshotCurrent();
    });
});
