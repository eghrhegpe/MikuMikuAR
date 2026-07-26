// [doc:architecture] Env Gravity & Collision — 重力强度与碰撞开关
// 从 env-bridge.ts 拆出（ADR-148 Phase 5：env-bridge 瘦身）
// 职责: 重力向量、碰撞总开关、身体/地面碰撞开关
// 依赖: env-bridge.setEnvState（单向）

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';

import { envState, triggerAutoSave, mmdRuntime } from '@/core/config';
import { DEFAULT_GRAVITY } from '@/core/ui-constants';
import { applyGroundCollision } from '../physics/ground-collision';
import { setEnvState } from './env-bridge';

// ======== Gravity ========

let _gravityStrength = 1.0;
const _gravityVec = new Vector3(0, DEFAULT_GRAVITY, 0);

export function setGravityStrength(value: number): void {
    _gravityStrength = Math.max(0, Math.min(2, value));
    _gravityVec.y = DEFAULT_GRAVITY * _gravityStrength;
    // physics 是 WASM 版专属 API，JS 版无物理，instanceof 守卫后访问
    if (mmdRuntime instanceof MmdWasmRuntime && mmdRuntime.physics) {
        mmdRuntime.physics.setGravity(_gravityVec);
    }
    triggerAutoSave();
}

export function getGravityStrength(): number {
    return _gravityStrength;
}

// ======== Collision (WASM Bullet) ========

export function setCollisionEnabled(value: boolean): void {
    setEnvState({ collisionEnabled: value }, true);
    triggerAutoSave();
}

export function getCollisionEnabled(): boolean {
    return envState.collisionEnabled;
}

export function setBodyCollisionEnabled(value: boolean): void {
    setEnvState({ bodyCollisionEnabled: value }, true);
    triggerAutoSave();
}

export function getBodyCollisionEnabled(): boolean {
    return envState.bodyCollisionEnabled;
}

export function setGroundCollisionEnabled(value: boolean): void {
    if (envState.groundCollisionEnabled === value) {
        return;
    }
    setEnvState({ groundCollisionEnabled: value }, true);
    applyGroundCollision();
    triggerAutoSave();
}

export function getGroundCollisionEnabled(): boolean {
    return envState.groundCollisionEnabled;
}
