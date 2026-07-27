/**
 * minimal-physics-impl.ts — WASM 物理最小初始化工具
 *
 * 在 Node.js 环境下通过 initSync 同步加载 babylon-mmd 的 SPR (Single Physics Release)
 * WASM 模块，无需浏览器 fetch/navigator API。用于物理 API 行为契约测试。
 *
 * 加载链路：
 *   fs.readFileSync(.wasm) → WebAssembly.Module → initSync(module) → init()
 *
 * 使用方式：
 *   import { createMinimalPhysicsImpl } from './helpers/minimal-physics-impl';
 *   const { api, memory } = createMinimalPhysicsImpl();
 *   const world = api.createPhysicsWorld();
 *   // 手动写刚体构造信息到 WASM 内存：
 *   const infoPtr = api.allocateBuffer(144);
 *   new Float32Array(memory.buffer, infoPtr, 36).set([...]);
 *   const body = api.createRigidBody(infoPtr);
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
  '..', '..', '..',
  'node_modules', 'babylon-mmd', 'esm', 'Runtime', 'Optimized', 'wasm', 'spr', 'index_bg.wasm',
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
  if (_initialized && _memory) return { api: sprWasm, memory: _memory };

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