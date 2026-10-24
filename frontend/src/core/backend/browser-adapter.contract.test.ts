// @vitest-environment node
// browser-adapter.contract.test.ts — 网页端适配器的契约行为护栏（ADR-277 风险 5）
//
// 背景：browser-adapter.ts 曾以 `as unknown as BackendService` 收尾。双重断言同时废掉了
// this 的类型、多余属性检查与「缺方法」检查 —— 8 个 AI 后端方法根本没实现也没人发现，
// 6 处签名与契约不符（预设列表只回裸名、CleanOrphanCache 返回 void…）同样无人报警。
// 本文件锁三件事：
//   1. 完整性：Go 绑定的每个契约方法（扣掉 EXCLUDED_FROM_BACKEND）网页端都有实现；
//   2. 形状：ADR-277 逐项对齐后的返回形状（预设条目 / 构建信息 / A11y 默认值 / 清理计数）；
//   3. 降级：网页端做不到的能力必须显式抛 NotSupportedError，而不是 "xxx is not a function"。
//
// 与 bindings/app.contract.test.ts 分工：那边锁 Go 侧生成绑定的导出与 method ID，
// 这边锁网页端实现是否跟得上那份契约。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mem, setStore, resetMem } from './browser-adapter-mocks';

// 与 browser-adapter.plaza-config.test.ts 同款的 idb 内存替身（browser-adapter 是单例，
// 文件级 vi.mock 才能把它的 idb 依赖整体替换掉）。
vi.mock('./idb', () => ({
    idbGet: async (store: string, key: string) => mem.get(store)?.get(key) ?? undefined,
    idbSet: async (store: string, key: string, value: unknown) => {
        if (!mem.has(store)) {
            mem.set(store, new Map());
        }
        mem.get(store)!.set(key, value);
    },
    idbKeys: async (store: string) => [...(mem.get(store)?.keys() ?? [])],
    idbDelete: async (store: string, key: string) => {
        mem.get(store)?.delete(key);
    },
    idbBatchSet: async (store: string, entries: [string, unknown][]) => {
        if (!mem.has(store)) {
            mem.set(store, new Map());
        }
        for (const [k, v] of entries) {
            mem.get(store)!.set(k, v);
        }
    },
    openDB: async () => ({}) as unknown,
    closeIDB: () => {},
}));

import * as appBinding from '../../../bindings/mikumikuar/internal/app/app';
import { browserAdapter } from './browser-adapter';
import { EXCLUDED_FROM_BACKEND, NotSupportedError } from './types';

// 契约方法全集 = Go 绑定导出的函数 − 排除清单。GetConfig 不在排除清单里，
// 所以它也必须存在（网页端实现非空，Go 侧由 go-adapter 用 assertConfig 收窄）。
const EXCLUDED = new Set<string>(EXCLUDED_FROM_BACKEND);
const CONTRACT_KEYS = Object.keys(appBinding).filter(
    (k) =>
        typeof (appBinding as unknown as Record<string, unknown>)[k] === 'function' &&
        !EXCLUDED.has(k)
);

/** 网页端不支持的 AI 后端（Go 独占）。它们的实现形态就是 NotSupportedError 桩。 */
const AI_STUBS = [
    'AiCancelStream',
    'AiFetchModels',
    'AiGetBackendLogs',
    'AiGetBackendState',
    'AiGetLLMConfig',
    'AiSetLLMConfig',
    'AiStreamChat',
    'AiTestLLMConnection',
] as const;

