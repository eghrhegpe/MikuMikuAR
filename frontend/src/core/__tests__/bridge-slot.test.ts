// @vitest-environment node
// bridge-slot.test.ts — 通用注入桥原语的不变量测试 [doc:adr-265]
//
// 这些断言是从 scene-action-bridge.test.ts / ui-action-bridge.test.ts 的手写桥契约
// 提炼上来的：原语必须先自证，三座桥才敢站在它肩上。
// 重点：identity-based token（覆盖后旧 token 不误删）、token 幂等、缺失一次性告警、
// 告警格式 '[label] 'key' 未注册——调用将静默跳过'（存量日志引用不断链）。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createActionBridge, createSlot } from '../bridge-slot';

interface TestActions {
    foo: () => string;
    bar: (n: number) => number;
    unused: () => void;
}

describe('createActionBridge — 多键动作桥', () => {
    it('register 返回 token，get 命中注册 fn', () => {
        const bridge = createActionBridge<TestActions>('t-bridge');
        const fn = () => 'a';
        const unregister = bridge.register('foo', fn);
        expect(typeof unregister).toBe('function');
        expect(bridge.get('foo')).toBe(fn);
        unregister();
    });

    it('覆盖注册后旧 token 注销不误删新注册（identity-based，code_review P2 契约）', () => {
        const bridge = createActionBridge<TestActions>('t-bridge');
        const oldFn = () => 'old';
        const newFn = () => 'new';
        const unregisterOld = bridge.register('foo', oldFn);
        bridge.register('foo', newFn);
        unregisterOld();
        expect(bridge.get('foo')).toBe(newFn);
    });

    it('token 幂等：重复调用安全', () => {
        const bridge = createActionBridge<TestActions>('t-bridge');
        const unregister = bridge.register('foo', () => 'a');
        unregister();
        unregister(); // 第二次：map.get(key) !== fn，不得抛错
        expect(bridge.get('foo')).toBeUndefined();
    });

    it('缺失注册：一次性告警且格式锁定，二次读取不再告警', () => {
        const bridge = createActionBridge<TestActions>('t-label');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(bridge.get('bar')).toBeUndefined();
        expect(bridge.get('bar')).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toBe(`[t-label] 'bar' 未注册——调用将静默跳过`);
        warn.mockRestore();
    });

    it('unregister 未知 key 幂等；has/snapshot 语义', () => {
        const bridge = createActionBridge<TestActions>('t-bridge');
        bridge.unregister('unused'); // 未知 key 安全（ui-action-bridge 存量契约）
        const fn = () => 'x';
        const token = bridge.register('foo', fn);
        expect(bridge.has('foo')).toBe(true);
        expect(bridge.has('bar')).toBe(false);
        expect(bridge.snapshot()).toEqual({ foo: fn });
        token();
        expect(bridge.snapshot()).toEqual({});
    });

    it('snapshot 每次返回新对象（锁定迁移前 Object.fromEntries 语义，评审折衷项）', () => {
        const bridge = createActionBridge<TestActions>('t-bridge');
        const fn = () => 'x';
        bridge.register('foo', fn);
        const a = bridge.snapshot();
        const b = bridge.snapshot();
        expect(a).not.toBe(b); // 禁止未来"优化"成共享引用——旧 ui-action-bridge.ts:106 本就这样
        expect(a).toEqual(b);
        (a as Record<string, unknown>).injected = 1; // 改快照不污染桥
        expect(bridge.has('foo' as never) && Object.keys(bridge.snapshot()).length).toBe(1);
    });

    it('warnOnce 是 per-instance：register→unregister→再 get 不重复告警（已知折衷，ADR-265）', () => {
        const bridge = createActionBridge<TestActions>('t-bridge');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(bridge.get('unused')).toBeUndefined(); // 第一次告警
        const token = bridge.register('unused', () => undefined);
        token(); // 注销后 warned 集合不清除（旧手写桥同语义）
        expect(bridge.get('unused')).toBeUndefined(); // 不再告警——刻意为之，非 bug
        expect(warn).toHaveBeenCalledTimes(1);
        // 新实例（HMR 双模块形状）自带新的 warned 集合：
        const hmr = createActionBridge<TestActions>('t-bridge');
        expect(hmr.get('unused')).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });
});

interface TestReader {
    (path: string): unknown;
}

describe('createSlot — 单槽注入点', () => {
    it('set/get/reset 基本语义', () => {
        const slot = createSlot<TestReader>();
        expect(slot.get()).toBeNull();
        const reader = (p: string) => p;
        slot.set(reader);
        expect(slot.get()).toBe(reader);
        slot.reset();
        expect(slot.get()).toBeNull();
    });

    it('覆盖后旧 token 只删自己（与动作桥对称的 identity 契约）', () => {
        const slot = createSlot<TestReader>();
        const first = (p: string) => p;
        const second = (p: string) => p + '!';
        const unregisterFirst = slot.set(first);
        slot.set(second);
        unregisterFirst();
        expect(slot.get()).toBe(second);
    });
});
