// POC: 验证 babylon-mmd 是否暴露可被 mesh.attachToBone 接受的原生 Babylon Bone
// 背景: ADR-061 风险1（最高）。用真实 @babylonjs/core(NullEngine) + 真实 babylon-mmd 加载一个 PMX，
//       实证三件事：
//       1) runtimeBone.linkedBone 是否为 Babylon Bone 实例（attachToBone 的类型前提）
//       2) mmd runtime 覆盖 _computeTransformMatrices 后，linkedBone.getFinalMatrix() 是否仍为最新世界矩阵
//       3) mesh.attachToBone(linkedBone, rootMesh) 是否能跟随骨骼/模型变换
//
// 运行: cd frontend && node scripts/poc-mmd-bone-attachment.mjs [pmx路径]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
// side-effect: 注册 .pmx / .pmd 加载器
import 'babylon-mmd/esm/Loader/pmxLoader.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Bone } from '@babylonjs/core/Bones/bone.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { MmdRuntime } from 'babylon-mmd/esm/Runtime/mmdRuntime.js';

function resolveDefaultPmx() {
  const root = join(process.cwd(), '..', 'text-model', 'PMX');
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        const r = walk(p);
        if (r) return r;
      } else if (e.endsWith('.pmx')) return p;
    }
    return null;
  };
  try { return walk(root); } catch { return null; }
}

const pmxPath = process.argv[2] || resolveDefaultPmx();
if (!pmxPath) { console.error('[POC] 未找到 PMX 夹具，请传路径'); process.exit(2); }
console.log('[POC] PMX =', pmxPath);

const engine = new NullEngine();
const scene = new Scene(engine);
new FreeCamera('poc-cam', new Vector3(0, 5, -20), scene); // NullEngine 渲染需相机
const runtime = new MmdRuntime();

const buf = readFileSync(pmxPath);
const result = await ImportMeshAsync(buf, scene, { pluginExtension: '.pmx' });
const meshes = result.meshes.filter((m) => m instanceof Mesh);
if (meshes.length === 0) { console.error('[POC] 未加载到 Mesh'); process.exit(3); }
const rootMesh = meshes[0];
console.log('[POC] 加载 Mesh 数 =', meshes.length, 'name =', rootMesh.name);

let model;
try {
  model = runtime.createMmdModel(rootMesh);
  runtime.register(scene); // 挂到 scene.render() 自动更新骨骼
} catch (e) {
  console.error('[POC] createMmdModel 失败:', e?.message || e);
  process.exit(4);
}

// --- 检查 1: linkedBone 是否为 Babylon Bone ---
const rb0 = model.runtimeBones[0];
const linked = rb0.linkedBone;
const isRealBone = linked instanceof Bone;
console.log(`[POC] 检查1 runtimeBone[0].name=${rb0.name} linkedBone instanceof Bone = ${isRealBone}`);
console.log(`[POC]   model.skeleton.bones[0] instanceof Bone = ${model.skeleton.bones[0] instanceof Bone}`);
console.log(`[POC]   runtimeBones 总数 = ${model.runtimeBones.length}, skeleton.bones 总数 = ${model.skeleton.bones.length}`);

// --- 跑几帧，刷新骨骼世界矩阵 ---
for (let i = 0; i < 3; i++) { scene.render(); scene.render(); }

// --- 检查 2: getFinalMatrix 是否新鲜（与 runtimeBone.getWorldMatrixToRef 对比）---
const mRuntime = new Matrix();
const mFinal = new Matrix();
let maxDiff = 0;
let checked = 0;
for (let i = 0; i < Math.min(model.runtimeBones.length, 30); i++) {
  const rb = model.runtimeBones[i];
  if (!(rb.linkedBone instanceof Bone)) continue;
  rb.getWorldMatrixToRef(mRuntime);
  mFinal.copyFrom(rb.linkedBone.getFinalMatrix());
  const d = Math.max(
    Math.abs(mRuntime.m[12] - mFinal.m[12]),
    Math.abs(mRuntime.m[13] - mFinal.m[13]),
    Math.abs(mRuntime.m[14] - mFinal.m[14]),
  );
  if (d > maxDiff) maxDiff = d;
  checked++;
}
console.log(`[POC] 检查2 对比 ${checked} 根骨骼 worldMatrix 平移最大偏差 = ${maxDiff.toFixed(6)} (≈0 表示 getFinalMatrix 新鲜)`);
const finalFresh = maxDiff < 1e-3;

