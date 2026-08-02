// [audit 2026-08-02] 程序化动作 + 骨骼覆盖 管线契约测试（P4）。
//
// 背景：vmd-base / proc-motion 的骨骼写入由 babylon-mmd 在 WASM 层完成，不经过 JS 管线
// （见 motion-pipeline.ts:22-25）。JS 侧只治理 vmd-layers / bone-override / perception。
// 因此「程序化动作能继承骨骼覆盖」的成立前提是：bone-override 阶段恒在 proc-motion 之后执行，
// 后写者覆盖先写者 —— 与 VMD 完全等价。
//
// 本测试在 JS 层锁定该契约：
//   ① stage 排序：bone-override 恒在 proc-motion 之后（逆序注册亦然）；
//   ② 同一骨骼上，覆盖层写入覆盖程序化动画层写入（最终 worldMatrix = 覆盖）。
// 结合 bone-override.test.ts 的 computeOverride 纯函数测试，覆盖该组合路径的两半。
import { describe, it, expect, vi } from 'vitest';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { MotionPipeline } from '@/scene/motion/motion-pipeline';
import type { PipelineLayer, FrameContext } from '@/scene/motion/motion-pipeline';

const ctx: FrameContext = { scene: {} as import('@babylonjs/core/scene').Scene };

function makeLayer(
    id: string,
    stage: PipelineLayer['stage'],
    order: number,
    run: () => void
): PipelineLayer {
    return { id, stage, order, run: vi.fn(run) };
}

describe('程序化动作 + 骨骼覆盖 管线契约 (audit P4)', () => {
    it('bone-override 阶段恒在 proc-motion 之后执行（逆序注册亦然）', () => {
        const seq: string[] = [];
        const pipeline = new MotionPipeline();
        // 逆序注册：覆盖先、proc 后，验证执行序仍由 stage 决定
        pipeline.register(makeLayer('ov', 'bone-override', 0, () => seq.push('ov')));
        pipeline.register(makeLayer('proc', 'proc-motion', 0, () => seq.push('proc')));

        pipeline.runFrame(ctx);
        expect(seq).toEqual(['proc', 'ov']);
    });

    it('同一骨骼：覆盖层写入覆盖程序化动画层写入（最终 = 覆盖矩阵）', () => {
        const boneBuf = new Float32Array(16); // 模拟 MmdRuntimeBoneExtended.worldMatrix
        const procAnimMat = Matrix.RotationYawPitchRoll(0.3, 0, 0); // 程序化动画 yaw 0.3
        const overrideMat = Matrix.RotationYawPitchRoll(-0.5, 0, 0); // 覆盖 yaw -0.5

        const pipeline = new MotionPipeline();
        pipeline.register(
            makeLayer('proc', 'proc-motion', 0, () => procAnimMat.copyToArray(boneBuf, 0))
        );
        pipeline.register(
            makeLayer('ov', 'bone-override', 0, () => overrideMat.copyToArray(boneBuf, 0))
        );

        pipeline.runFrame(ctx);

        const finalMat = Matrix.FromArray(boneBuf);
        // Babylon m[2] = -sin(yaw)：yaw=-0.5 → +0.479；若覆盖未生效则为 -sin(0.3)=-0.296
        expect(finalMat.m[2]).toBeCloseTo(-Math.sin(-0.5));
        expect(finalMat.m[2]).not.toBeCloseTo(-Math.sin(0.3));
    });

    it('覆盖未启用时，程序化动画写入不被任何层篡改（pass-through）', () => {
        const boneBuf = new Float32Array(16);
        const procAnimMat = Matrix.RotationYawPitchRoll(0.3, 0, 0);

        const pipeline = new MotionPipeline();
        pipeline.register(
            makeLayer('proc', 'proc-motion', 0, () => procAnimMat.copyToArray(boneBuf, 0))
        );
        // 无 bone-override 层

        pipeline.runFrame(ctx);

        const finalMat = Matrix.FromArray(boneBuf);
        expect(finalMat.m[2]).toBeCloseTo(-Math.sin(0.3));
    });
});
