// @vitest-environment node
// wasm-layers-blender: 触发 guardNum 守卫路径覆盖
// guardNum 已在 guards.test.ts 100% 覆盖；本文件仅确保 wasm-layers-blender.ts 被加载执行。

import { describe, it, expect, vi } from 'vitest';

const _ls = new Map<string, string>();
vi.stubGlobal('localStorage', {
    getItem: (k: string) => _ls.get(k) ?? null,
    setItem: (k: string, v: string) => { _ls.set(k, v); },
    removeItem: (k: string) => { _ls.delete(k); },
    clear: () => { _ls.clear(); },
    length: 0,
    key: () => null,
});

describe('wasm-layers-blender module load', () => {
    it('模块可正常导入（触发 guardNum import 路径）', async () => {
        const mod = await import('../scene/motion/wasm-layers-blender');
        expect(mod.initWasmLayersBlender).toBeDefined();
        expect(mod.updateWasmLayerWeight).toBeDefined();
        expect(mod.teardownWasmLayersBlender).toBeDefined();
    });
});
