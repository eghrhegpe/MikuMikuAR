// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import { createVmdEvaluator, shutdownVmdEvaluator } from '../motion-algos/vmd-evaluator';
import {
    buildVmd,
    INTERP_LINEAR,
    INTERP_EASE_IN_OUT,
    type BoneKeyFrame,
} from '../motion-algos/vmd-writer';

describe('vmd-evaluator: 空数据兜底', () => {
    it('空 ArrayBuffer 应 reject', async () => {
        await expect(createVmdEvaluator(new ArrayBuffer(0))).rejects.toThrow();
    });

    it('无效签名应 reject', async () => {
        const bad = new ArrayBuffer(50);
        await expect(createVmdEvaluator(bad)).rejects.toThrow();
    });
});

describe('vmd-evaluator: 双帧旋转 Slerp', () => {
    it('LINEAR 插值中点应等于 Slerp(rotA, rotB, 0.5)', async () => {
        const rotA = Quaternion.FromEulerAngles(0, 0, 0);
        const rotB = Quaternion.FromEulerAngles(0, Math.PI / 2, 0);
        const frames: BoneKeyFrame[] = [
            {
                name: '上半身',
                frame: 0,
                position: [0, 0, 0],
                rotation: [rotA.x, rotA.y, rotA.z, rotA.w],
                interp: INTERP_LINEAR,
            },
            {
                name: '上半身',
                frame: 10,
                position: [0, 0, 0],
                rotation: [rotB.x, rotB.y, rotB.z, rotB.w],
                interp: INTERP_LINEAR,
            },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const result = evaluator.evalBoneFrame('上半身', 5);
        expect(result).not.toBeNull();
        const expected = Quaternion.Slerp(rotA, rotB, 0.5);
        expect(result!.rotation.x).toBeCloseTo(expected.x, 4);
        expect(result!.rotation.y).toBeCloseTo(expected.y, 4);
        expect(result!.rotation.z).toBeCloseTo(expected.z, 4);
        expect(result!.rotation.w).toBeCloseTo(expected.w, 4);
        expect(result!.position).toBeNull();
        evaluator.dispose();
    });
});

describe('vmd-evaluator: 边界与兜底', () => {
    it('frame < 首帧 → 返回首帧', async () => {
        const rotA = Quaternion.FromEulerAngles(0.1, 0, 0);
        const rotB = Quaternion.FromEulerAngles(0.2, 0, 0);
        const frames: BoneKeyFrame[] = [
            {
                name: '左腕',
                frame: 10,
                position: [0, 0, 0],
                rotation: [rotA.x, rotA.y, rotA.z, rotA.w],
                interp: INTERP_LINEAR,
            },
            {
                name: '左腕',
                frame: 20,
                position: [0, 0, 0],
                rotation: [rotB.x, rotB.y, rotB.z, rotB.w],
                interp: INTERP_LINEAR,
            },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const result = evaluator.evalBoneFrame('左腕', 5);
        expect(result!.rotation.x).toBeCloseTo(rotA.x, 4);
        evaluator.dispose();
    });

    it('frame > 末帧 → 返回末帧', async () => {
        const rotA = Quaternion.FromEulerAngles(0.1, 0, 0);
        const rotB = Quaternion.FromEulerAngles(0.2, 0, 0);
        const frames: BoneKeyFrame[] = [
            {
                name: '右腕',
                frame: 10,
                position: [0, 0, 0],
                rotation: [rotA.x, rotA.y, rotA.z, rotA.w],
                interp: INTERP_LINEAR,
            },
            {
                name: '右腕',
                frame: 20,
                position: [0, 0, 0],
                rotation: [rotB.x, rotB.y, rotB.z, rotB.w],
                interp: INTERP_LINEAR,
            },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const result = evaluator.evalBoneFrame('右腕', 99);
        expect(result!.rotation.x).toBeCloseTo(rotB.x, 4);
        evaluator.dispose();
    });

    it('frame = 首帧/末帧 → 返回对应帧', async () => {
        const rotA = Quaternion.FromEulerAngles(0.3, 0, 0);
        const rotB = Quaternion.FromEulerAngles(0.6, 0, 0);
        const frames: BoneKeyFrame[] = [
            {
                name: '左ひじ',
                frame: 10,
                position: [0, 0, 0],
                rotation: [rotA.x, rotA.y, rotA.z, rotA.w],
                interp: INTERP_LINEAR,
            },
            {
                name: '左ひじ',
                frame: 20,
                position: [0, 0, 0],
                rotation: [rotB.x, rotB.y, rotB.z, rotB.w],
                interp: INTERP_LINEAR,
            },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        expect(evaluator.evalBoneFrame('左ひじ', 10)!.rotation.x).toBeCloseTo(rotA.x, 4);
        expect(evaluator.evalBoneFrame('左ひじ', 20)!.rotation.x).toBeCloseTo(rotB.x, 4);
        evaluator.dispose();
    });

    it('骨骼不存在 → 返回 null', async () => {
        const frames: BoneKeyFrame[] = [
            {
                name: '上半身',
                frame: 0,
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
                interp: INTERP_LINEAR,
            },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        expect(evaluator.evalBoneFrame('不存在的骨', 0)).toBeNull();
        evaluator.dispose();
    });
});

describe('vmd-evaluator: evalAllBones', () => {
    it('多骨骼应全部求值', async () => {
        const rotA = Quaternion.FromEulerAngles(0.1, 0, 0);
        const rotB = Quaternion.FromEulerAngles(0.2, 0, 0);
        const frames: BoneKeyFrame[] = [
            {
                name: '上半身',
                frame: 0,
                position: [0, 0, 0],
                rotation: [rotA.x, rotA.y, rotA.z, rotA.w],
                interp: INTERP_LINEAR,
            },
            {
                name: '頭',
                frame: 0,
                position: [0, 0, 0],
                rotation: [rotB.x, rotB.y, rotB.z, rotB.w],
                interp: INTERP_LINEAR,
            },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const all = evaluator.evalAllBones(0);
        expect(all.size).toBe(2);
        expect(all.get('上半身')!.rotation.x).toBeCloseTo(rotA.x, 4);
        expect(all.get('頭')!.rotation.x).toBeCloseTo(rotB.x, 4);
        evaluator.dispose();
    });

    it('空 VMD（0 骨骼）→ 空 Map', async () => {
        const buf = buildVmd([]);
        const evaluator = await createVmdEvaluator(buf);
        const all = evaluator.evalAllBones(0);
        expect(all.size).toBe(0);
        evaluator.dispose();
    });
});

describe('vmd-evaluator: movable bone 位置求值', () => {
    it('movable bone 应返回位置 + 旋转', async () => {
        const rotA = Quaternion.FromEulerAngles(0, 0, 0);
        const rotB = Quaternion.FromEulerAngles(0.5, 0, 0);
        const frames: BoneKeyFrame[] = [
            {
                name: '腰',
                frame: 0,
                position: [0, 0, 0],
                rotation: [rotA.x, rotA.y, rotA.z, rotA.w],
                interp: INTERP_LINEAR,
            },
            {
                name: '腰',
                frame: 10,
                position: [1, 2, 3],
                rotation: [rotB.x, rotB.y, rotB.z, rotB.w],
                interp: INTERP_LINEAR,
            },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const f0 = evaluator.evalBoneFrame('腰', 0)!;
        expect(f0.position).not.toBeNull();
        expect(f0.position!.x).toBeCloseTo(0, 4);
        expect(f0.position!.y).toBeCloseTo(0, 4);
        expect(f0.position!.z).toBeCloseTo(0, 4);
        const f10 = evaluator.evalBoneFrame('腰', 10)!;
        expect(f10.position!.x).toBeCloseTo(1, 4);
        expect(f10.position!.y).toBeCloseTo(2, 4);
        expect(f10.position!.z).toBeCloseTo(3, 4);
        evaluator.dispose();
    });

    it('LINEAR 插值中点位置约为两端中点', async () => {
        const frames: BoneKeyFrame[] = [
            {
                name: '腰',
                frame: 0,
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
                interp: INTERP_LINEAR,
            },
            {
                name: '腰',
                frame: 10,
                position: [10, 20, 30],
                rotation: [0, 0, 0, 1],
                interp: INTERP_LINEAR,
            },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const f5 = evaluator.evalBoneFrame('腰', 5)!;
        expect(f5.position).not.toBeNull();
        expect(f5.position!.x).toBeCloseTo(5, 2);
        expect(f5.position!.y).toBeCloseTo(10, 2);
        expect(f5.position!.z).toBeCloseTo(15, 2);
        evaluator.dispose();
    });
});

describe('vmd-evaluator: dispose', () => {
    it('dispose 后 evalBoneFrame 返回 null', async () => {
        const frames: BoneKeyFrame[] = [
            {
                name: '上半身',
                frame: 0,
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
                interp: INTERP_LINEAR,
            },
            {
                name: '上半身',
                frame: 10,
                position: [0, 0, 0],
                rotation: [0.1, 0, 0, 0.99],
                interp: INTERP_LINEAR,
            },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        expect(evaluator.evalBoneFrame('上半身', 5)).not.toBeNull();
        evaluator.dispose();
        expect(evaluator.evalBoneFrame('上半身', 5)).toBeNull();
        expect(evaluator.evalAllBones(5).size).toBe(0);
    });

    it('dispose 幂等（多次调用不抛错）', async () => {
        const frames: BoneKeyFrame[] = [
            { name: '上半身', frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        evaluator.dispose();
        expect(() => evaluator.dispose()).not.toThrow();
    });
});

describe('vmd-evaluator: Bezier 非线性验证', () => {
    it('EASE_IN_OUT 中点 weight 应 < 0.5（缓入）', async () => {
        const rotA = Quaternion.Identity();
        const rotB = Quaternion.FromEulerAngles(1, 0, 0);
        const frames: BoneKeyFrame[] = [
            {
                name: '上半身',
                frame: 0,
                position: [0, 0, 0],
                rotation: [rotA.x, rotA.y, rotA.z, rotA.w],
                interp: INTERP_EASE_IN_OUT,
            },
            {
                name: '上半身',
                frame: 10,
                position: [0, 0, 0],
                rotation: [rotB.x, rotB.y, rotB.z, rotB.w],
                interp: INTERP_EASE_IN_OUT,
            },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const f5 = evaluator.evalBoneFrame('上半身', 5)!;
        const slerpMid = Quaternion.Slerp(rotA, rotB, 0.5);
        const distToA = Math.abs(f5.rotation.x - rotA.x);
        const distMidToA = Math.abs(slerpMid.x - rotA.x);
        expect(distToA).toBeLessThan(distMidToA);
        evaluator.dispose();
    });
});

describe('vmd-evaluator: 混合 bone + movable bone', () => {
    afterEach(() => {
        shutdownVmdEvaluator();
    });

    it('纯 bone track 无 position，movable track 有 position', async () => {
        const rotA = Quaternion.Identity();
        const rotB = Quaternion.FromEulerAngles(0.5, 0, 0);
        const frames: BoneKeyFrame[] = [
            // 普通骨骼：无位置
            {
                name: '上半身',
                frame: 0,
                position: [0, 0, 0],
                rotation: [rotA.x, rotA.y, rotA.z, rotA.w],
                interp: INTERP_LINEAR,
            },
            {
                name: '上半身',
                frame: 10,
                position: [0, 0, 0],
                rotation: [rotB.x, rotB.y, rotB.z, rotB.w],
                interp: INTERP_LINEAR,
            },
            // 可移动骨骼：有位置
            {
                name: '腰',
                frame: 0,
                position: [1, 2, 3],
                rotation: [rotA.x, rotA.y, rotA.z, rotA.w],
                interp: INTERP_LINEAR,
            },
            {
                name: '腰',
                frame: 10,
                position: [4, 5, 6],
                rotation: [rotB.x, rotB.y, rotB.z, rotB.w],
                interp: INTERP_LINEAR,
            },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const all = evaluator.evalAllBones(5);
        expect(all.size).toBe(2);
        // 上半身：无 position，旋转在 rotA 和 rotB 之间
        const bone = evaluator.evalBoneFrame('上半身', 5)!;
        expect(bone.position).toBeNull();
        // Slerp 中点不是 identity 也不是 rotB，而是在球面弧中点
        expect(bone.rotation.w).toBeLessThan(rotA.w); // 已从 w=1 被"拉向" rotB
        expect(Quaternion.Dot(bone.rotation, rotA)).toBeLessThan(1.0); // 不是 identity
        // 腰：有 position
        const movable = evaluator.evalBoneFrame('腰', 5)!;
        expect(movable.position).not.toBeNull();
        expect(movable.position!.x).toBeCloseTo(2.5, 3);
        expect(movable.position!.y).toBeCloseTo(3.5, 3);
        expect(movable.position!.z).toBeCloseTo(4.5, 3);
        evaluator.dispose();
    });

    it('重复 bone 名（两轨道）应各自独立求值', async () => {
        const rotA = Quaternion.Identity();
        const rotB = Quaternion.FromEulerAngles(0, 0.5, 0);
        const frames: BoneKeyFrame[] = [
            {
                name: '左腕',
                frame: 0,
                position: [0, 0, 0],
                rotation: [rotA.x, rotA.y, rotA.z, rotA.w],
                interp: INTERP_LINEAR,
            },
            {
                name: '左腕',
                frame: 10,
                position: [0, 0, 0],
                rotation: [rotB.x, rotB.y, rotB.z, rotB.w],
                interp: INTERP_LINEAR,
            },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const r1 = evaluator.evalBoneFrame('左腕', 3)!;
        const r2 = evaluator.evalBoneFrame('左腕', 7)!;
        expect(r1.rotation.y).toBeLessThan(r2.rotation.y);
        evaluator.dispose();
    });
});

describe('vmd-evaluator: shutdownVmdEvaluator', () => {
    afterEach(() => {
        shutdownVmdEvaluator();
    });

    it('shutdown 后可重新创建 evaluator', async () => {
        const frames: BoneKeyFrame[] = [
            { name: '上半身', frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
            { name: '上半身', frame: 10, position: [0, 0, 0], rotation: [0.1, 0, 0, 0.99] },
        ];
        const buf = buildVmd(frames);
        const e1 = await createVmdEvaluator(buf);
        e1.dispose();
        shutdownVmdEvaluator();
        // 重启后应正常
        const e2 = await createVmdEvaluator(buf);
        expect(e2.evalBoneFrame('上半身', 5)).not.toBeNull();
        e2.dispose();
    });

    it('shutdown 幂等（多次调用不抛错）', () => {
        expect(() => shutdownVmdEvaluator()).not.toThrow();
        expect(() => shutdownVmdEvaluator()).not.toThrow();
    });
});

describe('vmd-evaluator: 单帧轨道', () => {
    it('单帧 bone track 返回该帧旋转且 position 为 null', async () => {
        const rot = Quaternion.FromEulerAngles(0.3, 0.2, 0.1);
        const frames: BoneKeyFrame[] = [
            {
                name: '腕',
                frame: 7,
                position: [0, 0, 0],
                rotation: [rot.x, rot.y, rot.z, rot.w],
                interp: INTERP_LINEAR,
            },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const f = evaluator.evalBoneFrame('腕', 0)!;
        expect(f.position).toBeNull();
        expect(f.rotation.x).toBeCloseTo(rot.x, 4);
        expect(f.rotation.y).toBeCloseTo(rot.y, 4);
        expect(f.rotation.w).toBeCloseTo(rot.w, 4);
        // 任意帧号都返回同一帧
        expect(evaluator.evalBoneFrame('腕', 100)!.rotation.x).toBeCloseTo(rot.x, 4);
        evaluator.dispose();
    });

    it('单帧 movable track 返回该帧位置 + 旋转', async () => {
        const frames: BoneKeyFrame[] = [
            {
                name: '腰',
                frame: 3,
                position: [1, -2, 3],
                rotation: [0, 0, 0, 1],
                interp: INTERP_LINEAR,
            },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const f = evaluator.evalBoneFrame('腰', 0)!;
        expect(f.position).not.toBeNull();
        expect(f.position!.x).toBeCloseTo(1, 4);
        expect(f.position!.y).toBeCloseTo(-2, 4);
        expect(f.position!.z).toBeCloseTo(3, 4);
        evaluator.dispose();
    });
});

describe('vmd-evaluator: 异常帧号', () => {
    it('负帧号 → 返回首帧', async () => {
        const rotA = Quaternion.FromEulerAngles(0.1, 0, 0);
        const rotB = Quaternion.FromEulerAngles(0.2, 0, 0);
        const frames: BoneKeyFrame[] = [
            { name: '腕', frame: 10, position: [0, 0, 0], rotation: [rotA.x, rotA.y, rotA.z, rotA.w], interp: INTERP_LINEAR },
            { name: '腕', frame: 20, position: [0, 0, 0], rotation: [rotB.x, rotB.y, rotB.z, rotB.w], interp: INTERP_LINEAR },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const f = evaluator.evalBoneFrame('腕', -5)!;
        expect(f.rotation.x).toBeCloseTo(rotA.x, 4);
        evaluator.dispose();
    });

    it('NaN 帧号不崩（回退首帧）', async () => {
        const rotA = Quaternion.FromEulerAngles(0.1, 0, 0);
        const rotB = Quaternion.FromEulerAngles(0.2, 0, 0);
        const frames: BoneKeyFrame[] = [
            { name: '腕', frame: 10, position: [0, 0, 0], rotation: [rotA.x, rotA.y, rotA.z, rotA.w], interp: INTERP_LINEAR },
            { name: '腕', frame: 20, position: [0, 0, 0], rotation: [rotB.x, rotB.y, rotB.z, rotB.w], interp: INTERP_LINEAR },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const f = evaluator.evalBoneFrame('腕', NaN)!;
        expect(f).not.toBeNull();
        expect(Number.isNaN(f.rotation.x)).toBe(false);
        evaluator.dispose();
    });

    it('Infinity 帧号 → 返回末帧', async () => {
        const rotA = Quaternion.FromEulerAngles(0.1, 0, 0);
        const rotB = Quaternion.FromEulerAngles(0.2, 0, 0);
        const frames: BoneKeyFrame[] = [
            { name: '腕', frame: 10, position: [0, 0, 0], rotation: [rotA.x, rotA.y, rotA.z, rotA.w], interp: INTERP_LINEAR },
            { name: '腕', frame: 20, position: [0, 0, 0], rotation: [rotB.x, rotB.y, rotB.z, rotB.w], interp: INTERP_LINEAR },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const f = evaluator.evalBoneFrame('腕', Infinity)!;
        expect(f.rotation.x).toBeCloseTo(rotB.x, 4);
        evaluator.dispose();
    });
});

describe('vmd-evaluator: 返回值引用独立性', () => {
    it('两次求值返回不同对象（无缓存引用泄漏）', async () => {
        const rotA = Quaternion.Identity();
        const rotB = Quaternion.FromEulerAngles(0.5, 0, 0);
        const frames: BoneKeyFrame[] = [
            { name: '上半身', frame: 0, position: [0, 0, 0], rotation: [rotA.x, rotA.y, rotA.z, rotA.w], interp: INTERP_LINEAR },
            { name: '上半身', frame: 10, position: [0, 0, 0], rotation: [rotB.x, rotB.y, rotB.z, rotB.w], interp: INTERP_LINEAR },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const a = evaluator.evalBoneFrame('上半身', 5)!;
        const b = evaluator.evalBoneFrame('上半身', 5)!;
        expect(a.rotation).not.toBe(b.rotation);
        // 修改 a 不影响 b
        a.rotation.x = 999;
        expect(b.rotation.x).not.toBe(999);
        evaluator.dispose();
    });
});

describe('vmd-evaluator: movable 位置插值非线性', () => {
    it('EASE_IN_OUT 位置中点应缓入（< 线性中点）', async () => {
        const frames: BoneKeyFrame[] = [
            {
                name: '腰',
                frame: 0,
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
                interp: INTERP_EASE_IN_OUT,
            },
            {
                name: '腰',
                frame: 10,
                position: [10, 0, 0],
                rotation: [0, 0, 0, 1],
                interp: INTERP_EASE_IN_OUT,
            },
        ];
        const buf = buildVmd(frames);
        const evaluator = await createVmdEvaluator(buf);
        const f5 = evaluator.evalBoneFrame('腰', 5)!;
        // 缓入：插值 weight < 0.5，位置应 < 线性中点 5
        expect(f5.position!.x).not.toBeNull();
        expect(f5.position!.x).toBeLessThan(5);
        expect(f5.position!.x).toBeGreaterThan(0);
        evaluator.dispose();
    });
});
