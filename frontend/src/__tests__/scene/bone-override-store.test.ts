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
        store.claimBones('m1', 'A', 1, ['上半身']);
        store.claimBones('m1', 'B', 2, ['上半身']); // B 优先级更高

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
            loserPriority: 1,
            winnerPriority: 2,
        });
    });

    it('claimBones 低优先级落败：跳过且不抢占', () => {
        store.claimBones('m1', 'A', 2, ['上半身']);
        const preempted = store.claimBones('m1', 'B', 1, ['上半身']); // B 优先级更低

        expect(preempted).toHaveLength(0);
        expect(store.getOwnedBones('m1', 'A').has('上半身')).toBe(true);
        expect(store.getOwnedBones('m1', 'B').has('上半身')).toBe(false);
        // 落败不重复写冲突
        expect(store.getConflicts('m1')).toHaveLength(0);
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
});
