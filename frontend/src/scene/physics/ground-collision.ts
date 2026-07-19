/**
 * ground-collision.ts — 地面碰撞体（WASM Bullet 静态刚体，全局）
 *
 * 通过 MmdWasmPhysicsRuntimeImpl.addRigidBodyToGlobal 把一块静态地板刚体加入
 * 所有模型的物理世界，使头发/裙子等 Dynamic 刚体在重力下落到地面时获得支撑，
 * 不再无限下坠。由 env-bridge.setGroundCollisionEnabled 驱动；
 * 运行时就绪 / 场景加载后由 applyGroundCollision() 还原持久化状态。
 *
 * 兼容约束（同 virtual-skirt.ts）：
 * - 仅 WASM 运行时生效；JS 运行时无 Bullet 物理，直接空转。
 * - 释放顺序：removeRigidBodyFromGlobal → rb.dispose → info.dispose → shape.dispose
 */
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import { MmdWasmPhysicsRuntimeImpl } from 'babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl';
import { RigidBody } from 'babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBody';
import { RigidBodyConstructionInfo } from 'babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBodyConstructionInfo';
import { PhysicsBoxShape } from 'babylon-mmd/esm/Runtime/Optimized/Physics/Bind/physicsShape';
import { MotionType } from 'babylon-mmd/esm/Runtime/Optimized/Physics/Bind/motionType';
import { envState, mmdRuntime } from '@/core/config';

/** 地板半尺寸（x/z 足够大以覆盖整个场景，y 为厚度一半） */
const GROUND_HALF = new Vector3(2000, 1, 2000);
/** 地面顶部所在世界 Y（MMD 约定模型脚底在 y=0） */
const DEFAULT_GROUND_Y = 0;

/** 当前已注入的全局地面刚体（null = 未启用） */
let _groundBody: RigidBody | null = null;
let _groundInfo: RigidBodyConstructionInfo | null = null;
let _groundShape: PhysicsBoxShape | null = null;

/** 取物理 impl；非 WASM 运行时或 impl 不可用返回 null */
function _getImpl(): MmdWasmPhysicsRuntimeImpl | null {
    if (!(mmdRuntime instanceof MmdWasmRuntime)) {
        return null;
    }
    const physics = (mmdRuntime as unknown as { physics?: { impl?: MmdWasmPhysicsRuntimeImpl } })
        .physics;
    return physics?.impl ?? null;
}

/** 地面碰撞是否处于启用状态 */
export function isGroundCollisionEnabled(): boolean {
    return _groundBody !== null;
}

/**
 * 启用地面碰撞：注入静态地板刚体到所有物理世界。幂等。
 */
export function enableGroundCollision(groundY: number = DEFAULT_GROUND_Y): void {
    const impl = _getImpl();
    if (!impl || _groundBody) {
        return;
    }

    const wasmInstance = impl.wasmInstance;
    const shape = new PhysicsBoxShape(impl, GROUND_HALF);
    const info = new RigidBodyConstructionInfo(wasmInstance);
    info.shape = shape;
    info.motionType = MotionType.Static;
    info.mass = 0;
    // 与所有 MMD 动态刚体（裙/发）碰撞：全组 + 全掩码
    info.collisionGroup = 0xffff;
    info.collisionMask = 0xffff;
    info.friction = 0.9;
    info.restitution = 0;
    // 地板顶面位于 groundY：中心下移 half.y
    info.setInitialTransform(Matrix.Translation(0, groundY - GROUND_HALF.y, 0));

    const body = new RigidBody(impl, info);
    if (!impl.addRigidBodyToGlobal(body)) {
        // 注入失败：释放已分配资源，保持未启用态
        body.dispose();
        info.dispose();
        shape.dispose();
        return;
    }
    _groundBody = body;
    _groundInfo = info;
    _groundShape = shape;
}

/** 禁用地面碰撞：从所有世界移除并释放资源 */
export function disableGroundCollision(): void {
    const impl = _getImpl();
    if (!impl || !_groundBody) {
        return;
    }
    impl.removeRigidBodyFromGlobal(_groundBody);
    _groundBody.dispose();
    _groundInfo?.dispose();
    _groundShape?.dispose();
    _groundBody = null;
    _groundInfo = null;
    _groundShape = null;
}

/** 根据当前 envState 还原地面碰撞状态（运行时就绪 / 场景加载后调用） */
export function applyGroundCollision(): void {
    if (envState.groundCollisionEnabled) {
        enableGroundCollision();
    } else {
        disableGroundCollision();
    }
}