describe('browserAdapter — 契约完整性（ADR-277）', () => {
    it('清单本身不是空的（防止 Object.keys 全是类型导出导致测试假绿）', () => {
        expect(CONTRACT_KEYS.length).toBeGreaterThan(100);
        expect(CONTRACT_KEYS).toContain('GetConfig');
        expect(CONTRACT_KEYS).not.toContain('ReadFileBytes');
        // AI 方法属契约面：删掉某个桩，下面那条「每个契约方法都有实现」会立刻变红。
        expect(CONTRACT_KEYS).toContain('AiStreamChat');
    });

    it('Go 绑定的每个契约方法在网页端都有实现', () => {
        const adapter = browserAdapter as unknown as Record<string, unknown>;
        const missing = CONTRACT_KEYS.filter((k) => typeof adapter[k] !== 'function');

        expect(missing).toEqual([]);
    });

    it('8 个 AI 后端方法显式降级为 NotSupportedError（不是 undefined）', async () => {
        // 双重断言时代的真实故障形态是 "browserAdapter.AiStreamChat is not a function"，
        // 所以这里既查「存在」，也查「调用后的错误类型」。
        const adapter = browserAdapter as unknown as Record<string, () => Promise<unknown>>;
        for (const name of AI_STUBS) {
            expect(typeof adapter[name]).toBe('function');
            const err = await adapter[name]().catch((e: unknown) => e);
            expect(err, name).toBeInstanceOf(NotSupportedError);
            expect((err as Error).message).toContain(name);
        }
    });

    it('kind 与 capabilities 是网页端语义', () => {
        expect(browserAdapter.kind).toBe('browser');

        // capabilities() 读 window（FSA 探测）。node 环境没有 window，按 ADR-219 的测试卫生
        // 铁律：先捕获真实值，用完在 finally 里还原，绝不裸改/裸删全局。
        const holder = globalThis as { window?: unknown };
        const realWindow = holder.window;
        holder.window = {};
        try {
            const caps = browserAdapter.capabilities();
            expect(caps.fsSelectDir).toBe(false); // 无 showOpenFilePicker/showDirectoryPicker
            expect(caps.installApk).toBe(false); // 网页侧固定能力
            expect(caps.localStaging).toBe(false);
        } finally {
            if (realWindow === undefined) {
                delete holder.window;
            } else {
                holder.window = realWindow;
            }
        }
    });
});

describe('browserAdapter — 返回形状与契约对齐（ADR-277 影响表）', () => {
    beforeEach(() => resetMem());

    it('ReadTextFile 读不到时返回空串而非 null（契约是 Promise<string>）', async () => {
        expect(await browserAdapter.ReadTextFile('not-exist.txt')).toBe('');
    });

    it('GetModelPresets 返回条目而非裸名（preset-meta 读 m.name / m.updatedAt）', async () => {
        setStore('presets', { 'model:alpha': '{}', 'model:beta': '{}', 'env:gamma': '{}' });

        const list = (await browserAdapter.GetModelPresets()) ?? [];

        expect(list.map((p) => p.name).sort()).toEqual(['alpha', 'beta']);
        expect(list[0]).toMatchObject({
            presetName: expect.any(String),
            modelName: expect.any(String),
            modelRef: expect.any(String),
            updatedAt: expect.any(Number),
            autoApply: expect.any(Boolean),
        });
    });

    it('ListEnvPresets 返回条目而非裸名（preset-meta 读 e.name / e.label / e.createdAt）', async () => {
        setStore('presets', { 'env:gamma': '{}', 'model:alpha': '{}' });

        const list = (await browserAdapter.ListEnvPresets()) ?? [];

        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({
            name: 'gamma',
            label: 'gamma',
            category: expect.any(String),
            createdAt: expect.any(Number),
        });
    });

    it('CleanOrphanCache 返回清理条数（契约是 Promise<number>）', async () => {
        // 值为 undefined 的条目 = 孤儿缓存（browser-adapter 的判据）。
        setStore('caches', { dead1: undefined, dead2: undefined, alive: '{"v":1}' });

        const removed = await browserAdapter.CleanOrphanCache();

        expect(removed).toBe(2);
        expect([...(mem.get('caches')?.keys() ?? [])]).toEqual(['alive']);
    });

    it('GetSystemA11ySettings 缺省返回两个必填布尔，而不是空对象', async () => {
        const a11y = await browserAdapter.GetSystemA11ySettings();

        expect(a11y).toEqual({ isDarkMode: false, isHighContrast: false });
    });

    it('GetBuildInfo 字段名对齐 BuildInfo（version/buildTime/commitHash/goVersion）', async () => {
        // 契约里 GetBuildInfo 可空（Go 侧指针），网页端恒非空——这里同时锁住「非空」这一实现承诺。
        const info = await browserAdapter.GetBuildInfo();
        expect(info).not.toBeNull();

        expect(info as NonNullable<typeof info>).toMatchObject({
            version: 'web',
            commitHash: 'web',
            goVersion: '',
        });
        expect(Number.isNaN(Date.parse((info as NonNullable<typeof info>).buildTime))).toBe(false);
    });

    it('GetModelMetaBatch 接受 null 参数（Go 侧切片可为 nil）并返回空表', async () => {
        expect(await browserAdapter.GetModelMetaBatch(null)).toEqual({});
    });
});
