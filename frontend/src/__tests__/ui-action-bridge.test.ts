// ui-action-bridge.test.ts — [doc:adr-238] UI 行为注入桥 register/unregister 契约
//
// 覆盖 code_review P3 建议：register→get、unregister→get-undefined、
// 覆盖后 unregister 不误删新注册、重复 unregister 安全。

import { describe, it, expect, beforeEach } from 'vitest';
import { registerUiAction, unregisterUiAction, getUiAction } from '@/core/ui-action-bridge';

// UiActions 的键（取一个测试用键；桥是全局 Map，用未参与生产的键避免污染）
type TestKey = 'getMotionMenu';

describe('ui-action-bridge register/unregister 契约', () => {
    const KEY = 'getMotionMenu' as TestKey;

    beforeEach(() => {
        unregisterUiAction(KEY as never);
    });

    it('register → get 返回注册的 fn', () => {
        const fn = () => 'a';
        registerUiAction(KEY as never, fn as never);
        expect(getUiAction(KEY as never)).toBe(fn);
    });

    it('unregister → get 返回 undefined（静默跳过契约）', () => {
        registerUiAction(KEY as never, (() => 'a') as never);
        unregisterUiAction(KEY as never);
        expect(getUiAction(KEY as never)).toBeUndefined();
    });

    it('覆盖后旧 token 注销不误删新注册（identity-based）', () => {
        const oldFn = () => 'old';
        const newFn = () => 'new';
        const unregisterOld = registerUiAction(KEY as never, oldFn as never);
        registerUiAction(KEY as never, newFn as never); // 覆盖
        unregisterOld(); // 旧 token 注销——不得删掉新注册
        expect(getUiAction(KEY as never)).toBe(newFn);
    });

    it('当前注册的 token 注销生效（新注册后 token 可删）', () => {
        const fn = () => 'a';
        const unregister = registerUiAction(KEY as never, fn as never);
        unregister();
        expect(getUiAction(KEY as never)).toBeUndefined();
    });

    it('重复 unregister 安全（幂等）', () => {
        registerUiAction(KEY as never, (() => 'a') as never);
        unregisterUiAction(KEY as never);
        unregisterUiAction(KEY as never); // 不抛错
        expect(getUiAction(KEY as never)).toBeUndefined();
    });

    it('unregister 后重新 register 可恢复', () => {
        registerUiAction(KEY as never, (() => 'a') as never);
        unregisterUiAction(KEY as never);
        const fn2 = () => 'b';
        registerUiAction(KEY as never, fn2 as never);
        expect(getUiAction(KEY as never)).toBe(fn2);
    });
});
