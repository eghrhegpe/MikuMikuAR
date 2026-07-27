// [doc:stable-identity] 单元测试 resolveModelId —— 稳定身份决策点。
// 覆盖：① 恢复路径传入存档 uuid 时直接复用（跨会话 id 稳定）；
//       ② 未传/空时生成稳定 uuid（旧 `model_${Date.now()}_${random}` 行为已废弃）。
import { describe, it, expect } from 'vitest';
import { resolveModelId } from '../../scene/manager/model-id';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('resolveModelId (stable-identity)', () => {
    it('传入存档 uuid 时直接复用，不重新生成', () => {
        const saved = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
        expect(resolveModelId(saved)).toBe(saved);
    });

    it('恢复路径传入的 uuid 与序列化落盘的 uuid 形态一致（v4）', () => {
        const saved = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
        expect(resolveModelId(saved)).toMatch(UUID_RE);
    });

    it('未传 preferredId 时生成稳定 uuid（v4 格式）', () => {
        const id = resolveModelId();
        expect(id).toMatch(UUID_RE);
        // 两次生成应不同（避免碰撞）
        expect(resolveModelId()).not.toBe(id);
    });

    it('空字符串 preferredId 回退到生成 uuid（不误用空串作为 id）', () => {
        const id = resolveModelId('');
        expect(id).toMatch(UUID_RE);
        expect(id.length).toBeGreaterThan(0);
    });

    it('旧格式 `model_*` 不再作为默认值（确保已迁移到 uuid）', () => {
        const id = resolveModelId();
        expect(id.startsWith('model_')).toBe(false);
    });
});
