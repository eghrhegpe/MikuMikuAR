// [doc:architecture] Env Collision — 碰撞开关（WASM Bullet）
// 从 env-gravity.ts 拆出（ADR-212：命名 vs 功能审计）
// 职责: 碰撞总开关、身体碰撞开关、地面碰撞开关
// 依赖: env-bridge.setEnvState（单向）

import { envState, triggerAutoSave } from '@/core/config';
import { applyGroundCollision } from '../physics/ground-collision';
import { setEnvState } from './_bridge/env-bridge';

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
