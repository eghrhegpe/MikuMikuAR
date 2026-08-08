// scene-action-bridge.test.ts — registerSceneAction 返回的 identity-based 注销 token
//
// 覆盖 fix P2 变更：registerSceneAction 现在返回基于 fn 引用的注销 token，
// dispose 时只删除本实例注册的闭包，不会误删后续替换模块的注册。

import { describe, it, expect, beforeEach } from 'vitest';
import {
    registerSceneAction,
    getSceneAction,
} from '../core/scene-action-bridge';

// 用未参与生产的键，避免污染全局 Map（桥是模块级 Map）
type TestKey = 'getMotionMenu';

describe('scene-action-bridge registerSceneAction 注销 token', () => {
    const KEY = 'getMotionMenu' as TestKey;

    beforeEach(() => {
        // 清场：直接删掉测试键
        getSceneAction(KEY as never);
        // getSceneAction 不会反向删除，故用 register 返回的 token 清理
    });

    it('register 返回 token，且 getSceneAction 返回注册 fn', () => {
        const fn = () => 'a';
        const unregister = registerSceneAction(KEY as never, fn as never);
        expect(typeof unregister).toBe('function');
        expect(getSceneAction(KEY as never)).toBe(fn);
        unregister(); // 清理
    });

    it('token() 删除本注册 → getSceneAction 返回 undefined', () => {
        const fn = () => 'a';
        const unregister = registerSceneAction(KEY as never, fn as never);
        expect(getSceneAction(KEY as never)).toBe(fn);
        unregister();
        expect(getSceneAction(KEY as never)).toBeUndefined();
    });

    it('覆盖后旧 token 注销不误删新注册（identity-based）', () => {
        const oldFn = () => 'old';
        const newFn = () => 'new';
        const unregisterOld = registerSceneAction(KEY as never, oldFn as never);
        registerSceneAction(KEY as never, newFn as never); // 覆盖
        unregisterOld(); // 旧 token 注销——不得删掉新注册
        expect(getSceneAction(KEY as never)).toBe(newFn);
        // 清理新注册
        const unregisterNew = registerSceneAction(KEY as never, newFn as never);
        unregisterNew();
    });

    it('token() 幂等：重复调用安全', () => {
        const fn = () => 'a';
        const unregister = registerSceneAction(KEY as never, fn as never);
        unregister();
        unregister(); // 第二次：此时 _sceneActions.get(key) !== fn，不应抛错
        expect(getSceneAction(KEY as never)).toBeUndefined();
    });
});
