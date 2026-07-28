/**
 * minimal-physics-impl.ts — WASM 物理最小初始化工具 + 共享测试辅助函数
 *
 * 在 Node.js 环境下通过 initSync 同步加载 babylon-mmd 的 SPR (Single Physics Release)
 * WASM 模块，无需浏览器 fetch/navigator API。用于物理 API 行为契约测试。
 *
 * 加载链路：
 *   fs.readFileSync(.wasm) → WebAssembly.Module → initSync(module) → init()
 *
 * 辅助函数：
 *   共享的 RigidBodyConstructionInfo 构造/读取函数，避免 physics-contract.test.ts
 *   和 wind-physics-integration.test.ts 重复定义。
 *
 * 使用方式：
 *   import { createMinimalPhysicsImpl, buildRigidBodyInfo, readLinearVelocity } from './helpers/minimal-physics-impl';
 *   const phys = createMinimalPhysicsImpl();
 *   const shape = phys.api.createBoxShape(1, 1, 1);
 *   const infoPtr = buildRigidBodyInfo(phys, shape, { mass: 1.0 });
 *   const body = phys.api.createRigidBody(infoPtr);
 */

import fs from 'fs';
import path from 'path';

// initSync + init 从 babylon-mmd SPR 模块导入
// 注意：这是同步路径，不触发 fetch / navigator.hardwareConcurrency
import { initSync, init } from 'babylon-mmd/esm/Runtime/Optimized/wasm/spr';

// 导入整个 wasm 模块命名空间以访问所有导出的物理 API
import * as sprWasm from 'babylon-mmd/esm/Runtime/Optimized/wasm/spr';

const WASM_PATH = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'node_modules',
    'babylon-mmd',
    'esm',
    'Runtime',
    'Optimized',
    'wasm',
    'spr',
    'index_bg.wasm'
);

let _initialized = false;
let _memory: WebAssembly.Memory | null = null;

export interface MinimalPhysicsImpl {
    /** WASM 物理 API 命名空间（createPhysicsWorld, createBoxShape 等） */
    api: typeof sprWasm;
    /** WASM 线性内存，用于手动读写刚体构造信息等 */
    memory: WebAssembly.Memory;
}

/**
 * 创建最小物理世界，返回 WASM API 命名空间 + 内存引用。
 * 幂等：多次调用返回同一实例。
 */
export function createMinimalPhysicsImpl(): MinimalPhysicsImpl {
    if (_initialized && _memory) {
        return { api: sprWasm, memory: _memory };
    }

    const wasmBuffer = fs.readFileSync(WASM_PATH);
    const module = new WebAssembly.Module(wasmBuffer);
    const output = initSync({ module });
    init();

    _initialized = true;
    _memory = output.memory;
    return { api: sprWasm, memory: output.memory };
}

/**
 * 重置初始化状态（测试清理用）。
 * 注意：WASM 模块本身无法卸载，此函数仅重置内部标志。
 */
export function resetMinimalPhysicsImpl(): void {
    _initialized = false;
    _memory = null;
}

// ============================================================================
// 共享辅助函数 — RigidBodyConstructionInfo 手动构造 / 速度读取
// ============================================================================

/** RigidBodyConstructionInfo 大小（字节） */
export const PHYSICS_INFO_SIZE = 144;

/** 刚体构造信息偏移量 */
export const PHYSICS_OFF = {
    Shape: 0, // uint32
    InitialTransform: 16, // float32[16]
    DataMask: 80, // uint16
    MotionType: 82, // uint8
    Mass: 84, // float32
    LocalInertia: 88, // float32[3]
    LinearDamping: 100, // float32
    AngularDamping: 104, // float32
    Friction: 108, // float32
    Restitution: 112, // float32
    LinearSleepingThreshold: 116, // float32
    AngularSleepingThreshold: 120, // float32
    CollisionGroup: 124, // uint16
    CollisionMask: 126, // uint16
    AdditionalDamping: 128, // uint8
    NoContactResponse: 129, // uint8
    DisableDeactivation: 130, // uint8
} as const;

/**
 * 在 WASM 内存中手动构造一个 RigidBodyConstructionInfo。
 * 返回 info 指针（调用方负责 deallocateBuffer）。
 */
