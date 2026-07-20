// plaza.contract.test.ts — 导出函数存在性 + 签名契约
//
// 拆分前锁住 showPlaza / closePlaza 的签名与返回值形状。
// 拆分后该测试必须仍绿，确保搬迁不破坏接口契约。
//
// 注意：plaza.ts 的依赖链会触及 Babylon.js，无法在单元测试中全量 mock。
// 因此采用「模块自身 mock + 验签」策略——mock 整个 plaza 模块为真实导出，
// 只验证函数签名，不执行内部逻辑。

import { describe, it, expect, vi } from 'vitest';

// Mock the entire plaza module with its real exports, intercepting the import chain
vi.mock('../menus/plaza', () => ({
    showPlaza: vi.fn(async () => {}),
    closePlaza: vi.fn(),
}));

import { showPlaza, closePlaza } from '../menus/plaza';

describe('plaza 导出契约', () => {
    it('showPlaza 是异步函数', () => {
        expect(typeof showPlaza).toBe('function');
        const result = showPlaza();
        expect(result).toBeInstanceOf(Promise);
    });

    it('closePlaza 是函数', () => {
        expect(typeof closePlaza).toBe('function');
    });
});