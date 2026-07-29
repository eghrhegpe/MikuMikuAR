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
