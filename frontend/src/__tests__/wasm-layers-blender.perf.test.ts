// [doc:adr-056] WASM 图层混合热路径性能基准（headless）
//
// 目的：给 ADR-056 §九 回填真实 P50/P95。
//
// 为什么不在 WASM 运行时下测：MmdWasmRuntime 在 node headless 下需 fetch
// wasm 二进制（node_modules/babylon-mmd/.../wasm/*.wasm），加载不可靠。
// 因此本基准**忠实复刻** wasm-layers-blender.ts 的 _applyLayersBlending 热路径：
//   - 用真实 PMX 骨骼图（MmdRuntime JS 头less）建立 childMap
//   - 用真实 VmdEvaluator（buildVmd 生成 overlay VMD）逐帧求值
//   - _writeMatToBuffer 拷 16 个 float；_propagateChildrenWasm 用
//     Matrix.FromArrayToRef / Invert / multiply —— 与 WASM 管线写入同量级
//   - 不计入 WASM Bullet 物理开销（与图层混合正交，ADR 结论已说明）
//
// 运行：npx vitest run src/__tests__/wasm-layers-blender.perf.test.ts
// （已排除出默认 test 套件：vitest.config.ts exclude '**/*.perf.test.ts'）

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import 'babylon-mmd/esm/Loader/pmxLoader.js';
import { MmdRuntime } from 'babylon-mmd/esm/Runtime/mmdRuntime.js';
import { createVmdEvaluator, type VmdEvaluator } from '@/motion-algos/vmd-evaluator';
import { buildVmd } from '@/motion-algos/vmd-writer';
import { test, expect } from 'vitest';

type RuntimeBone = {
    name: string;
    parentBone: RuntimeBone | null;
    childBones: RuntimeBone[];
    worldMatrix: Float32Array;
};

function findPmx(root: string): string {
    const dirs: string[] = [];
    for (const name of readdirSync(root, { withFileTypes: true })) {
        const p = join(root, name.name);
        if (name.isDirectory()) {
            dirs.push(p);
        } else if (name.name.toLowerCase().endsWith('.pmx')) {
            return p;
        }
    }
    for (const d of dirs) {
        const found = findPmx(d);
        if (found) {
            return found;
        }
    }
    return '';
}

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) {
        return 0;
    }
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
}

// ── 忠实复刻 perception.ts / wasm-layers-blender.ts ──
function writeMatToBuffer(buf: Float32Array, m: Matrix): void {
    const a = m.asArray();
    for (let i = 0; i < 16; ++i) {
        buf[i] = a[i];
    }
}

function propagateChildrenWasm(
    parent: RuntimeBone,
    parentOldMat: Matrix,
    parentNewMat: Matrix
): void {
    const parentOldInv = new Matrix();
    parentOldInv.copyFrom(parentOldMat);
    parentOldInv.invert();
    for (const child of parent.childBones) {
        const childBuf = child.worldMatrix;
        if (!childBuf) {
            continue;
        }
        const childOldMat = Matrix.FromArrayToRef(childBuf, 0, new Matrix());
        const localMat = new Matrix();
        childOldMat.multiplyToRef(parentOldInv, localMat);
        const childNewMat = new Matrix();
        localMat.multiplyToRef(parentNewMat, childNewMat);
        writeMatToBuffer(childBuf, childNewMat);
        propagateChildrenWasm(child, childOldMat, childNewMat);
    }
}

// 复刻 _applyLayersBlending 的逐骨混合（单图层即为双图层/三图层热路径下界；
// 多图层仅增加 entries 循环，O(层) 可忽略，成本由骨数 + 子树深度主导）
function applyLayersBlending(
    names: string[],
    evaluator: VmdEvaluator,
    bones: RuntimeBone[],
    frame: number
): void {
    const frameMap = evaluator.evalAllBones(frame);
    const allFrames = new Map<
        string,
        Array<{ rotation: Quaternion; position: Vector3 | null; weight: number }>
    >();
    for (const [boneName, fd] of frameMap) {
        if (!names.includes(boneName)) {
            continue;
        }
        if (!allFrames.has(boneName)) {
            allFrames.set(boneName, []);
        }
        allFrames.get(boneName)!.push({ rotation: fd.rotation, position: fd.position, weight: 1 });
    }
    for (const [boneName, entries] of allFrames) {
        const bone = bones.find((b) => b.name === boneName);
        if (!bone) {
            continue;
        }
        const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
        if (totalWeight <= 0) {
            continue;
        }
        let blendedRot: Quaternion | null = null;
        let blendedPos: Vector3 | null = null;
        for (const entry of entries) {
            const nw = entry.weight / totalWeight;
            const { rotation, position } = entry;
            if (blendedRot === null) {
                blendedRot = rotation.clone();
            } else {
                blendedRot = Quaternion.Slerp(blendedRot, rotation, nw);
            }
            if (position !== null) {
                if (blendedPos === null) {
                    blendedPos = position.clone();
                } else {
                    blendedPos.x += (position.x - blendedPos.x) * nw;
                    blendedPos.y += (position.y - blendedPos.y) * nw;
                    blendedPos.z += (position.z - blendedPos.z) * nw;
                }
            }
        }
        if (blendedRot !== null) {
            const oldMat = Matrix.FromArray(bone.worldMatrix as Float32Array);
            const newMat = new Matrix();
            if (blendedPos !== null) {
                newMat.copyFrom(Matrix.Compose(Vector3.One(), blendedRot, blendedPos));
            } else {
                const pos = oldMat.getTranslation();
                newMat.copyFrom(Matrix.Compose(Vector3.One(), blendedRot, pos));
            }
            writeMatToBuffer(bone.worldMatrix as Float32Array, newMat);
            propagateChildrenWasm(bone, oldMat, newMat);
        }
    }
}

