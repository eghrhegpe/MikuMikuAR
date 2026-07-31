// virtual-skirt-helpers.ts — 共享测试 fixture（ADR-204 P3，拆自 virtual-skirt.test.ts）
import { vi } from 'vitest';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import type { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import { defaultVirtualSkirtConfig, type VirtualSkirtConfig } from '../scene/physics/virtual-skirt';

export { Matrix, Vector3 };

export interface MeshData {
    positions: Float32Array;
    indices: Uint32Array;
}

// 生成一个「开口底圆柱」裙摆 mesh（无封底，模拟裙摆拓扑）
export function createOpenBottomCylinder(
    radius: number,
    height: number,
    radialSegs: number,
    heightSegs: number
): MeshData {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let r = 0; r <= heightSegs; r++) {
        const y = (r / heightSegs) * height;
        for (let a = 0; a < radialSegs; a++) {
            const angle = (a / radialSegs) * Math.PI * 2;
            positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        }
    }
    const centerIdx = (heightSegs + 1) * radialSegs;
    positions.push(0, height, 0);
    for (let r = 0; r < heightSegs; r++) {
        for (let a = 0; a < radialSegs; a++) {
            const v0 = r * radialSegs + a;
            const v1 = r * radialSegs + ((a + 1) % radialSegs);
            const v2 = (r + 1) * radialSegs + a;
            const v3 = (r + 1) * radialSegs + ((a + 1) % radialSegs);
            indices.push(v0, v1, v2);
            indices.push(v1, v3, v2);
        }
    }
    const topRingStart = heightSegs * radialSegs;
    for (let a = 0; a < radialSegs; a++) {
        indices.push(centerIdx, topRingStart + ((a + 1) % radialSegs), topRingStart + a);
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

export function makeModel(
    mesh: MeshData,
    bones: { name: string; worldMatrix: Float32Array }[],
    withPhysicsWorld = true,
    meshWorldMatrix?: Matrix
): IMmdModel {
    const updateVerticesData = vi.fn();
    const model: Record<string, unknown> = {
        mesh: {
            getVerticesData: () => mesh.positions,
            getIndices: () => mesh.indices,
            updateVerticesData,
            getWorldMatrix: () => meshWorldMatrix ?? Matrix.Identity(),
        },
        runtimeBones: bones,
    };
    if (withPhysicsWorld) {
        model._physicsModel = { _worldId: 3 };
    }
    return model as unknown as IMmdModel;
}

export function makeRuntime(physics: unknown): MmdWasmRuntime {
    return { physics } as unknown as MmdWasmRuntime;
}

export function makePhysics() {
    const impl = {
        wasmInstance: {},
        addRigidBody: vi.fn(() => true),
        removeRigidBody: vi.fn(() => true),
        addConstraint: vi.fn(() => true),
        removeConstraint: vi.fn(() => true),
    };
    const physics = {
        nextWorldId: 5,
        getImpl: vi.fn(() => impl),
        impl,
    };
    return { physics, impl };
}

export function makeScene(): { scene: Scene; getCb: () => () => void } {
    const state = { capturedCb: () => {} };
    const scene = {
        deltaTime: 16.7,
        onBeforeRenderObservable: {
            add: vi.fn((cb: () => void) => {
                state.capturedCb = cb;
                return {};
            }),
            remove: vi.fn(),
        },
    } as unknown as Scene;
    return { scene, getCb: () => state.capturedCb };
}

export function testConfig(overrides: Partial<VirtualSkirtConfig> = {}): VirtualSkirtConfig {
    return {
        ...defaultVirtualSkirtConfig,
        enabled: true,
        chains: 6,
        segmentsPerChain: 3,
        ...overrides,
    };
}
