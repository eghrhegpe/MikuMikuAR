// [doc:architecture] Camera Bone Lock — 轨道相机骨骼锁定
// 从 camera.ts 拆出（ADR-148 阶段 3：camera.ts 瘦身）
// 职责: 启用/禁用骨骼锁定、每帧 target 跟随、阻尼参数管理
// 依赖: camera-state（scene 引用/camera 引用）+ observer-handle

import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

import { clamp } from '@/core/utils';
import { focusedModelId, modelRegistry } from '@/core/config';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { safeDispose } from '@/core/dispose-helpers';
import {
    getCameraMode,
    getCameraScene,
    getCurrentCamera,
} from './camera-state';

// ======== Bone Lock — 轨道相机锁定到骨骼 ========
// 启用时：每帧将相机 target 设为目标骨骼的世界位置，同时禁用平移。
// 用户仍可围绕骨骼旋转（alpha/beta）和缩放（radius），但无法将相机拖走。

let _boneLockEnabled = false;
let _boneLockBoneName: string | null = null;
let _boneLockModelId: string | null = null;
// 可复用临时向量，避免每帧 new Vector3
const _boneLockTempVec = new Vector3(0, 0, 0);
// 锁定前保存原始平移灵敏度/惯性用于恢复
let _savedPanningSensibility = 50;
let _savedInertia = 0.9;
// 骨骼锁定跟随阻尼：0 = 刚性精确跟随，越大越平滑（滞后）。仅对位移做 lerp。
let _boneLockDamping = 0;
let _boneLockUpdateHandle: ObserverHandle | null = null;

/** 启用/禁用轨道相机骨骼锁定。启用后相机 target 每帧锁定到指定骨骼的世界位置。 */
export function setOrbitBoneLock(enabled: boolean, boneName?: string): void {
    if (enabled && boneName && focusedModelId) {
        _boneLockEnabled = true;
        _boneLockBoneName = boneName;
        _boneLockModelId = focusedModelId;
        _startBoneLock();
    } else {
        _boneLockEnabled = false;
        _boneLockBoneName = null;
        _boneLockModelId = null;
        _stopBoneLock();
    }
}

/** 获取当前骨骼锁定状态。 */
export function getOrbitBoneLock(): { enabled: boolean; boneName: string | null } {
    return { enabled: _boneLockEnabled, boneName: _boneLockBoneName };
}

/** 获取骨骼锁定跟随阻尼（0 = 刚性，越大越平滑）。 */
export function getBoneLockDamping(): number {
    return _boneLockDamping;
}

/** 设置骨骼锁定跟随阻尼，范围 [0, 0.95]。 */
export function setBoneLockDamping(v: number): void {
    _boneLockDamping = clamp(v, 0, 0.95);
}

/** 获取当前焦点模型的所有骨骼名称列表。 */
export function getFocusedModelBoneNames(): string[] {
    const id = focusedModelId;
    if (!id) {
        return [];
    }
    const inst = modelRegistry.get(id);
    return inst?.mmdModel?.runtimeBones.map((b) => b.name) ?? [];
}

/** 供 camera.ts switchCameraMode 切出 orbit 时调用，强制停止骨骼锁定（保留启用状态供切回恢复）。 */
export function stopBoneLock(): void {
    _stopBoneLock();
}

/**
 * 切回 orbit 时由 camera.ts switchCameraMode 调用：若骨骼锁仍处于启用状态，
 * 重启每帧跟随 observer。修复"切出 orbit → stopBoneLock dispose observer →
 * 切回 orbit → observer 未重建导致假启用"的缺陷。
 *
 * 注意：仅重启 observer，不重新保存 panning/inertia（_startBoneLock 内部会处理）。
 * 若用户显式 setOrbitBoneLock(false) 关闭，_boneLockEnabled 已被置 false，此函数为 no-op。
 */
export function restoreBoneLockIfEnabled(): void {
    if (_boneLockEnabled && _boneLockBoneName && _boneLockModelId) {
        _startBoneLock();
    }
}

function _startBoneLock(): void {
    const scene = getCameraScene();
    if (!scene) {
        return;
    }
    _stopBoneLock();

    // 保存并禁用平移 + 惯性
    const boneLockCam = getCurrentCamera();
    if (boneLockCam instanceof ArcRotateCamera) {
        _savedPanningSensibility = boneLockCam.panningSensibility;
        boneLockCam.panningSensibility = 0; // 0 = 完全禁用平移
        _savedInertia = boneLockCam.inertia;
        boneLockCam.inertia = 0; // 关闭惯性，避免与每帧 target 跟随冲突
    }

    _boneLockUpdateHandle = observe(scene.onBeforeRenderObservable, () => {
        if (!_boneLockEnabled || !_boneLockBoneName || !_boneLockModelId) {
            return;
        }
        // 仅 orbit 模式生效
        if (getCameraMode() !== 'orbit') {
            return;
        }
        const cam = getCurrentCamera();
        if (!(cam instanceof ArcRotateCamera)) {
            return;
        }

        const inst = modelRegistry.get(_boneLockModelId);
        if (!inst?.mmdModel) {
            return;
        }

        const bone = inst.mmdModel.runtimeBones.find(
            (b: { name: string; worldMatrix: Float32Array }) => b.name === _boneLockBoneName
        );
        if (!bone) {
            return;
        }

        // 从 worldMatrix（列主序 Float32Array[16]）提取骨骼世界平移，已含模型根变换
        if (bone.worldMatrix) {
            _boneLockTempVec.set(bone.worldMatrix[12], bone.worldMatrix[13], bone.worldMatrix[14]);

            // 刚性跟随：保持相机当前视角（alpha/beta/radius 不变），将 target 与 position
            // 按同一位移量一起平移到骨骼。避免 setTarget 每帧 rebuildAnglesAndRadius 重算朝向，
            // 否则会与相机惯性拉扯导致焦点左右漂移。
            const delta = _boneLockTempVec.subtract(cam.target);
            // 跟随阻尼：k=1 刚性精确跟随；k<1 平滑滞后。仅对位移 lerp，不改变视角（alpha/beta/radius）。
            const k = 1 - _boneLockDamping;
            delta.scaleInPlace(k);
            cam.target.addInPlace(delta);
            cam.position.addInPlace(delta);
        }
    });
}

function _stopBoneLock(): void {
    if (_boneLockUpdateHandle) {
        _boneLockUpdateHandle = safeDispose(_boneLockUpdateHandle);
    }
    // 恢复平移灵敏度与惯性
    const boneLockCam = getCurrentCamera();
    if (boneLockCam instanceof ArcRotateCamera) {
        boneLockCam.panningSensibility = _savedPanningSensibility;
        boneLockCam.inertia = _savedInertia;
    }
}
