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
    // 分离两个 Map，消除运行时类型断言
    private _boneMap: Map<string, MmdBoneAnimationTrack>;
    private _movableBoneMap: Map<string, MmdMovableBoneAnimationTrack>;
    private _animation: MmdAnimation | null;
    private _disposed = false;

    constructor(animation: MmdAnimation) {
        this._animation = animation;
        this._boneMap = new Map();
        for (const t of animation.boneTracks) {
            this._boneMap.set(t.name, t);
        }
        this._movableBoneMap = new Map();
        for (const t of animation.movableBoneTracks) {
            this._movableBoneMap.set(t.name, t);
        }
    }

    evalBoneFrame(boneName: string, frame: number): VmdBoneFrame | null {
        if (this._disposed) {
            return null;
        }
        const track = this._boneMap.get(boneName);
        if (track) {
            return this._evalBoneTrack(track, frame);
        }
        const movable = this._movableBoneMap.get(boneName);
        if (movable) {
            return this._evalMovableTrack(movable, frame);
        }
        return null;
    }

    evalAllBones(frame: number): Map<string, VmdBoneFrame> {
        const result = new Map<string, VmdBoneFrame>();
        if (this._disposed) {
            return result;
        }
        for (const [name, track] of this._boneMap) {
            const v = this._evalBoneTrack(track, frame);
            if (v) {
                result.set(name, v);
            }
        }
        for (const [name, track] of this._movableBoneMap) {
            const v = this._evalMovableTrack(track, frame);
            if (v) {
                result.set(name, v);
            }
        }
        return result;
    }

    dispose(): void {
        this._disposed = true;
        this._boneMap.clear();
        this._movableBoneMap.clear();
        this._animation = null;
    }

    /** 纯旋转骨骼轨道（二分 + Slerp） */
    private _evalBoneTrack(
        track: MmdBoneAnimationTrack,
        frame: number
    ): VmdBoneFrame | null {
        const frameCount = track.frameNumbers.length;
        if (frameCount === 0) {
            return null;
        }
        if (frameCount === 1) {
            return this._buildBoneFrame(track, 0);
        }

        const idx = this._upperBound(track.frameNumbers, frame);
        if (idx === 0) {
            return this._buildBoneFrame(track, 0);
        }
        if (idx >= frameCount) {
            return this._buildBoneFrame(track, frameCount - 1);
        }

        const idxA = idx - 1;
        const idxB = idx;
        const frameA = track.frameNumbers[idxA];
        const frameB = track.frameNumbers[idxB];
        const gradient = (frame - frameA) / (frameB - frameA);

        const rotInterp = track.rotationInterpolations;
        const rotations = track.rotations;
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
        return { position: null, rotation: Quaternion.Slerp(rotA, rotB, weight) };
    }

    /** 可移动骨骼轨道（二分 + Slerp + Lerp 位置） */
    private _evalMovableTrack(
        track: MmdMovableBoneAnimationTrack,
        frame: number
    ): VmdBoneFrame | null {
        const frameCount = track.frameNumbers.length;
        if (frameCount === 0) {
            return null;
        }
        if (frameCount === 1) {
            return this._buildMovableFrame(track, 0);
        }

        const idx = this._upperBound(track.frameNumbers, frame);
        if (idx === 0) {
            return this._buildMovableFrame(track, 0);
        }
        if (idx >= frameCount) {
            return this._buildMovableFrame(track, frameCount - 1);
        }

        const idxA = idx - 1;
        const idxB = idx;
        const frameA = track.frameNumbers[idxA];
        const frameB = track.frameNumbers[idxB];
        const gradient = (frame - frameA) / (frameB - frameA);

        // 旋转插值（两个类型都有）
        const rotInterp = track.rotationInterpolations;
        const rotations = track.rotations;
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

        // 位置插值（仅 movable 有）
        const posInterp = track.positionInterpolations;
        const positions = track.positions;
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
        const position = new Vector3(
            pAx + (pBx - pAx) * xW,
            pAy + (pBy - pAy) * yW,
            pAz + (pBz - pAz) * zW
        );

        return { position, rotation };
    }

    private _upperBound(sorted: ArrayLike<number>, target: number): number {
        let lo = 0;
        let hi = sorted.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (sorted[mid] <= target) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    private _buildBoneFrame(track: MmdBoneAnimationTrack, index: number): VmdBoneFrame {
        const rotations = track.rotations;
        return {
            position: null,
            rotation: new Quaternion(
                rotations[index * 4],
                rotations[index * 4 + 1],
                rotations[index * 4 + 2],
                rotations[index * 4 + 3]
            ),
        };
    }

    private _buildMovableFrame(track: MmdMovableBoneAnimationTrack, index: number): VmdBoneFrame {
        const rotations = track.rotations;
        const positions = track.positions;
        return {
            position: new Vector3(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]),
            rotation: new Quaternion(
                rotations[index * 4],
                rotations[index * 4 + 1],
                rotations[index * 4 + 2],
                rotations[index * 4 + 3]
            ),
        };
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

/**
 * 释放共享 Scene 资源。
 * 应用关闭时调用，防止 NullEngine 泄漏。
 */
export function shutdownVmdEvaluator(): void {
    if (_sharedScene) {
        _sharedScene.dispose();
        _sharedScene = null;
    }
}
