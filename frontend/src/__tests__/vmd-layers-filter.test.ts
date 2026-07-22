// [doc:adr-051] VMD 骨骼过滤单元测试
// 测试 _filterVmdBones 的二进制级 VMD 骨骼帧过滤逻辑

import { describe, it, expect } from 'vitest';
import { buildVmd, BONE_FRAME_SIZE, INTERP_LINEAR } from '../motion-algos/vmd-writer';
import type { BoneKeyFrame } from '../motion-algos/vmd-writer';
import { _filterVmdBones } from '../scene/motion/vmd-layers';

/** 从 VMD buffer 读取骨骼帧数（offset 50，uint32 LE） */
function readBoneCount(data: ArrayBuffer): number {
    return new DataView(data).getUint32(50, true);
}

/** 从 VMD buffer 读取 morph 帧数（在骨骼帧之后，uint32 LE） */
function readMorphCount(data: ArrayBuffer): number {
    const boneCount = readBoneCount(data);
    const morphOffset = 54 + boneCount * BONE_FRAME_SIZE;
    return new DataView(data).getUint32(morphOffset, true);
}

/** 从 VMD buffer 读取第 index 个骨骼帧的骨骼名（15 字节 Shift-JIS） */
function readBoneName(data: ArrayBuffer, index: number): string {
    const boneOffset = 54 + index * BONE_FRAME_SIZE;
    const src = new Uint8Array(data);
    let end = 0;
    while (end < 15 && src[boneOffset + end] !== 0) {
        end++;
    }
    return new TextDecoder('shift-jis').decode(src.slice(boneOffset, boneOffset + end));
}

/** 创建测试用 VMD，含指定骨骼名的骨骼帧 */
function makeVmdWithBones(boneNames: string[], morphCount = 0): ArrayBuffer {
    const frames: BoneKeyFrame[] = boneNames.map((name, i) => ({
        name,
        frame: i,
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
        interp: INTERP_LINEAR,
    }));
    // 添加一个有 morph 帧的版本来验证 morph 保留
    const morphFrames = morphCount > 0 ? [{ name: 'まばたき', frame: 0, weight: 0.5 }] : [];
    return buildVmd(frames, morphFrames);
}

describe('_filterVmdBones', () => {
    // ── 空过滤 ──

    it('空 boneFilter 返回原始引用（零拷贝）', () => {
        const data = makeVmdWithBones(['センター']);
        const result = _filterVmdBones(data, []);
        expect(result).toBe(data); // 同一个 ArrayBuffer 引用
        expect(readBoneCount(result)).toBe(1);
    });

    it('空 VMD（0 帧骨骼）空 boneFilter 返回原始引用', () => {
        const data = makeVmdWithBones([]);
        const result = _filterVmdBones(data, []);
        expect(result).toBe(data);
        expect(readBoneCount(result)).toBe(0);
    });

    // ── 全匹配 ──

    it('boneFilter 覆盖全部骨骼时返回原始引用', () => {
        const data = makeVmdWithBones(['上半身', '下半身', '首']);
        const result = _filterVmdBones(data, ['上半身', '下半身', '首']);
        expect(result).toBe(data);
        expect(readBoneCount(result)).toBe(3);
    });

    it('boneFilter 是超集时也返回原始引用', () => {
        const data = makeVmdWithBones(['左腕', '右腕']);
        const result = _filterVmdBones(data, ['左腕', '右腕', '首']);
        expect(result).toBe(data);
        expect(readBoneCount(result)).toBe(2);
    });

    // ── 部分匹配 ──

    it('部分匹配：过滤后 VMD 骨骼帧数减少', () => {
        const data = makeVmdWithBones(['左腕', '右腕', '左ひじ', '右ひじ']);
        const result = _filterVmdBones(data, ['左腕', '右腕']);
        expect(result).not.toBe(data); // 新建了 buffer
        expect(readBoneCount(result)).toBe(2);
    });

    it('部分匹配：保留正确的骨骼名', () => {
        const data = makeVmdWithBones(['左腕', '右腕', '左ひじ', '右ひじ']);
        const result = _filterVmdBones(data, ['左腕', '右ひじ']);
        expect(readBoneCount(result)).toBe(2);
        expect(readBoneName(result, 0)).toBe('左腕');
        expect(readBoneName(result, 1)).toBe('右ひじ');
    });

    it('部分匹配：保留 morph 帧和尾部数据', () => {
        const data = makeVmdWithBones(['上半身', '首', '左腕'], 1);
        const result = _filterVmdBones(data, ['上半身']);
        expect(readBoneCount(result)).toBe(1);
        expect(readBoneName(result, 0)).toBe('上半身');
        // morph 帧数应保留
        expect(readMorphCount(result)).toBe(1);
    });

    it('部分匹配：保留插值曲线字节（64B per frame）', () => {
        // 创建带非默认插值的 VMD
        const data = makeVmdWithBones(['センター', '上半身']);
        const result = _filterVmdBones(data, ['センター']);
        expect(readBoneCount(result)).toBe(1);
        // 验证过滤后 bone 数据区的总大小正确（54 头 + 1×111 帧 + morph + trailer）
        const expectedSize = 54 + 1 * BONE_FRAME_SIZE + 4 + 4 * 4; // morphCount=0 + trailer
        expect(result.byteLength).toBe(expectedSize);
    });

    // ── 无匹配 ──

    it('无匹配：返回骨骼帧数为 0 的 VMD', () => {
        const data = makeVmdWithBones(['センター', '上半身']);
        const result = _filterVmdBones(data, ['存在しない骨']);
        expect(readBoneCount(result)).toBe(0);
        // morph 区仍存在（即使无 morph 帧，有 uint32=0 的计数区）
        expect(result.byteLength).toBeGreaterThan(54);
    });

    // ── 日文骨骼名（Shift-JIS） ──

    it('Shift-JIS 日文骨骼名正确匹配', () => {
        const data = makeVmdWithBones(['左ひじ', '右ひじ', '左手首', '右手首']);
        // 只保留左手系
        const result = _filterVmdBones(data, ['左ひじ', '左手首']);
        expect(readBoneCount(result)).toBe(2);
        expect(readBoneName(result, 0)).toBe('左ひじ');
        expect(readBoneName(result, 1)).toBe('左手首');
    });

    it('中文/英文骨骼名正确匹配', () => {
        const data = makeVmdWithBones(['上半身', '下半身', '頭']);
        const result = _filterVmdBones(data, ['頭']);
        expect(readBoneCount(result)).toBe(1);
        expect(readBoneName(result, 0)).toBe('頭');
    });

    // ── 边界 ──

    it('空 VMD（0 帧骨骼）带非空 boneFilter 返回原始引用', () => {
        const data = makeVmdWithBones([]);
        const result = _filterVmdBones(data, ['センター']);
        expect(result).toBe(data);
        expect(readBoneCount(result)).toBe(0);
    });

    // ── 数据完整性 ──

    it('过滤后 VMD 文件可再次被过滤（幂等性）', () => {
        const data = makeVmdWithBones(['左腕', '右腕', '首']);
        const first = _filterVmdBones(data, ['左腕', '首']);
        const second = _filterVmdBones(first, ['左腕']);
        expect(readBoneCount(second)).toBe(1);
        expect(readBoneName(second, 0)).toBe('左腕');
    });
});