// --- 检查 3: attachToBone 是否跟随 ---
const probe = new TransformNode('probe', scene);
probe.attachToBone(linked, rootMesh);

const probePos = () => new Vector3(probe.getWorldMatrix().m[12], probe.getWorldMatrix().m[13], probe.getWorldMatrix().m[14]);
// attachToBone 内部的世界矩阵 = rootMesh世界矩阵 * bone.getFinalMatrix()（骨骼局部空间）
// 据此推算骨骼世界位置，与探针世界位置对齐比较
const boneWorldPos = () => {
  const lm = linked.getFinalMatrix();
  const localT = new Vector3(lm.m[12], lm.m[13], lm.m[14]);
  return Vector3.TransformCoordinates(localT, rootMesh.getWorldMatrix());
};

for (let i = 0; i < 3; i++) { scene.render(); scene.render(); }
const probeBefore = probePos();
const boneBefore = boneWorldPos();
const attachAccurate = Vector3.Distance(probeBefore, boneBefore) < 1e-2;
console.log(`[POC] 检查3a attachToBone 取到的骨骼位置 = (${probeBefore.x.toFixed(3)}, ${probeBefore.y.toFixed(3)}, ${probeBefore.z.toFixed(3)})`);
console.log(`[POC]   骨骼世界矩阵平移(getFinalMatrix) = (${boneBefore.x.toFixed(3)}, ${boneBefore.y.toFixed(3)}, ${boneBefore.z.toFixed(3)})`);
console.log(`[POC]   attachToBone 读到了正确骨骼矩阵 = ${attachAccurate}`);

// 移动根节点，验证探针跟随（探针世界位置应随 root +5 同步移动）
rootMesh.position.y += 5;
for (let i = 0; i < 3; i++) { scene.render(); scene.render(); }
const probeAfter = probePos();
const boneAfter = boneWorldPos();
const follows = Math.abs((probeAfter.y - probeBefore.y) - 5) < 1e-2 && Vector3.Distance(probeAfter, boneAfter) < 1e-2;
console.log(`[POC] 检查3b 根节点 +5 后 探针 y 增量 = ${(probeAfter.y - probeBefore.y).toFixed(3)}, 骨骼 y 增量 = ${(boneAfter.y - boneBefore.y).toFixed(3)}`);
console.log(`[POC]   attachToBone 跟随模型变换 = ${follows}`);

// --- 结论 ---
const tracked = attachAccurate && follows;
console.log('\n========== POC 结论 ==========');
console.log(`检查1 原生Bone暴露        : ${isRealBone ? 'PASS' : 'FAIL'}`);
console.log(`检查2 getFinalMatrix新鲜  : ${finalFresh ? 'PASS (偏差 ' + maxDiff.toFixed(4) + ')' : 'FAIL (偏差 ' + maxDiff.toFixed(4) + ')'}`);
console.log(`检查3 attachToBone正确跟随: ${tracked ? 'PASS' : 'FAIL'}`);
const gate = isRealBone && finalFresh && tracked;
console.log(`风险1 POC 闸门 : ${gate ? 'PASS — Accessory(2.4)/MotionOverride(2.1) 无需桥接层，可直接用 linkedBone' : 'NEEDS-BRIDGE — 需从 babylon-mmd 运行时提取变换矩阵手动父子链接'}`);
process.exit(gate ? 0 : 1);
