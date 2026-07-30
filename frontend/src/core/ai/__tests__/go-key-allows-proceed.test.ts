// [doc:adr-196] go-key-allows-proceed 守护测试：Go 桌面端 key 不可回读时的验证放行逻辑。
// 纯函数，零依赖。

import { describe, it, expect } from 'vitest';
import { goKeyAllowsProceed } from '../go-key-allows-proceed';
import type { AiValidationResult } from '../types';

/** 创建带 errors 的 validation 结果。 */
function validation(
    ok: boolean,
    errors: { kind: string; message: string }[]
): ReturnType<typeof goKeyAllowsProceed extends (v: infer V, ...a: unknown[]) => unknown ? V : never> {
    // 用 as any 绕过类型，只关心运行时行为
    return { ok, errors } as unknown as AiValidationResult;
}

describe('goKeyAllowsProceed', () => {
    it('ok 验证直接放行（不论 isGo/keyConfigured）', () => {
        expect(goKeyAllowsProceed({ ok: true, message: 'ok' }, false, false)).toBe(true);
        expect(goKeyAllowsProceed({ ok: true, message: 'ok' }, true, false)).toBe(true);
        expect(goKeyAllowsProceed({ ok: true, message: 'ok' }, false, true)).toBe(true);
    });

    it('Go 模式 + key 已配置 + 仅 missingKey 错误 → 放行', () => {
        const r = goKeyAllowsProceed(
            {
                ok: false,
                kind: 'missingKey',
                message: 'API key 未配置',
                errors: [{ kind: 'missingKey', message: 'API key 未配置' }],
            },
            true,  // isGo
            true   // keyConfigured
        );
        expect(r).toBe(true);
    });

    it('Go 模式 + key 已配置 + missingKey + 其他错误 → 不放行', () => {
        const r = goKeyAllowsProceed(
            {
                ok: false,
                kind: 'missingModel',
                message: '模型未选择',
                errors: [
                    { kind: 'missingKey', message: 'API key 未配置' },
                    { kind: 'missingModel', message: '模型未选择' },
                ],
            },
            true,  // isGo
            true   // keyConfigured
        );
        expect(r).toBe(false);
    });

    it('浏览器模式 + missingKey 错误 → 不放行（key 仍需前端提供）', () => {
        const r = goKeyAllowsProceed(
            {
                ok: false,
                kind: 'missingKey',
                message: 'API key 未配置',
                errors: [{ kind: 'missingKey', message: 'API key 未配置' }],
            },
            false, // isGo
            true   // keyConfigured
        );
        expect(r).toBe(false);
    });

    it('Go 模式 + key 未配置 + missingKey 错误 → 不放行', () => {
        const r = goKeyAllowsProceed(
            {
                ok: false,
                kind: 'missingKey',
                message: 'API key 未配置',
                errors: [{ kind: 'missingKey', message: 'API key 未配置' }],
            },
            true,  // isGo
            false  // keyConfigured
        );
        expect(r).toBe(false);
    });

    it('Go 模式 + key 已配置 + 无 errors 数组（undefined）→ 放行（无额外错误）', () => {
        const r = goKeyAllowsProceed(
            { ok: false, kind: 'missingKey', message: 'x' },
            true,
            true
        );
        // errors undefined → ?? [] 得空数组 → nonKey.length === 0 → true
        expect(r).toBe(true);
    });
});