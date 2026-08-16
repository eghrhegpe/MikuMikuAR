// @vitest-environment node
// runtime-mode.test.ts — 运行时模式徽标单测（ADR-099）
// 覆盖 P2#8 防御（persist/load 的 try/catch 降级）+ detectRuntimeMode 探测逻辑 +
// renderRuntimeBadge/setBackendBadge/initRuntimeBadge 渲染与持久化优先。
// mock '../core/dom'（runtimeBadge 可变对象）+ 全局探测源（stubGlobal）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const shared = vi.hoisted(() => {
    const badge = {
        textContent: '',
        style: { color: '' },
        title: '',
    };
    return { badge };
});

vi.mock('../core/dom', () => ({
    dom: { runtimeBadge: shared.badge },
}));

import {
    detectRuntimeMode,
    persistRuntimeMode,
    loadPersistedRuntimeMode,
    renderRuntimeBadge,
    setBackendBadge,
    initRuntimeBadge,
} from '../core/runtime-mode';
import type { RuntimeMode } from '../core/runtime-mode';

const STORAGE_KEY = 'mmcar.runtimeMode.v1';

function stubDetectGlobals(opts: {
    coi?: boolean | undefined;
    sab?: boolean;
    mpr?: boolean;
    hc?: number;
}): void {
    const { sab = true, mpr = true, hc = 8 } = opts;
    const coi = 'coi' in opts ? opts.coi : true;
    vi.stubGlobal('crossOriginIsolated', coi);
    if (sab) {
        vi.stubGlobal('SharedArrayBuffer', class {});
    } else {
        vi.stubGlobal('SharedArrayBuffer', undefined);
    }
    vi.stubGlobal('__MMD_ENABLE_MPR__', mpr);
    vi.stubGlobal('navigator', { hardwareConcurrency: hc });
}

beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    shared.badge.textContent = '';
    shared.badge.style.color = '';
    shared.badge.title = '';
});

afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    // 清掉上一用例残留的 backend 后缀，避免模块级 _backendKind 污染后续用例
    setBackendBadge('');
});

describe('detectRuntimeMode（探测逻辑）', () => {
    it('MPR 全链路开启 → mpr=true + 并行度', () => {
        stubDetectGlobals({ coi: true, sab: true, mpr: true, hc: 8 });
        const m = detectRuntimeMode();
        expect(m.coi).toBe(true);
        expect(m.sab).toBe(true);
        expect(m.mprBuild).toBe(true);
        expect(m.mpr).toBe(true);
        expect(m.threads).toBe(8);
    });

    it('构建要 MPR 但 COI 缺失 → 回退 SPR（mprBuild=true, mpr=false）', () => {
        stubDetectGlobals({ coi: false, sab: true, mpr: true });
        const m = detectRuntimeMode();
        expect(m.mprBuild).toBe(true);
        expect(m.mpr).toBe(false);
    });

    it('SAB 不可用 → mpr=false', () => {
        stubDetectGlobals({ coi: true, sab: false, mpr: true });
        expect(detectRuntimeMode().mpr).toBe(false);
    });

    it('非 MPR 构建 → mpr=false', () => {
        stubDetectGlobals({ coi: true, sab: true, mpr: false });
        expect(detectRuntimeMode().mpr).toBe(false);
    });

    it('navigator 无 hardwareConcurrency → threads=0', () => {
        stubDetectGlobals({ hc: 0 });
        expect(detectRuntimeMode().threads).toBe(0);
    });

    it('navigator 缺失 → threads=0 且不抛错', () => {
        stubDetectGlobals({});
        vi.stubGlobal('navigator', undefined);
        expect(() => detectRuntimeMode()).not.toThrow();
        expect(detectRuntimeMode().threads).toBe(0);
    });

    it('navigator.hardwareConcurrency 读取异常 → threads=0 且不抛错', () => {
        stubDetectGlobals({});
        vi.stubGlobal(
            'navigator',
            new Proxy({}, {
                get() {
                    throw new Error('navigator unavailable');
                },
            }),
        );
        expect(() => detectRuntimeMode()).not.toThrow();
        expect(detectRuntimeMode().threads).toBe(0);
    });

    it('crossOriginIsolated 未定义（undefined）时防御不崩', () => {
        stubDetectGlobals({ coi: undefined });
        // 防御语义：typeof 守卫保证未声明/undefined 时不抛错，且返回完整结构
        expect(() => detectRuntimeMode()).not.toThrow();
        const m = detectRuntimeMode();
        expect(m.coi).toBe(false);
        expect(m.mpr).toBe(false);
        expect(m).toHaveProperty('mprBuild');
    });
});

