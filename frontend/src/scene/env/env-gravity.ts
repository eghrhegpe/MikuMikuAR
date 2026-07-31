// [doc:architecture] Env Gravity — 重力强度
// 从 env-bridge.ts 拆出（ADR-148 Phase 5：env-bridge 瘦身）
// 碰撞已迁至 env-collision.ts（ADR-212：命名 vs 功能审计）
// 职责: 重力向量
// 依赖: 无（mmdRuntime 直接访问）

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';

import { triggerAutoSave, mmdRuntime } from '@/core/config';
import { DEFAULT_GRAVITY } from '@/core/ui-constants';

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
