// [doc:adr-071] 感知层 — 呼吸（躯干骨骼正弦微动）

import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

import {
    BONE_UPPER_CANDIDATES,
    matchBone,
} from '../../motion-algos/proc-motion-shared';
import type { MmdRuntimeBoneExtended } from '@/core/types';
import { _q } from './perception-shared';

// ── 呼吸参数 ──
const BREATH_FREQ = 0.3; // Hz
const BREATH_AMP = 0.02; // radians

export function _applyBreathing(mmdModel: any, time: number): void {
    const phase = time * BREATH_FREQ * 2 * Math.PI;
    const breathOffset = BREATH_AMP * Math.sin(phase);

    const boneNames = mmdModel.runtimeBones.map((b: IMmdRuntimeBone) => b.name);
    const spineName = matchBone(boneNames, BONE_UPPER_CANDIDATES);
    const spine = spineName
        ? mmdModel.runtimeBones.find((b: IMmdRuntimeBone) => b.name === spineName)
        : null;
    if (!spine) {
        return;
    }

    const targetQ = _q().copyFrom(Quaternion.RotationAxis(Vector3.Up(), breathOffset));
    const localQ = _q().copyFrom(spine.linkedBone.rotationQuaternion);
    Quaternion.SlerpToRef(localQ, targetQ, 0.5, localQ);

    spine.linkedBone.rotationQuaternion = localQ;

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
