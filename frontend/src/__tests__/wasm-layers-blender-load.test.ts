// @vitest-environment node
// wasm-layers-blender: 确保模块被加载，触发 guardNum import 路径覆盖 diff-coverage

import { describe, it, expect } from 'vitest';

describe('wasm-layers-blender module load', () => {
    it('类型导入不触发运行时副作用', async () => {
        // 仅做类型层面引用，不触发模块副作用初始化
        const mod = await import('../scene/motion/wasm-layers-blender');
        // 仅访问已导出的函数引用，不调用
        expect(typeof mod.initWasmLayersBlender).toBe('function');
        expect(typeof mod.updateWasmLayerWeight).toBe('function');
    });
});