describe('persistRuntimeMode / loadPersistedRuntimeMode（round-12 P2#8 防御）', () => {
    it('round-trip：持久化后可读回', () => {
        stubDetectGlobals({});
        const mode = detectRuntimeMode();
        persistRuntimeMode(mode);
        expect(loadPersistedRuntimeMode()).toEqual(mode);
    });

    it('无持久化记录 → 返回 null', () => {
        expect(loadPersistedRuntimeMode()).toBeNull();
    });

    it('损坏 JSON → 降级 null 不抛错（P2#8）', () => {
        localStorage.setItem(STORAGE_KEY, '{not-json!!');
        expect(() => loadPersistedRuntimeMode()).not.toThrow();
        expect(loadPersistedRuntimeMode()).toBeNull();
    });

    it('合法 JSON 但结构非法（缺字段/字段类型错）→ 降级 null', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ mprBuild: true, coi: true, sab: true, mpr: true }));
        expect(loadPersistedRuntimeMode()).toBeNull();
    });

    it('合法 JSON 但 mpr 与能力位不一致 → 降级 null', () => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ mprBuild: false, coi: true, sab: true, mpr: true, threads: 4 }),
        );
        expect(loadPersistedRuntimeMode()).toBeNull();
    });

    it('persist 收到非法 mode → 不写入 localStorage', () => {
        persistRuntimeMode({ mprBuild: true, coi: true, sab: true, mpr: false, threads: 4 } as RuntimeMode);
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('localStorage.getItem 抛错 → 降级 null（P2#8）', () => {
        vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
            throw new Error('storage unavailable');
        });
        expect(loadPersistedRuntimeMode()).toBeNull();
    });

    it('localStorage.setItem 抛错 → persist 静默降级（P2#8）', () => {
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });
        stubDetectGlobals({});
        expect(() => persistRuntimeMode(detectRuntimeMode())).not.toThrow();
    });
});

describe('renderRuntimeBadge / setBackendBadge / initRuntimeBadge（渲染与持久化优先）', () => {
    it('MPR 徽标：textContent=⚡MPR ×N + 绿色', () => {
        const mode = { mprBuild: true, coi: true, sab: true, mpr: true, threads: 4 };
        renderRuntimeBadge(mode);
        expect(shared.badge.textContent).toContain('MPR ×4');
        expect(shared.badge.style.color).toContain('rgba(111,207,151');
    });

    it('构建要 MPR 但 COI 缺失 → 琥珀警告', () => {
        renderRuntimeBadge({ mprBuild: true, coi: false, sab: true, mpr: false, threads: 0 });
        expect(shared.badge.textContent).toContain('COI✗');
        expect(shared.badge.style.color).toContain('rgba(240,180,80');
    });

    it('SPR → 灰', () => {
        renderRuntimeBadge({ mprBuild: false, coi: false, sab: false, mpr: false, threads: 0 });
        expect(shared.badge.textContent).toBe('SPR');
        expect(shared.badge.style.color).toContain('rgba(255,255,255');
    });

    it('setBackendBadge 合成 backend 后缀', () => {
        const mode = { mprBuild: false, coi: false, sab: false, mpr: false, threads: 0 };
        renderRuntimeBadge(mode);
        setBackendBadge('go');
        expect(shared.badge.textContent).toBe('SPR · go');
        expect(shared.badge.title).toContain('backend=go');
    });

    it('renderRuntimeBadge 收到非法 mode → 不抛错且不改动徽标', () => {
        shared.badge.textContent = 'SPR';
        shared.badge.style.color = 'rgba(255,255,255,0.35)';
        shared.badge.title = 'old-title';
        renderRuntimeBadge({ mprBuild: true, coi: true, sab: true, mpr: false, threads: 4 } as RuntimeMode);
        expect(shared.badge.textContent).toBe('SPR');
        expect(shared.badge.style.color).toBe('rgba(255,255,255,0.35)');
        expect(shared.badge.title).toBe('old-title');
    });

    it('initRuntimeBadge：持久化结构非法时回退当前检测', () => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ mprBuild: true, coi: true, sab: true, mpr: true }),
        );
        stubDetectGlobals({ hc: 6 });
        initRuntimeBadge();
        expect(shared.badge.textContent).toContain('MPR ×6');
    });

    it('initRuntimeBadge：有持久化时优先渲染持久化值', () => {
        const persisted = { mprBuild: true, coi: true, sab: true, mpr: true, threads: 2 };
        persistRuntimeMode(persisted);
        stubDetectGlobals({ hc: 16 }); // 若误走 detect 会是 16
        initRuntimeBadge();
        expect(shared.badge.textContent).toContain('MPR ×2');
    });

    it('initRuntimeBadge：无持久化时渲染当前检测结果', () => {
        stubDetectGlobals({ coi: true, sab: true, mpr: true, hc: 6 });
        initRuntimeBadge();
        expect(shared.badge.textContent).toContain('MPR ×6');
    });
});
