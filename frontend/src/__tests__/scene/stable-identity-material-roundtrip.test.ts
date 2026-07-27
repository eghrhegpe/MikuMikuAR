// [doc:adr-193] 稳定身份 — 材质可见性（「服饰开关」）跨重载还原回合测试
// 直接回应「服饰开关在重载后全部回到开启」的疑虑：用真实 material.ts 函数模拟
// serialize(getMatState) → reload(applyMatState) 回合，验证稳定 id 下状态不丢。
// 不拉入 Babylon Scene（material.ts 不依赖 scene.ts），零重型 mock。

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 受控的 modelRegistry（material.ts 按 id 查 meshes）—— 用 vi.hoisted 避免 hoist 引用错误
const hoisted = vi.hoisted(() => ({
    registry: new Map<
        string,
        { id: string; meshes: Array<{ setEnabled: ReturnType<typeof vi.fn> }> }
    >(),
}));

vi.mock('@/core/config', () => ({
    modelRegistry: hoisted.registry,
    uiState: {},
    triggerAutoSave: vi.fn(),
}));

import {
    getMatState,
    setMatEnabled,
    applyMatState,
    isMatEnabled,
    _matEnabled,
} from '../../scene/manager/material';

function makeInst(id: string, meshCount: number): void {
    const meshes = Array.from({ length: meshCount }, () => ({ setEnabled: vi.fn() }));
    hoisted.registry.set(id, { id, meshes });
}

beforeEach(() => {
    hoisted.registry.clear();
    _matEnabled.clear();
});

describe('ADR-193 — 材质可见性跨重载还原（稳定身份）', () => {
    it('post-fix: 稳定 id 下，save 前隐藏的材质在 reload 后仍隐藏', () => {
        const id = 'uuid-stable-1';
        makeInst(id, 4);

        // 用户隐藏第 2 个材质（「服饰开关」关）
        setMatEnabled(id, 2, false);
        expect(isMatEnabled(id, 2)).toBe(false);

        // —— serialize ——（真实函数，等价于 scene-serialize.ts:441-451）
        const saved = getMatState(id);
        expect(saved).not.toBeNull();
        expect(saved!.enabled).toEqual({ 2: false });

        // —— reload：模型以同一稳定 id 重新注册（ADR-193: loadPMXFile(..., m.uuid)）——
        hoisted.registry.clear();
        makeInst(id, 4);

        // —— deserialize ——（真实函数，等价于 scene-serialize.ts:862-872）
        applyMatState(id, { enabled: saved!.enabled });

        // 还原后第 2 个材质应保持隐藏
        expect(isMatEnabled(id, 2)).toBe(false);
        expect(_matEnabled.get(id)?.get(2)).toBe(false);
    });

    it('post-fix: 多材质隐藏 + 重载后仍全部正确还原', () => {
        const id = 'uuid-stable-2';
        makeInst(id, 6);

        setMatEnabled(id, 1, false);
        setMatEnabled(id, 3, false);
        setMatEnabled(id, 5, false);

        const saved = getMatState(id);
        expect(saved!.enabled).toEqual({ 1: false, 3: false, 5: false });

        hoisted.registry.clear();
        makeInst(id, 6);
        applyMatState(id, { enabled: saved!.enabled });

        for (let i = 0; i < 6; i++) {
            expect(isMatEnabled(id, i)).toBe(i === 1 || i === 3 || i === 5 ? false : true);
        }
    });

    it('对照(pre-fix 病因): 重载后 id 变化导致状态孤儿化 —— 说明为何需要稳定身份', () => {
        // pre-fix: 运行时 id 易变，重载后变成新 id。
        // 存档的 enabled 是按「旧 id」落盘的；重载拿到新 id，
        // 反序列化若仍按旧 id 查找状态则命中失败（此处用 getMatState(旧id) 在重载后查询演示孤儿化）。
        const oldId = 'model_111_a';
        const newId = 'model_222_b';
        makeInst(oldId, 4);

        setMatEnabled(oldId, 2, false);
        const saved = getMatState(oldId); // 序列化时按 oldId 读取 → 命中
        expect(saved!.enabled).toEqual({ 2: false });

        // 重载：模型获得新易变 id（pre-fix 行为），旧 inst 已卸载
        hoisted.registry.clear();
        _matEnabled.delete(oldId); // 旧 id 的状态随卸载被丢弃
        makeInst(newId, 4);

        // 若反序列化错误地用「旧 id」去查状态（pre-fix 桥接 modelUuidMap 失稳时的等效失败路径），
        // 则 getMatState(旧id) 返回 null → 状态孤儿化，无法还原。
        const orphaned = getMatState(oldId);
        expect(orphaned).toBeNull();
        // 新 id 下第 2 个材质默认可见（未被还原）→ 即「服饰全部回到开启」
        expect(isMatEnabled(newId, 2)).toBe(true);
    });
});
