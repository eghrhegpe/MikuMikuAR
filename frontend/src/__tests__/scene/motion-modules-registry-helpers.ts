// motion-modules-registry 拆分共享 helpers（纯数据构造，不 import SUT）
import { shared } from './motion-modules-registry-mocks';

export function makeModel(id: string): any {
    return {
        id,
        name: id,
        motionOverrideModules: undefined as any,
        boneOverrides: [],
    };
}

/** 带骨骼运行时信息的模型（含 IK 目标骨），供 body-posture IK 位置保护测试使用 */
export function makeModelWithBones(id: string): any {
    return {
        ...makeModel(id),
        mmdModel: {
            runtimeBones: [
                { name: 'センター' },
                { name: '上半身' },
                { name: '上半身2' },
                { name: '左足IK' },
                { name: '右足IK' },
                {
                    name: '左腕IK',
                    ikSolver: { solve: () => {} },
                    getWorldTranslationToRef: (ref: any) => { ref.x = 0; ref.y = 0; ref.z = 0; },
                    setWorldTranslation: () => {},
                    linkedBone: { getSkeleton: () => ({ _markAsDirty: () => {} }) },
                },
                {
                    name: '右腕IK',
                    ikSolver: { solve: () => {} },
                    getWorldTranslationToRef: (ref: any) => { ref.x = 0; ref.y = 0; ref.z = 0; },
                    setWorldTranslation: () => {},
                    linkedBone: { getSkeleton: () => ({ _markAsDirty: () => {} }) },
                },
                { name: '左肩' },
                { name: '右肩' },
            ],
        },
    };
}

/** WASM 模式的模型（无 ikSolver 字段，有 ikSolverIndex），供 WASM IK 重解测试 */
export function makeModelWithBonesWasm(id: string): any {
    return {
        ...makeModel(id),
        mmdModel: {
            runtimeBones: [
                { name: 'センター' },
                { name: '上半身' },
                { name: '上半身2' },
                { name: '左足IK' },
                { name: '右足IK' },
                {
                    name: '左腕IK',
                    ikSolverIndex: 0,
                    getWorldTranslationToRef: (ref: any) => { ref.x = 0; ref.y = 0; ref.z = 0; },
                    setWorldTranslation: () => {},
                },
                {
                    name: '右腕IK',
                    ikSolverIndex: 1,
                    getWorldTranslationToRef: (ref: any) => { ref.x = 0; ref.y = 0; ref.z = 0; },
                    setWorldTranslation: () => {},
                },
                { name: '左肩' },
                { name: '右肩' },
            ],
        },
    };
}

// 创建一个带有 motionModules 的 activeMotion
export function setActiveMotionWithModules(vmdPath: string = 'test.vmd'): void {
    shared.mockActiveMotion.value = {
        vmdPath,
        vmdName: 'test',
        vmdLayers: [],
        source: 'vmd',
        motionModules: [],
    };
}
