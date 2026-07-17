// [doc:adr-071] 感知层 — 呼吸（躯干骨骼正弦微动）

import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

import { BONE_UPPER_CANDIDATES, matchBone } from '../../motion-algos/proc-motion-shared';
import type { MmdRuntimeBoneExtended } from '@/core/types';
import { _q } from './perception-shared';
import type { MmdModelLike } from './perception-shared';
import { getPerceptionState } from './perception';

// ── 呼吸参数（默认值，实际从 perceptionState 读取） ──
const DEFAULT_BREATH_FREQ = 0.3; // Hz
const DEFAULT_BREATH_AMP = 0.02; // radians

export function _applyBreathing(mmdModel: MmdModelLike, time: number): void {
    const s = getPerceptionState();
    const freq = s.breathFrequency ?? DEFAULT_BREATH_FREQ;
    const amp = s.breathAmplitude ?? DEFAULT_BREATH_AMP;
    const phase = time * freq * 2 * Math.PI;
    const breathOffset = amp * Math.sin(phase);

    const boneNames = mmdModel.runtimeBones.map((b: IMmdRuntimeBone) => b.name);
    const spineName = matchBone(boneNames, BONE_UPPER_CANDIDATES);
    const spine = spineName
        ? mmdModel.runtimeBones.find((b: IMmdRuntimeBone) => b.name === spineName)
        : null;
    if (!spine) {
        return;
    }

    const curQ = spine.linkedBone.rotationQuaternion;
    if (!curQ) {
        return;
    }
    const targetQ = _q().copyFrom(Quaternion.RotationAxis(Vector3.Up(), breathOffset));
    const localQ = _q().copyFrom(curQ);
    Quaternion.SlerpToRef(localQ, targetQ, 0.5, localQ);

    // 写入既有实例，不外泄池引用（与 bone-override.ts 的 .clone() 约定一致）
    curQ.copyFrom(localQ);

    if ('updateWorldMatrix' in spine) {
        (spine as MmdRuntimeBoneExtended).updateWorldMatrix(false, false);
        for (const child of spine.childBones) {
            _updateBoneChain(child);
        }
    }
}

export function _updateBoneChain(bone: IMmdRuntimeBone): void {
    if ('updateWorldMatrix' in bone) {
        (bone as MmdRuntimeBoneExtended).updateWorldMatrix(false, false);
        for (const child of bone.childBones) {
            _updateBoneChain(child);
        }
    }
}
