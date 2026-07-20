// plaza.contract.test.ts — 导出函数存在性 + 签名契约
//
// 验证 showPlaza / closePlaza 签名不变（不执行内部逻辑）。
// 注意：不 vi.mock 整个模块——plaza-browser / plaza-state 无 Babylon 强依赖，
// vitest 能正常导入。
//
// 如果将来 plaza-browser 引入了 vitest 无法解析的依赖，再加 vi.mock 做局部打桩。

import { describe, it, expect } from 'vitest';
import { showPlaza } from '../menus/plaza-browser';
import { closePlaza } from '../menus/plaza-state';

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