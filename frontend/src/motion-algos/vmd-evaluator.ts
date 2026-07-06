// [doc:adr-056] VMD 帧求值器 — 给定帧号求值骨骼变换，与 babylon-mmd 同源
// 复用 VmdLoader + BezierInterpolate，不自行解析 VMD 二进制
// 职责: 构建 boneName→track 查找表 + 二分查找 + Slerp/Lerp 求值

import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { VmdLoader } from 'babylon-mmd/esm/Loader/vmdLoader';
import { BezierInterpolate } from 'babylon-mmd/esm/Runtime/Animation/bezierInterpolate';
import type {
    MmdBoneAnimationTrack,
    MmdMovableBoneAnimationTrack,
} from 'babylon-mmd/esm/Loader/Animation/mmdAnimationTrack';
import type { MmdAnimation } from 'babylon-mmd/esm/Loader/Animation/mmdAnimation';

export interface VmdBoneFrame {
    position: Vector3 | null;
    rotation: Quaternion;
}

export interface VmdEvaluator {
    evalBoneFrame(boneName: string, frame: number): VmdBoneFrame | null;
    evalAllBones(frame: number): Map<string, VmdBoneFrame>;
    dispose(): void;
}

class VmdEvaluatorImpl implements VmdEvaluator {
    private _boneMap: Map<string, MmdBoneAnimationTrack | MmdMovableBoneAnimationTrack>;
    private _animation: MmdAnimation | null;
    private _disposed = false;

    constructor(animation: MmdAnimation) {
        this._animation = animation;
        this._boneMap = new Map();
        for (const t of animation.boneTracks) {
            this._boneMap.set(t.name, t);
        }
        for (const t of animation.movableBoneTracks) {
            this._boneMap.set(t.name, t);
        }
    }

    evalBoneFrame(boneName: string, frame: number): VmdBoneFrame | null {
        if (this._disposed) {
            return null;
        }
        const track = this._boneMap.get(boneName);
        if (!track) {
            return null;
        }
        return this._evalTrack(track, frame);
    }

    evalAllBones(frame: number): Map<string, VmdBoneFrame> {
        const result = new Map<string, VmdBoneFrame>();
        if (this._disposed) {
            return result;
        }
        for (const [name, track] of this._boneMap) {
            const v = this._evalTrack(track, frame);
            if (v) {
                result.set(name, v);
            }
        }
        return result;
    }

    dispose(): void {
        this._disposed = true;
        this._boneMap.clear();
        this._animation = null;
    }

    private _evalTrack(
        track: MmdBoneAnimationTrack | MmdMovableBoneAnimationTrack,
        frame: number
    ): VmdBoneFrame | null {
        const frameCount = track.frameNumbers.length;
        if (frameCount === 0) {
            return null;
        }

        if (frameCount === 1) {
            return this._buildFrame(track, 0, null);
        }

        const frames = track.frameNumbers;
        let lo = 0;
        let hi = frameCount;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (frames[mid] <= frame) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        const upperBoundIndex = lo;

        if (upperBoundIndex === 0) {
            return this._buildFrame(track, 0, null);
        }
        if (upperBoundIndex >= frameCount) {
            return this._buildFrame(track, frameCount - 1, null);
        }

        const idxA = upperBoundIndex - 1;
        const idxB = upperBoundIndex;
        const frameA = frames[idxA];
        const frameB = frames[idxB];
        const gradient = (frame - frameA) / (frameB - frameA);

        const rotInterp = (track as MmdBoneAnimationTrack).rotationInterpolations;
        const rotations = (track as MmdBoneAnimationTrack).rotations;
        const weight = BezierInterpolate(
            rotInterp[idxB * 4] / 127,
            rotInterp[idxB * 4 + 1] / 127,
            rotInterp[idxB * 4 + 2] / 127,
            rotInterp[idxB * 4 + 3] / 127,
            gradient
        );
        const rotA = new Quaternion(
            rotations[idxA * 4],
            rotations[idxA * 4 + 1],
            rotations[idxA * 4 + 2],
            rotations[idxA * 4 + 3]
        );
        const rotB = new Quaternion(
            rotations[idxB * 4],
            rotations[idxB * 4 + 1],
            rotations[idxB * 4 + 2],
            rotations[idxB * 4 + 3]
        );
        const rotation = Quaternion.Slerp(rotA, rotB, weight);

        let position: Vector3 | null = null;
        const movable = track as MmdMovableBoneAnimationTrack;
        if (movable.positions !== undefined && movable.positions.length > 0) {
            const posInterp = movable.positionInterpolations;
            const positions = movable.positions;
            const xW = BezierInterpolate(
                posInterp[idxB * 12] / 127,
                posInterp[idxB * 12 + 1] / 127,
                posInterp[idxB * 12 + 2] / 127,
                posInterp[idxB * 12 + 3] / 127,
                gradient
            );
            const yW = BezierInterpolate(
                posInterp[idxB * 12 + 4] / 127,
                posInterp[idxB * 12 + 5] / 127,
                posInterp[idxB * 12 + 6] / 127,
                posInterp[idxB * 12 + 7] / 127,
                gradient
            );
            const zW = BezierInterpolate(
                posInterp[idxB * 12 + 8] / 127,
                posInterp[idxB * 12 + 9] / 127,
                posInterp[idxB * 12 + 10] / 127,
                posInterp[idxB * 12 + 11] / 127,
                gradient
            );
            const pAx = positions[idxA * 3];
            const pAy = positions[idxA * 3 + 1];
            const pAz = positions[idxA * 3 + 2];
            const pBx = positions[idxB * 3];
            const pBy = positions[idxB * 3 + 1];
            const pBz = positions[idxB * 3 + 2];
            position = new Vector3(
                pAx + (pBx - pAx) * xW,
                pAy + (pBy - pAy) * yW,
                pAz + (pBz - pAz) * zW
            );
        }

        return { position, rotation };
    }

    private _buildFrame(
        track: MmdBoneAnimationTrack | MmdMovableBoneAnimationTrack,
        index: number,
        _position: Vector3 | null
    ): VmdBoneFrame {
        const rotations = (track as MmdBoneAnimationTrack).rotations;
        const rotation = new Quaternion(
            rotations[index * 4],
            rotations[index * 4 + 1],
            rotations[index * 4 + 2],
            rotations[index * 4 + 3]
        );
        let position: Vector3 | null = null;
        const movable = track as MmdMovableBoneAnimationTrack;
        if (movable.positions !== undefined && movable.positions.length > 0) {
            position = new Vector3(
                movable.positions[index * 3],
                movable.positions[index * 3 + 1],
                movable.positions[index * 3 + 2]
            );
        }
        return { position, rotation };
    }
}

let _sharedScene: Scene | null = null;
function _getSharedScene(): Scene {
    if (!_sharedScene) {
        const engine = new NullEngine();
        _sharedScene = new Scene(engine);
    }
    return _sharedScene;
}

export async function createVmdEvaluator(data: ArrayBuffer): Promise<VmdEvaluator> {
    if (data.byteLength < 50) {
        throw new Error('VMD buffer too small');
    }
    const loader = new VmdLoader(_getSharedScene());
    const animation = await loader.loadFromBufferAsync('vmd-evaluator', data);
    return new VmdEvaluatorImpl(animation);
}