export function buildRigidBodyInfo(
    { api, memory }: MinimalPhysicsImpl,
    shapePtr: number,
    overrides?: { mass?: number; disableDeactivation?: boolean; motionType?: number }
): number {
    const SZ = PHYSICS_INFO_SIZE;
    const infoPtr = api.allocateBuffer(SZ);
    const buf = new DataView(memory.buffer, infoPtr, SZ);

    buf.setUint32(PHYSICS_OFF.Shape, shapePtr, true);

    const tf = new Float32Array(memory.buffer, infoPtr + PHYSICS_OFF.InitialTransform, 16);
    tf[0] = 1;
    tf[1] = 0;
    tf[2] = 0;
    tf[3] = 0;
    tf[4] = 0;
    tf[5] = 1;
    tf[6] = 0;
    tf[7] = 0;
    tf[8] = 0;
    tf[9] = 0;
    tf[10] = 1;
    tf[11] = 0;
    tf[12] = 0;
    tf[13] = 0;
    tf[14] = 0;
    tf[15] = 1;

    buf.setUint16(PHYSICS_OFF.DataMask, 0, true);
    buf.setUint8(PHYSICS_OFF.MotionType, overrides?.motionType ?? 0);
    buf.setFloat32(PHYSICS_OFF.Mass, overrides?.mass ?? 1.0, true);
    buf.setFloat32(PHYSICS_OFF.LinearDamping, 0.0, true);
    buf.setFloat32(PHYSICS_OFF.AngularDamping, 0.0, true);
    buf.setFloat32(PHYSICS_OFF.Friction, 0.5, true);
    buf.setFloat32(PHYSICS_OFF.Restitution, 0.0, true);
    buf.setFloat32(PHYSICS_OFF.LinearSleepingThreshold, 0.0, true);
    buf.setFloat32(PHYSICS_OFF.AngularSleepingThreshold, 1.0, true);
    buf.setUint16(PHYSICS_OFF.CollisionGroup, 1, true);
    buf.setUint16(PHYSICS_OFF.CollisionMask, 0xffff, true);
    buf.setUint8(PHYSICS_OFF.AdditionalDamping, 0);
    buf.setUint8(PHYSICS_OFF.NoContactResponse, 0);
    buf.setUint8(PHYSICS_OFF.DisableDeactivation, overrides?.disableDeactivation ? 1 : 0);

    return infoPtr;
}

/**
 * 在 WASM 内存中构造 count 个连续的 RigidBodyConstructionInfo，
 * 返回 info 列表指针（调用方负责 deallocateBuffer）。
 * 所有刚体共用同一个形状，但可指定不同质量。
 */
export function buildBundleInfoList(
    { api, memory }: MinimalPhysicsImpl,
    shapePtr: number,
    count: number,
    masses?: number[]
): number {
    const SZ = PHYSICS_INFO_SIZE;
    const totalSize = SZ * count;
    const listPtr = api.allocateBuffer(totalSize);

    for (let i = 0; i < count; i++) {
        const offset = i * SZ;
        const buf = new DataView(memory.buffer, listPtr + offset, SZ);

        buf.setUint32(PHYSICS_OFF.Shape, shapePtr, true);

        const tf = new Float32Array(
            memory.buffer,
            listPtr + offset + PHYSICS_OFF.InitialTransform,
            16
        );
        tf[0] = 1;
        tf[1] = 0;
        tf[2] = 0;
        tf[3] = 0;
        tf[4] = 0;
        tf[5] = 1;
        tf[6] = 0;
        tf[7] = 0;
        tf[8] = 0;
        tf[9] = 0;
        tf[10] = 1;
        tf[11] = 0;
        tf[12] = 0;
        tf[13] = 0;
        tf[14] = 0;
        tf[15] = 1;

        buf.setUint16(PHYSICS_OFF.DataMask, 0, true);
        buf.setUint8(PHYSICS_OFF.MotionType, 0); // Dynamic

        const mass = masses?.[i] ?? 1.0;
        buf.setFloat32(PHYSICS_OFF.Mass, mass, true);
        buf.setFloat32(PHYSICS_OFF.LinearDamping, 0.0, true);
        buf.setFloat32(PHYSICS_OFF.AngularDamping, 0.0, true);
        buf.setFloat32(PHYSICS_OFF.Friction, 0.5, true);
        buf.setFloat32(PHYSICS_OFF.Restitution, 0.0, true);
        buf.setFloat32(PHYSICS_OFF.LinearSleepingThreshold, 0.0, true);
        buf.setFloat32(PHYSICS_OFF.AngularSleepingThreshold, 1.0, true);
        buf.setUint16(PHYSICS_OFF.CollisionGroup, 1, true);
        buf.setUint16(PHYSICS_OFF.CollisionMask, 0xffff, true);
        buf.setUint8(PHYSICS_OFF.AdditionalDamping, 0);
        buf.setUint8(PHYSICS_OFF.NoContactResponse, 0);
        buf.setUint8(PHYSICS_OFF.DisableDeactivation, 1); // 始终禁用休眠，避免测试不稳定
    }

    return listPtr;
}

/** 读取单数刚体线速度（返回 [vx, vy, vz]） */
export function readLinearVelocity(
    { api, memory }: MinimalPhysicsImpl,
    bodyPtr: number
): [number, number, number] {
    const outPtr = api.allocateBuffer(12);
    try {
        api.rigidBodyGetLinearVelocity(bodyPtr, outPtr);
        const view = new Float32Array(memory.buffer, outPtr, 3);
        return [view[0], view[1], view[2]];
    } finally {
        api.deallocateBuffer(outPtr, 12);
    }
}

/** 读取 bundle 中第 index 个刚体的线速度（返回 [vx, vy, vz]） */
export function readBundleLinearVelocity(
    { api, memory }: MinimalPhysicsImpl,
    bundlePtr: number,
    index: number
): [number, number, number] {
    const outPtr = api.allocateBuffer(12);
    try {
        api.rigidBodyBundleGetLinearVelocity(bundlePtr, index, outPtr);
        const view = new Float32Array(memory.buffer, outPtr, 3);
        return [view[0], view[1], view[2]];
    } finally {
        api.deallocateBuffer(outPtr, 12);
    }
}
