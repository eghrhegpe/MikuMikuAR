// [doc:adr-117] translateGoError 单测 —— 验证 Wails 跨桥后（error stringify 成纯文本）
// 前端仍能从哨兵信封提取 code/params 并翻译。
import { describe, it, expect, afterEach } from 'vitest';
import { translateGoError } from '../core/i18n/goerr';
import { setLang } from '../core/i18n/locale';

// node 环境下补齐 RAF：locale.setLang → scheduleRefresh → requestAnimationFrame。
// localStorage/document 在 locale.ts 中已有 try/catch 守卫，无需补齐。
if (typeof globalThis.requestAnimationFrame !== 'function') {
    globalThis.requestAnimationFrame = ((cb: (t: number) => void) =>
        setTimeout(() => cb(0), 0)
    ) as unknown as typeof globalThis.requestAnimationFrame;
}

// 模拟 Wails 跨桥后交付给前端的 Error：
// "Binding call failed: failed to call binding: <msg>\n@@GOERR@@<json信封>"
function wailsErr(code: string, params: Record<string, string>, msg: string): Error {
    const envelope = JSON.stringify({ code, params, msg });
    return new Error(`Binding call failed: failed to call binding: ${msg}\n@@GOERR@@${envelope}`);
}

describe('translateGoError [doc:adr-117]', () => {
    afterEach(() => {
        setLang('zh-CN');
    });

    it('translates software.notFound with {name} under zh-CN', () => {
        setLang('zh-CN');
        const out = translateGoError(
            wailsErr('software.notFound', { name: 'Blender' }, '未找到 Blender，请在设置中配置路径')
        );
        expect(out).toBe('未找到 Blender，请在设置中配置路径');
    });

    it('translates to English after setLang(en)', () => {
        setLang('en');
        const out = translateGoError(
            wailsErr('software.notFound', { name: 'Blender' }, '未找到 Blender，请在设置中配置路径')
        );
        expect(out).toBe('Could not find Blender. Please set its path in Settings.');
    });

    it('uses {name} param in English launch error', () => {
        setLang('en');
        const out = translateGoError(
            wailsErr('software.launchFailed', { name: 'MikuMikuDance' }, '启动 MikuMikuDance 失败')
        );
        expect(out).toBe('Failed to launch MikuMikuDance.');
    });

    it('falls back to embedded Chinese msg when code is unknown', () => {
        setLang('en');
        const out = translateGoError(wailsErr('software.totallyUnknown', {}, '某个未知错误'));
        expect(out).toBe('某个未知错误');
    });

    it('passes through legacy plain-text errors unchanged', () => {
        const out = translateGoError(new Error('Blender 启动失败（旧式）'));
        expect(out).toBe('Blender 启动失败（旧式）');
    });

    it('handles raw string inputs', () => {
        expect(translateGoError('纯字符串错误')).toBe('纯字符串错误');
    });
});
