// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { Scene } from '@babylonjs/core/scene';
import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import {
    findRuntimeBone,
    getBoneLocalMatrix,
    getBoneWorldPosition,
    autoFitAttachment,
    type AttachmentAnchors,
} from '@/scene/physics/physics-bridge';

function makeModel(bones: { name: string; worldMatrix: Float32Array }[]): IMmdModel {
    return { runtimeBones: bones } as unknown as IMmdModel;
}

function matWithTranslation(x: number, y: number, z: number): Float32Array {
    const a = new Float32Array(16);
    a[0] = 1;
    a[5] = 1;
    a[10] = 1;
    a[15] = 1;
    a[12] = x;
    a[13] = y;
    a[14] = z;
    return a;
}

describe('physics-bridge bone read bridge', () => {
    const model = makeModel([
        { name: 'Center', worldMatrix: new Float32Array(16) },
        { name: 'Waist', worldMatrix: matWithTranslation(1, 2, 3) },
    ]);

    it('findRuntimeBone finds by name, handles missing/null', () => {
        expect(findRuntimeBone(model, 'Waist')?.name).toBe('Waist');
        expect(findRuntimeBone(model, 'Nope')).toBeNull();
        expect(findRuntimeBone(null, 'x')).toBeNull();
        expect(findRuntimeBone(undefined, 'x')).toBeNull();
        expect(findRuntimeBone(makeModel([]), 'x')).toBeNull();
    });

    it('getBoneLocalMatrix returns the bone matrix or null', () => {
        const mm = getBoneLocalMatrix(model, 'Waist');
        expect(mm).not.toBeNull();
        expect(mm![12]).toBe(1);
        expect(mm![13]).toBe(2);
        expect(mm![14]).toBe(3);
        expect(getBoneLocalMatrix(model, 'Nope')).toBeNull();
    });

    it('getBoneWorldPosition extracts local translation (legacy world-named API)', () => {
        const p = getBoneWorldPosition(model, 'Waist');
        expect(p).not.toBeNull();
        expect(p!.x).toBe(1);
        expect(p!.y).toBe(2);
        expect(p!.z).toBe(3);
        expect(getBoneWorldPosition(model, 'Nope')).toBeNull();
        expect(getBoneWorldPosition(null, 'x')).toBeNull();
    });
});

describe('physics-bridge autoFitAttachment', () => {
    it('produces sane geometry for a typical model', () => {
        const fit = autoFitAttachment({ modelSize: { x: 0.5, y: 1.6, z: 0.3 } });
        expect(fit.length).toBeCloseTo(0.48);
        expect(fit.innerRadius).toBeCloseTo(0.192);
        expect(fit.segmentsV).toBe(8);
        expect(fit.segmentsH).toBe(20);
        expect(fit.particleRadius).toBeCloseTo(0.03);
        expect(fit.particleSpacing).toBeCloseTo(0.06);
    });

    it('clamps results within bounds for oversized models', () => {
        const fit = autoFitAttachment({ modelSize: { x: 99, y: 99, z: 99 } });
        expect(fit.length).toBe(2.0);
        expect(fit.innerRadius).toBe(0.6);
        expect(fit.segmentsV).toBe(32);
        expect(fit.segmentsH).toBe(63);
        expect(fit.particleRadius).toBeCloseTo(0.03);
        expect(fit.particleSpacing).toBeCloseTo(0.06);
    });

    it('honors custom density', () => {
        const fit = autoFitAttachment({ modelSize: { x: 0.5, y: 1.6, z: 0.3 } }, { density: 0.1 });
        expect(fit.particleSpacing).toBeCloseTo(0.1);
        expect(fit.particleRadius).toBeCloseTo(0.05);
    });

    it('falls back to default density for non-positive / non-finite density', () => {
        // density=0：旧实现会得到 particleRadius=0 的退化几何
        expect(
            autoFitAttachment({ modelSize: { x: 0.5, y: 1.6, z: 0.3 } }, { density: 0 })
                .particleRadius
        ).toBeCloseTo(0.03);
        // density 负数：旧实现会得到负 particleRadius
        expect(
            autoFitAttachment({ modelSize: { x: 0.5, y: 1.6, z: 0.3 } }, { density: -0.1 })
                .particleRadius
        ).toBeGreaterThan(0);
        // density NaN：旧实现会让 particleRadius 扩散为 NaN
        expect(
            autoFitAttachment({ modelSize: { x: 0.5, y: 1.6, z: 0.3 } }, { density: NaN })
                .particleRadius
        ).toBeCloseTo(0.03);
        // density Infinity：同样回退默认
        expect(
            autoFitAttachment({ modelSize: { x: 0.5, y: 1.6, z: 0.3 } }, { density: Infinity })
                .particleRadius
        ).toBeGreaterThan(0);
    });

    it('returns finite defaults for missing, empty, non-finite or non-positive model size', () => {
        const cases: unknown[] = [
            null,
            undefined,
            {},
            { modelSize: undefined },
            { modelSize: { y: NaN } },
            { modelSize: { y: Infinity } },
            { modelSize: { y: -Infinity } },
            { modelSize: { y: 0 } },
            { modelSize: { y: -1 } },
        ];
        for (const anchor of cases) {
            const fit = autoFitAttachment(anchor as AttachmentAnchors);
            expect(Number.isFinite(fit.length)).toBe(true);
            expect(Number.isFinite(fit.innerRadius)).toBe(true);
            expect(Number.isFinite(fit.segmentsV)).toBe(true);
            expect(Number.isFinite(fit.segmentsH)).toBe(true);
            expect(fit.length).toBeGreaterThan(0);
            expect(fit.innerRadius).toBeGreaterThan(0);
            expect(fit.particleRadius).toBeGreaterThan(0);
        }
    });
});
