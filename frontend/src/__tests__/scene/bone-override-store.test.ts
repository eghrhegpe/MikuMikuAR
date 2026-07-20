// [doc:adr-147 Phase 2] BoneOverrideStore 核心不变量锁死
import { describe, it, expect, beforeEach } from 'vitest';
import { Quaternion } from '@babylonjs/core';
import {
    InMemoryBoneOverrideStore,
    type OverrideSlot,
} from '../../scene/motion/bone-override-store';

function slot(over: Partial<OverrideSlot> = {}): OverrideSlot {
    return {
        quat: Quaternion.Identity(),
        weight: 1,
        enabled: true,
        overrideRotation: true,
        sourceModuleId: null,
        ...over,
    };
}

describe('BoneOverrideStore (ADR-147 Phase 2)', () => {
    let store: InMemoryBoneOverrideStore;
    beforeEach(() => {
        store = new InMemoryBoneOverrideStore();
    });

    it('claimBones 高优先级抢占低优先级：清落败方 slot + 记录冲突', () => {
        const s = slot({ sourceModuleId: 'A' });
        store.setSlot('m1', '上半身', s);
        store.claimBones('m1', 'A', 2, ['上半身']); // A 优先级较低（数值大）
        store.claimBones('m1', 'B', 1, ['上半身']); // B 优先级更高（数值小，smaller=higher）

        // A 的 slot 应被清掉（无孤儿 slot）
        expect(store.getSlot('m1', '上半身')).toBeUndefined();
        // B 现拥有该骨
        expect(store.getOwnedBones('m1', 'B').has('上半身')).toBe(true);
        expect(store.getOwnedBones('m1', 'A').has('上半身')).toBe(false);
        // 冲突被记录
        const conflicts = store.getConflicts('m1');
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0]).toMatchObject({
            bone: '上半身',
            loserModuleId: 'A',
            winnerModuleId: 'B',
            loserPriority: 2,
            winnerPriority: 1,
        });
    });

    it('claimBones 低优先级落败：跳过且不抢占（返回 claimed 为空，但记本模块视角冲突）', () => {
        store.claimBones('m1', 'A', 1, ['上半身']); // A 优先级较高（数值小）
        const claimed = store.claimBones('m1', 'B', 2, ['上半身']); // B 优先级更低（数值大）→ 落败

        expect(claimed).toHaveLength(0); // B 未获得任何骨（M3 返回 claimed）
        expect(store.getOwnedBones('m1', 'A').has('上半身')).toBe(true);
        expect(store.getOwnedBones('m1', 'B').has('上半身')).toBe(false);
        // M4：落败方视角也记录冲突（loser=B），B banner 才能显示「我想抢但被抢」
        const conflicts = store.getConflicts('m1');
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0]).toMatchObject({
            bone: '上半身',
            loserModuleId: 'B',
            winnerModuleId: 'A',
            loserPriority: 2,
            winnerPriority: 1,
        });
    });

    it('releaseBones 级联清理槽位（根治 R3 孤儿 slot）', () => {
        store.setSlot('m1', '上半身', slot({ sourceModuleId: 'A' }));
        store.claimBones('m1', 'A', 1, ['上半身', '上半身2']);

        const released = store.releaseBones('m1', 'A');
        expect(released.has('上半身')).toBe(true);
        expect(released.has('上半身2')).toBe(true);
        // 槽位也应被清掉
        expect(store.getSlot('m1', '上半身')).toBeUndefined();
        expect(store.getSlot('m1', '上半身2')).toBeUndefined();
        expect(store.getOwnedBones('m1', 'A').size).toBe(0);
    });

    it('setModuleEnabled(false) 级联释放全部骨骼 + 槽位', () => {
        store.setSlot('m1', '上半身', slot({ sourceModuleId: 'A' }));
        store.claimBones('m1', 'A', 1, ['上半身', '頭']);

        store.setModuleEnabled('m1', 'A', false);
        expect(store.getOwnedBones('m1', 'A').size).toBe(0);
        expect(store.getSlot('m1', '上半身')).toBeUndefined();
        expect(store.getSlot('m1', '頭')).toBeUndefined();
    });

    it('disposeModel 清空所有副本', () => {
        store.setSlot('m1', '上半身', slot({ sourceModuleId: 'A' }));
        store.claimBones('m1', 'A', 1, ['上半身']);
        store.disposeModel('m1');

        expect(store.getSlot('m1', '上半身')).toBeUndefined();
        expect(store.getOwnedBones('m1', 'A').size).toBe(0);
        expect(store.getConflicts('m1')).toHaveLength(0);
    });

    it('不同 model 的作用域相互隔离', () => {
        store.claimBones('m1', 'A', 1, ['上半身']);
        store.claimBones('m2', 'B', 2, ['上半身']);
        expect(store.getOwnedBones('m1', 'A').has('上半身')).toBe(true);
        expect(store.getOwnedBones('m2', 'B').has('上半身')).toBe(true);
    });

    // ── ADR-147 §六·补 语义迁移映射表的接入前置硬约束（M3–M6/M8/M9）──

    it('M3 claimBones 返回 claimed（本模块现拥有骨，含已拥有+新认领），bake 门控不误跳过', () => {
        // riding-model 回归场景：A 高优占多骨，B 低优占另一骨，B 的 bake 不应因返回空集而误跳过
        store.claimBones('m1', 'A', 1, ['上半身', '左手首']);
        const claimedB = store.claimBones('m1', 'B', 2, ['右手首']);
        // B 现拥有 右手首（非抢占），claimed 非空 → bake 的 claimed.includes('右手首') 为真
        expect(claimedB).toEqual(['右手首']);
        // 重复 claim 已拥有骨仍计入 claimed（对齐 registry：已拥有骨 push 进 claimed）
        const reClaim = store.claimBones('m1', 'A', 1, ['上半身', '頭']);
        expect(reClaim).toEqual(['上半身', '頭']);
    });

    it('M4 冲突双视角：抢占方记 loser=原主，落败方记 loser=本模块', () => {
        // 场景一：B 高优抢占 A 已占的骨 → 记 loser=A（原主视角）
        store.claimBones('m1', 'A', 2, ['上半身']);
        store.claimBones('m1', 'B', 1, ['上半身']);
        const c1 = store.getConflicts('m1');
        expect(c1).toHaveLength(1);
        expect(c1[0]).toMatchObject({ bone: '上半身', loserModuleId: 'A', winnerModuleId: 'B' });

        // 场景二：B 低优晚到落败 → 记 loser=B（本模块视角），对齐 registry:220
        const s2 = new InMemoryBoneOverrideStore();
        s2.claimBones('m1', 'A', 1, ['上半身']);
        s2.claimBones('m1', 'B', 2, ['上半身']);
        const c2 = s2.getConflicts('m1');
        expect(c2).toHaveLength(1);
        expect(c2[0]).toMatchObject({ bone: '上半身', loserModuleId: 'B', winnerModuleId: 'A' });
    });

    it('M5 releaseBones 清本模块作为 loser 的冲突卡片（避免幽灵冲突累积）', () => {
        store.claimBones('m1', 'A', 1, ['上半身']); // A 高优
        store.claimBones('m1', 'B', 2, ['上半身']); // B 低优落败 → 记 loser=B
        expect(store.getConflicts('m1')).toHaveLength(1);
        store.releaseBones('m1', 'B'); // B 释放 → 清 loser===B 的卡片（对齐 registry._clearConflict）
        expect(store.getConflicts('m1')).toHaveLength(0);
    });

    it('M6 setSlot/clearSlot 所有权守卫：拒绝越权写/清他人 slot', () => {
        store.claimBones('m1', 'A', 1, ['上半身']);
        store.setSlot('m1', '上半身', slot({ sourceModuleId: 'A', weight: 1 }));
        // B 未认领 上半身，试图覆盖 A 的 slot → 拒绝（防 R3 幽灵 slot 换壳）
        store.setSlot('m1', '上半身', slot({ sourceModuleId: 'B', weight: 0.5 }));
        expect(store.getSlot('m1', '上半身')?.sourceModuleId).toBe('A');
        expect(store.getSlot('m1', '上半身')?.weight).toBe(1);
        // B 试图越权清 A 的 slot → 拒绝
        store.clearSlot('m1', '上半身', 'B');
        expect(store.getSlot('m1', '上半身')).toBeDefined();
        // A 自己清 → 成功
        store.clearSlot('m1', '上半身', 'A');
        expect(store.getSlot('m1', '上半身')).toBeUndefined();
    });

    it('M8 BoneConflict.stage 由 stageOf 注入填充（满足 §九 验收 3）', () => {
        const s = new InMemoryBoneOverrideStore({
            stageOf: (m) => (m === 'A' ? 'perception' : m === 'B' ? 'bone-override' : undefined),
        });
        s.claimBones('m1', 'A', 2, ['上半身']); // A 先占
        s.claimBones('m1', 'B', 1, ['上半身']); // B 抢占 → winner=B / loser=A
        const c = s.getConflicts('m1');
        expect(c).toHaveLength(1);
        expect(c[0].winnerStage).toBe('bone-override');
        expect(c[0].loserStage).toBe('perception');
    });

    it('M9 priority=0 为合法最高优先级（不被哨兵忽略）', () => {
        store.claimBones('m1', 'A', 5, ['上半身']); // A 占（prio 5）
        // B 以 priority=0 抢占：0 < 5 → B 赢，winnerPriority 应记录为 0（证明 0 被当作权威值而非忽略）
        store.claimBones('m1', 'B', 0, ['上半身']);
        const c = store.getConflicts('m1');
        expect(c).toHaveLength(1);
        expect(c[0]).toMatchObject({
            loserModuleId: 'A',
            loserPriority: 5,
            winnerModuleId: 'B',
            winnerPriority: 0,
        });
    });
});