async function buildOverlayEvaluator(names: string[]): Promise<VmdEvaluator> {
    const frames: Array<{
        name: string;
        frame: number;
        position: [number, number, number];
        rotation: [number, number, number, number];
    }> = [];
    for (const name of names) {
        frames.push({ name, frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        frames.push({
            name,
            frame: 30,
            position: [0.1, 0.2, 0.0],
            rotation: [0.2, 0.1, 0.3, 0.93],
        });
    }
    const buf = buildVmd(frames, []);
    return createVmdEvaluator(buf);
}

test('bench wasm layers blender hot path', async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera('cam', new Vector3(0, 5, -20), scene);

    const pmx = findPmx(join(__dirname, '..', '..', '..', 'text-model', 'PMX'));
    if (!pmx) {
        throw new Error('no .pmx found under text-model/PMX');
    }
    const runtime = new MmdRuntime();
    const buf = readFileSync(pmx);
    const res = await ImportMeshAsync(buf, scene, { pluginExtension: '.pmx' });
    const root = res.meshes.find(
        (m) => (m as { metadata?: { isMmdModel?: boolean } }).metadata?.isMmdModel === true
    ) as unknown as never | undefined;
    if (!root) {
        throw new Error('no mmd model mesh in pmx');
    }
    const model = runtime.createMmdModel(root as never);
    runtime.register(scene);
    for (let i = 0; i < 3; i++) {
        runtime.beforePhysics(16);
        runtime.afterPhysics();
        scene.render();
    }

    const bones = (model as unknown as { runtimeBones: RuntimeBone[] }).runtimeBones;
    const totalBones = bones.length;

    const childMap = new Map<RuntimeBone, RuntimeBone[]>();
    for (const b of bones) {
        const p = b.parentBone;
        if (p) {
            if (!childMap.has(p)) {
                childMap.set(p, []);
            }
            childMap.get(p)!.push(b);
        }
    }
    // 复刻 childBones（由 parentBone 反向建立）
    for (const b of bones) {
        b.childBones = childMap.get(b) ?? [];
    }

    const leaves = bones.filter((b) => (childMap.get(b)?.length ?? 0) === 0);

    const tiers: Array<{ label: string; names: string[] }> = [
        { label: '双图层（gaze scope，2 leaf 骨）', names: leaves.slice(0, 2).map((b) => b.name) },
        {
            label: '双图层（上半身，前 10 根骨/大子树）',
            names: bones.slice(0, 10).map((b) => b.name),
        },
        { label: '三图层（上半身，前 30 根骨）', names: bones.slice(0, 30).map((b) => b.name) },
        {
            label: '三图层（全骨骼，min(300,total)）',
            names: bones.slice(0, Math.min(300, totalBones)).map((b) => b.name),
        },
    ];

    console.log(
        `\n[BENCH] model=${pmx.split(/[\\/]/).pop()} totalBones=${totalBones} leaves=${leaves.length}`
    );

    for (const tier of tiers) {
        const n = tier.names.length;
        const evaluator = await buildOverlayEvaluator(tier.names);
        // warmup
        for (let f = 0; f < 50; f++) {
            applyLayersBlending(tier.names, evaluator, bones, f % 30);
        }
        const samples: number[] = [];
        const FRAMES = 1000;
        for (let f = 0; f < FRAMES; f++) {
            const t0 = performance.now();
            applyLayersBlending(tier.names, evaluator, bones, f % 30);
            const t1 = performance.now();
            samples.push(t1 - t0);
        }
        samples.sort((a, b) => a - b);
        const p50 = percentile(samples, 50);
        const p95 = percentile(samples, 95);
        console.log(
            `[BENCH] ${tier.label} | bones=${n} | P50=${p50.toFixed(4)}ms P95=${p95.toFixed(4)}ms`
        );
        evaluator.dispose();
    }

    expect(totalBones).toBeGreaterThan(0);
}, 180_000);
