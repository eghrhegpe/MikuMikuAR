// [doc:adr-168] Lighting Follow — 追光 tick 核心逻辑
// 职责: 每帧遍历有 followTarget 的舞台灯，解析目标世界坐标，平滑插值 target/position
// 注册于 initLighting（onBeforeRenderObservable），disposeLighting 时释放。
// 骨骼查找结果缓存于 _boneCache，模型卸载时通过 clearFollowBoneCache 清除。

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import { lightingState, type StageLightEntry } from './lighting-state';
import type { FollowTarget } from './lighting';
import type { ModelInstance } from '@/core/config';
import { logWarn } from '@/core/logger';

// ======== 骨骼缓存（避免每帧 O(n) find） ========

const _boneCache = new Map<string, IMmdRuntimeBone | null>();
/** 已警告过的骨骼缺失 key，避免每帧刷屏 */
const _warnedKeys = new Set<string>();

/** 模型卸载 / 场景销毁时清除骨骼缓存 */
export function clearFollowBoneCache(modelId?: string): void {
    if (modelId) {
        for (const key of _boneCache.keys()) {
            if (key.startsWith(modelId + ':')) {
                _boneCache.delete(key);
                _warnedKeys.delete(key);
            }
        }
    } else {
        _boneCache.clear();
        _warnedKeys.clear();
    }
}

// ======== 模块级临时向量（零 GC） ========

const _worldPos = Vector3.Zero();
const _currentTarget = Vector3.Zero();
const _orbitPos = Vector3.Zero();

// ======== 核心 tick ========

/**
 * 追光逐帧更新。遍历所有绑定 followTarget 的舞台灯：
 * 1. 解析目标世界坐标（骨骼 / 根节点）
 * 2. 平滑插值 target（Lerp with smoothing）
 * 3. 写回 state + 更新灯光方向
 * 4. moveWithTarget 时灯位置跟随（保持轨道偏移）
 */
export function tickFollowLights(): void {
    if (!lightingState.modelRegistry) {
        return;
    }
    for (const [, entry] of lightingState.stageLights) {
        const ft = entry.state.followTarget;
        if (!ft) {
            continue;
        }
        const model = lightingState.modelRegistry.get(ft.modelId);
        if (!model) {
            continue; // 模型已卸载 → 灯保持上次位置（静态回退）
        }
        if (!_resolveFollowWorldPos(model, ft, _worldPos)) {
            continue;
        }

        const smoothing = ft.smoothing;

        // 平滑插值 target
        _currentTarget.set(entry.state.targetX, entry.state.targetY, entry.state.targetZ);
        Vector3.LerpToRef(_currentTarget, _worldPos, smoothing, _currentTarget);

        entry.state.targetX = _currentTarget.x;
        entry.state.targetY = _currentTarget.y;
        entry.state.targetZ = _currentTarget.z;
        _applyTargetToLight(entry);

        // moveWithTarget：灯位置 = 目标 + 轨道偏移
        if (ft.moveWithTarget) {
            _applyOrbitRelativeTo(entry, _currentTarget);
        }
    }
}

// ======== 内部辅助 ========

/** 将 state.targetX/Y/Z 应用到灯光方向（SpotLight / DirectionalLight） */
function _applyTargetToLight(entry: StageLightEntry): void {
    const { state, light } = entry;
    const target = lightingState.tmpTarget;
    target.set(state.targetX, state.targetY, state.targetZ);

    if (state.type === 'spot' && light instanceof SpotLight) {
        light.setDirectionToTarget(target);
    } else if (state.type === 'directional' && light instanceof DirectionalLight) {
        const dir = lightingState.tmpDir;
        target.subtractToRef(light.position, dir);
        if (dir.lengthSquared() > 1e-6) {
            dir.normalize();
            light.direction = dir;
        }
    }
}

/** 灯位置 = center + 轨道球面偏移（moveWithTarget 模式） */
function _applyOrbitRelativeTo(entry: StageLightEntry, center: Vector3): void {
    const { state, light } = entry;
    const az = (state.orbitAzimuth * Math.PI) / 180;
    const el = (state.orbitElevation * Math.PI) / 180;
    const dist = state.orbitDistance;
    _orbitPos.set(
        center.x + dist * Math.cos(el) * Math.sin(az),
        center.y + dist * Math.sin(el),
        center.z + dist * Math.cos(el) * Math.cos(az)
    );
    light.position.copyFrom(_orbitPos);
}

/**
 * 解析跟随目标的世界坐标。
 * boneName=null → 根节点位置 + offset
 * boneName='xxx' → 骨骼世界坐标 + offset（找不到时 fallback 根节点 + warn）
 */
function _resolveFollowWorldPos(
    model: ModelInstance,
    ft: FollowTarget,
    out: Vector3
): boolean {
    if (ft.boneName && model.mmdModel) {
        const bone = _findBoneCached(model, ft.boneName);
        if (bone) {
            bone.getWorldTranslationToRef(out);
            out.x += ft.offset[0];
            out.y += ft.offset[1];
            out.z += ft.offset[2];
            return true;
        }
        // 骨骼未找到 → fallback 根节点（仅首次 warn）
        const warnKey = `${model.id}:${ft.boneName}`;
        if (!_warnedKeys.has(warnKey)) {
            _warnedKeys.add(warnKey);
            logWarn('lighting-follow', `骨骼 "${ft.boneName}" 未找到，回退根节点`);
        }
    }

    // 根节点模式
    const pos = model.rootMesh.getAbsolutePosition();
    out.set(pos.x + ft.offset[0], pos.y + ft.offset[1], pos.z + ft.offset[2]);
    return true;
}

/** 带缓存的骨骼查找（key = modelId:boneName） */
function _findBoneCached(model: ModelInstance, boneName: string): IMmdRuntimeBone | null {
    const key = `${model.id}:${boneName}`;
    if (_boneCache.has(key)) {
        return _boneCache.get(key)!;
    }
    const bones = model.mmdModel?.runtimeBones;
    if (!bones) {
        _boneCache.set(key, null);
        return null;
    }
    const found = bones.find((b) => b.name === boneName) ?? null;
    _boneCache.set(key, found);
    return found;
}
