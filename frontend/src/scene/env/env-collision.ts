// [doc:architecture] Env Collision — 碰撞开关（WASM Bullet）
// 从 env-gravity.ts 拆出（ADR-212：命名 vs 功能审计）
// 职责: 碰撞总开关、身体碰撞开关、地面碰撞开关
// 依赖: env-bridge.setEnvState（单向）

import { envState, triggerAutoSave } from '@/core/config';
import { applyGroundCollision } from '../physics/ground-collision';
import { setEnvState } from './_bridge/env-bridge';

// ======== Collision (WASM Bullet) ========
// 字段语义：
// - collisionEnabled      碰撞总开关（round-12 P2 已接线：总开关关闭时地面碰撞一并禁用，
//                         见 ground-collision.applyGroundCollision）
// - groundCollisionEnabled 地面碰撞开关（注入静态地板刚体，见 ground-collision.ts）
// - bodyCollisionEnabled  身体碰撞开关 —— ⚠️ 预留字段：目前无模型身体刚体碰撞实现，
//                         写状态 + 触发 'collision' group dispatch 但不产生物理效果。
//                         等接入 per-body collisionGroup 控制后再实现，勿误以为已生效。

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
