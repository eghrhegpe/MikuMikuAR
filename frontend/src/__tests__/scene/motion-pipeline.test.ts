// ADR-147 Phase 1 — MotionPipeline 排序不变量单测。
// 核心断言：执行序只由 (stage, order) 决定，与 register 调用顺序无关。
import { describe, it, expect, vi } from 'vitest';
import { MotionPipeline } from '@/scene/motion/motion-pipeline';
import type { PipelineLayer } from '@/scene/motion/motion-pipeline';

function makeLayer(id: string, stage: PipelineLayer['stage'], order: number): PipelineLayer {
    return { id, stage, order, run: vi.fn() };
}

// 最小 FrameContext 桩（Scene 仅类型，运行时不需要真实场景）
const ctx = { scene: {} as import('@babylonjs/core/scene').Scene };

describe('MotionPipeline (ADR-147 Phase 1)', () => {
    it('getOrderedLayers 严格按 (stage, order) 升序', () => {
        const pipeline = new MotionPipeline();
        pipeline.register(makeLayer('p', 'perception', 0));
        pipeline.register(makeLayer('bo2', 'bone-override', 2));
        pipeline.register(makeLayer('bo1', 'bone-override', 1));
        pipeline.register(makeLayer('vl', 'vmd-layers', 0));
        pipeline.register(makeLayer('vb', 'vmd-base', 0));

        const order = pipeline.getOrderedLayers().map((l) => l.id);
        expect(order).toEqual(['vb', 'vl', 'bo1', 'bo2', 'p']);
    });

    it('同 stage 内 order 升序、不影响跨 stage', () => {
        const pipeline = new MotionPipeline();
        pipeline.register(makeLayer('a', 'bone-override', 5));
        pipeline.register(makeLayer('b', 'bone-override', 1));
        pipeline.register(makeLayer('c', 'perception', 0));

        const order = pipeline.getOrderedLayers().map((l) => l.id);
        expect(order).toEqual(['b', 'a', 'c']);
    });

    it('register 返回 unregister，移除后不再执行', () => {
        const pipeline = new MotionPipeline();
        const layer = makeLayer('x', 'bone-override', 0);
        const unregister = pipeline.register(layer);
        expect(pipeline.size).toBe(1);

        unregister();
        expect(pipeline.size).toBe(0);

        pipeline.runFrame(ctx);
        expect((layer.run as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    });

    it('runFrame 按 getOrderedLayers 序调用 run', () => {
        const pipeline = new MotionPipeline();
        const seq: string[] = [];
        const l1 = makeLayer('vb', 'vmd-base', 0);
        const l2 = makeLayer('p', 'perception', 0);
        l1.run = vi.fn(() => seq.push('vb'));
        l2.run = vi.fn(() => seq.push('p'));
        pipeline.register(l2); // 逆序注册
        pipeline.register(l1);

        pipeline.runFrame(ctx);
        expect(seq).toEqual(['vb', 'p']); // 执行序仍由 stage 决定
    });
});
