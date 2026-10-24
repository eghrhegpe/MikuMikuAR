// @vitest-environment node
// [doc:adr-155][doc:adr-197] intent-dispatcher 守护测试：LLM 文本三级容错解析。
// 纯函数测试解析逻辑，不依赖 action-executor（mock 避免场景模块加载）。

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../action-executor', () => ({
    executeActionById: vi.fn(async () => ({ success: true })),
}));

import { parseActionFromLLM, executeAction } from '../intent-dispatcher';
import { executeActionById } from '../../action-executor';

describe('parseActionFromLLM', () => {
    // ── Priority 1: 全文合法 JSON ──

    it('P1: 全文合法 JSON 直接解析', () => {
        const r = parseActionFromLLM(
            JSON.stringify({ action: 'setCameraMode', params: { mode: 'orbit' } })
        );
        expect(r).not.toBeNull();
        expect(r!.action).toBe('ai:control:setCameraMode');
        expect(r!.params).toEqual({ mode: 'orbit' });
    });

    it('P1: 带命名空间前缀的 action 保留原样', () => {
        const r = parseActionFromLLM(
            JSON.stringify({
                action: 'ai:control:setLightIntensity',
                params: { dirIntensity: 0.5 },
            })
        );
        expect(r!.action).toBe('ai:control:setLightIntensity');
    });

    it('P1: 缺少 action 字段返回 null', () => {
        const r = parseActionFromLLM(JSON.stringify({ foo: 'bar' }));
        expect(r).toBeNull();
    });

    // ── Priority 2: ```json 代码块 ──

    it('P2: 从 ```json 代码块提取', () => {
        const r = parseActionFromLLM(
            '我需要调整灯光\n```json\n{"action": "setLightIntensity", "params": {"dirIntensity": 0.8}}\n```\n这样如何？'
        );
        expect(r).not.toBeNull();
        expect(r!.action).toBe('ai:control:setLightIntensity');
        expect(r!.params).toEqual({ dirIntensity: 0.8 });
    });

    it('P2: 从 ``` 代码块（无 json 标记）提取', () => {
        const r = parseActionFromLLM('```\n{"action": "toggleGround", "params": {}}\n```');
        expect(r).not.toBeNull();
        expect(r!.action).toBe('ai:control:toggleGround');
    });

    // ── Priority 3: 括号平衡提取回退 ──
    // [audit P3] 旧 lazy 正则 `[\s\S]*?\}` 遇嵌套 params 会停在内部第一个 `}` 导致解析失败，
    // 现改为从 "action" 前的 `{` 做括号平衡提取（_extractBalancedJson，跳过字符串字面量内括号），
    // 嵌套 params 可完整解析；括号未配对的残缺片段仍返回 null，不完整 JSON 不猜测。

    it('P3: 嵌套 params 对象括号平衡提取成功', () => {
        // params 含嵌套对象 `{"preset":"night"}`：平衡提取得完整 JSON
        const r = parseActionFromLLM(
            '调整环境{"action":"setEnvPreset","params":{"preset":"night"}}请稍等'
        );
        expect(r).not.toBeNull();
        expect(r!.action).toBe('ai:control:setEnvPreset');
        expect(r!.params).toEqual({ preset: 'night' });
    });

    // ── 完全无匹配 ──

    it('无匹配返回 null', () => {
        expect(parseActionFromLLM('你好，我是 AI 助手')).toBeNull();
        expect(parseActionFromLLM('')).toBeNull();
        expect(parseActionFromLLM('   ')).toBeNull();
    });

    it('P2 优先于 P3：P2 失败后落 P3 括号平衡提取成功', () => {
        // P2 匹配到 ```json 代码块但内容 {invalid} 不是合法 JSON → 落 P3
        // P3 从 "action" 前的 `{` 做括号平衡提取，嵌套 params 完整解析
        const text =
            '代码块```json\n{invalid}\n```\n后面有{"action":"loadModel","params":{"name":"miku"}}';
        const r = parseActionFromLLM(text);
        expect(r).not.toBeNull();
        expect(r!.action).toBe('ai:control:loadModel');
        expect(r!.params).toEqual({ name: 'miku' });
    });

    it('P3: 括号不平衡片段返回 null（防误提取）', () => {
        // params 对象缺闭合 `}`：平衡提取失败 → null，不完整 JSON 不猜测
        const r = parseActionFromLLM(
            '调整{"action":"broken","params":{"name":"miku" 请稍等'
        );
        expect(r).toBeNull();
    });
});

describe('executeAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('委托 executeActionById 执行', async () => {
        const r = await executeAction('ai:control:setCameraMode', { mode: 'orbit' });
        expect(r).toEqual({ success: true });
        expect(executeActionById).toHaveBeenCalledWith('ai:control:setCameraMode', {
            mode: 'orbit',
        });
    });
});
