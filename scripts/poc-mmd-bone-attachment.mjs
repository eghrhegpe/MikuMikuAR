/**
 * poc-mmd-bone-attachment.mjs — POC: 验证 babylon-mmd 是否暴露可被 mesh.attachToBone 接受的原生 Babylon Bone
 *
 * 设计意图：POC: 验证 babylon-mmd 是否暴露可被 mesh.attachToBone 接受的原生 Babylon Bone
 *
 * 依赖：node:fs / node:path / @babylonjs/core/Engines/nullEngine / @babylonjs/core/scene / @babylonjs/core/Bones/bone / @babylonjs/core/Maths/math.vector / @babylonjs/core/Meshes/mesh / @babylonjs/core/Meshes/transformNode / @babylonjs/core/Loading/sceneLoader / babylon-mmd/esm/Runtime/mmdRuntime
 *
 * 用法：
 *   node scripts/poc-mmd-bone-attachment.mjs                 # 默认行为
 *
 * 退出码：2 / 3 / 4 / gate ? 0 : 1（含失败码）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Bone } from '@babylonjs/core/Bones/bone';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import { MmdRuntime } from 'babylon-mmd/esm/Runtime/mmdRuntime';

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
const runtime = new MmdRuntime();

const buf = readFileSync(pmxPath);
const result = await ImportMeshAsync('', scene, buf, '.pmx');
const meshes = result.meshes.filter((m) => m instanceof Mesh);
if (meshes.length === 0) { console.error('[POC] 未加载到 Mesh'); process.exit(3); }
const rootMesh = meshes[0];
console.log('[POC] 加载 Mesh 数 =', meshes.length, 'name =', rootMesh.name);

let model;
try {
  model = runtime.createMmdModel(rootMesh);
} catch (e) {
  console.error('[POC] createMmdModel 失败:', e?.message || e);
  process.exit(4);
}

const rb0 = model.runtimeBones[0];
const linked = rb0.linkedBone;
const isRealBone = linked instanceof Bone;
console.log(`[POC] 检查1 runtimeBone[0].name=${rb0.name} linkedBone instanceof Bone = ${isRealBone}`);
console.log(`[POC]   model.skeleton.bones[0] instanceof Bone = ${model.skeleton.bones[0] instanceof Bone}`);
console.log(`[POC]   runtimeBones 总数 = ${model.runtimeBones.length}, skeleton.bones 总数 = ${model.skeleton.bones.length}`);

for (let i = 0; i < 3; i++) {
  runtime.update(16);
  scene.render();
}

const mRuntime = new Matrix();
const mFinal = new Matrix();
let maxDiff = 0;
let checked = 0;
for (let i = 0; i < Math.min(model.runtimeBones.length, 30); i++) {
  const rb = model.runtimeBones[i];
  if (!(rb.linkedBone instanceof Bone)) continue;
  rb.getWorldMatrixToRef(mRuntime);
  rb.linkedBone.getFinalMatrix().copyTo(mFinal);
  const dx = Math.abs(mRuntime.m[12] - mFinal.m[12]);
  const dy = Math.abs(mRuntime.m[13] - mFinal.m[13]);
  const dz = Math.abs(mRuntime.m[14] - mFinal.m[14]);
  const d = Math.max(dx, dy, dz);
  if (d > maxDiff) maxDiff = d;
  checked++;
}
console.log(`[POC] 检查2 对比 ${checked} 根骨骼 worldMatrix 平移最大偏差 = ${maxDiff.toFixed(6)} (0 表示 getFinalMatrix 新鲜)`);
const finalFresh = maxDiff < 1e-3;

const probe = new TransformNode('probe', scene);
probe.attachToBone(linked, rootMesh);
const before = new Vector3();
probe.getAbsolutePosition().cloneToRef?.(before) ?? probe.getAbsolutePosition();
const probeBefore = new Vector3(probe.getWorldMatrix().m[12], probe.getWorldMatrix().m[13], probe.getWorldMatrix().m[14]);
const boneTrans = new Vector3();
rb0.getWorldTranslationToRef(boneTrans);
linked.rotationQuaternion = linked.rotationQuaternion || Matrix.Identity().toQuaternion();
linked.rotationQuaternion.z += 0.5;
for (let i = 0; i < 3; i++) { runtime.update(16); scene.render(); }
const boneTransAfter = new Vector3();
rb0.getWorldTranslationToRef(boneTransAfter);
const probeAfter = new Vector3(probe.getWorldMatrix().m[12], probe.getWorldMatrix().m[13], probe.getWorldMatrix().m[14]);
const probeTracked = Vector3.Distance(probeAfter, boneTransAfter) < 1e-2;
console.log(`[POC] 检查3 attachToBone 探针 位移 = (${probeAfter.x.toFixed(3)}, ${probeAfter.y.toFixed(3)}, ${probeAfter.z.toFixed(3)})`);
console.log(`[POC]   对应骨骼世界平移 = (${boneTransAfter.x.toFixed(3)}, ${boneTransAfter.y.toFixed(3)}, ${boneTransAfter.z.toFixed(3)})`);
console.log(`[POC]   attachToBone 跟随骨骼 = ${probeTracked}`);

console.log('\n📄 POC 结论');
console.log(`检查1 原生Bone暴露 : ${isRealBone ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`检查2 getFinalMatrix新鲜: ${finalFresh ? 'PASS ✅' : 'FAIL ❌ (偏差 ' + maxDiff.toFixed(4) + ')'}`);
console.log(`检查3 attachToBone跟随 : ${probeTracked ? 'PASS ✅' : 'FAIL ❌'}`);
const gate = isRealBone && finalFresh && probeTracked;
console.log(`风险1 POC 闸门 : ${gate ? 'PASS — Accessory(2.4)/MotionOverride(2.1) 无需桥接层，可直接用 linkedBone' : 'NEEDS-BRIDGE — 需从 babylon-mmd 运行时提取变换矩阵手动父子链接'}`);
process.exit(gate ? 0 : 1);
