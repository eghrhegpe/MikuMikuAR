// @vitest-environment node
// [ADR-248] dumpBoneHierarchy 的 IK 求解器字段推导逻辑测试。
// 核心断言：hasIkSolver 同时支持 JS（ikSolver 字段）与 WASM（ikSolverIndex 字段）两种模式，
// 且 ikSolverIndex 为负数时表示「无求解器」（WASM 约定：-1=无 IK），不被误判为有 IK。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { MmdRuntimeBoneExtended } from '@/core/types';
import {
    dumpBoneHierarchy,
    startBoneOverride,
    stopBoneOverride,
    clearAllOverrides,
} from '@/scene/motion/bone-override';

// 注入聚焦模型 ID（dumpBoneHierarchy 内部通过 _resolveModelId → focusedModelId 获取）
vi.mock('@/core/state', async (importActual) => ({
    ...(await importActual<typeof import('@/core/state')>()),
    focusedModelId: 'test-model',
}));

/** 构造最小骨骼 mock，仅保留 dumpBoneHierarchy 需要读取的字段 */
function makeBone(
    name: string,
    opts: {
        parentBone?: IMmdRuntimeBone | null;
        childBones?: IMmdRuntimeBone[];
        transformAfterPhysics?: boolean;
        ikSolver?: object | null;
        ikSolverIndex?: number;
    } = {}
): IMmdRuntimeBone {
    const parentBone = opts.parentBone ?? null;
    const childBones = opts.childBones ?? ([] as IMmdRuntimeBone[]);
    return {
        name,
        parentBone,
        childBones,
        transformAfterPhysics: opts.transformAfterPhysics ?? false,
        ...(opts.ikSolver !== undefined ? { ikSolver: opts.ikSolver } : {}),
        ...(opts.ikSolverIndex !== undefined ? { ikSolverIndex: opts.ikSolverIndex } : {}),
    } as unknown as IMmdRuntimeBone & MmdRuntimeBoneExtended;
}

const MODEL_ID = 'test-model';

async function launchBones(bones: IMmdRuntimeBone[]): Promise<void> {
    const { NullEngine } = await import('@babylonjs/core/Engines/nullEngine');
    const { Scene } = await import('@babylonjs/core/scene');
    const engine = new NullEngine();
    const scene = new Scene(engine);
    startBoneOverride(() => bones, scene);
}

async function shutdownBones(): Promise<void> {
    stopBoneOverride();
}

describe('dumpBoneHierarchy IK 求解器推导 (ADR-248)', () => {
    beforeEach(() => {
        clearAllOverrides(MODEL_ID);
    });

    it('WASM 模式：ikSolverIndex>=0 → hasIkSolver=true 且 ikSolverIndex 值正确', async () => {
        const parent = makeBone('センター', { ikSolverIndex: -1 });
        const bones: IMmdRuntimeBone[] = [
            parent,
            makeBone('左足IK', { parentBone: parent, ikSolverIndex: 3 }),
        ];
        await launchBones(bones);

        const dump = dumpBoneHierarchy(MODEL_ID);
        expect(dump).not.toBeNull();
        expect(dump!.bones.length).toBe(2);

        const centerNode = dump!.bones.find((n) => n.name === 'センター');
        expect(centerNode).toBeDefined();
        expect(centerNode!.hasIkSolver).toBe(false);
        expect(centerNode!.ikSolverIndex).toBe(-1);

        const ikNode = dump!.bones.find((n) => n.name === '左足IK');
        expect(ikNode).toBeDefined();
        expect(ikNode!.hasIkSolver).toBe(true);
        expect(ikNode!.ikSolverIndex).toBe(3);

        await shutdownBones();
    });

    it('WASM 模式：ikSolverIndex 为负数 → hasIkSolver=false', async () => {
        const parent = makeBone('センター', { ikSolverIndex: -1 });
        const bones: IMmdRuntimeBone[] = [
            parent,
            makeBone('上半身', { parentBone: parent, ikSolverIndex: -1 }),
        ];
        await launchBones(bones);

        const dump = dumpBoneHierarchy(MODEL_ID);
        expect(dump).not.toBeNull();
        for (const node of dump!.bones) {
            expect(node.hasIkSolver).toBe(false);
        }

        await shutdownBones();
    });

    it('JS 模式：ikSolverIndex 为 undefined 但有 ikSolver → hasIkSolver=true', async () => {
        const parent = makeBone('センター', { ikSolverIndex: undefined });
        const solverObj = { solve: () => {} };
        const bones: IMmdRuntimeBone[] = [
            parent,
            makeBone('上半身', { parentBone: parent, ikSolver: solverObj }),
        ];
        await launchBones(bones);

        const dump = dumpBoneHierarchy(MODEL_ID);
        expect(dump).not.toBeNull();
        const centerNode = dump!.bones.find((n) => n.name === 'センター');
        expect(centerNode).toBeDefined();
        expect(centerNode!.hasIkSolver).toBe(false);
        expect(centerNode!.ikSolverIndex).toBeUndefined();

        const bodyNode = dump!.bones.find((n) => n.name === '上半身');
        expect(bodyNode).toBeDefined();
        expect(bodyNode!.hasIkSolver).toBe(true);
        expect(bodyNode!.ikSolverIndex).toBeUndefined();

        await shutdownBones();
    });

    it('两种 IK 标记均缺失 → hasIkSolver=false', async () => {
        const parent = makeBone('センター');
        const bones: IMmdRuntimeBone[] = [
            parent,
            makeBone('左手首', { parentBone: parent }),
        ];
        await launchBones(bones);

        const dump = dumpBoneHierarchy(MODEL_ID);
        expect(dump).not.toBeNull();
        for (const node of dump!.bones) {
            expect(node.hasIkSolver).toBe(false);
        }

        await shutdownBones();
    });
});
