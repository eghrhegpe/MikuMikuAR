import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { GroundMesh } from '@babylonjs/core/Meshes/groundMesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

// 隔离全局 scene 单例：src/scene/scene.ts 在模块顶层 new Scene(engine)，无 WebGL 的 vitest
// 环境会抛错。env-impl 运行时（getGroundHeightAt）不依赖该单例——它直接读 _envSys.ground.mesh，
// 测试里手动注入——故 mock 掉顶层 Scene 构造即可。
vi.mock('../../scene/scene', () => ({
    scene: {} as unknown as Scene,
}));

import { _envSys, getGroundHeightAt } from '../../scene/env/env-impl';
import { envState } from '../../core/config';

let engine: NullEngine;
let scene: Scene;
const _saved = {
    groundType: envState.groundType,
    groundLevel: envState.groundLevel,
};

beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    _envSys.ground.mesh = null;
});

afterEach(() => {
    _envSys.ground.mesh = null;
    envState.groundType = _saved.groundType;
    envState.groundLevel = _saved.groundLevel;
    scene.dispose();
    engine.dispose();
});

/**
 * 构造一个地面网格用于 getGroundHeightAt 验证。
 * - NullEngine 下网格无材质 → isReady() 可能返回 false，强制覆写为 true 以放行查询路径。
 * - heightAt 提供 getHeightAtCoordinates 桩（仅地形路径使用）；非地形路径走 getTiltedPlaneHeight。
 */
function makeGround(opts: {
    type: 'terrain' | 'other';
    level: number;
    rotX?: number;
    rotZ?: number;
    scale?: [number, number, number];
    heightAt?: (lx: number, lz: number) => number;
}): GroundMesh {
    const gm = MeshBuilder.CreateGround(
        'g',
        { width: 200, height: 200, subdivisions: 32 },
        scene
    ) as GroundMesh;
    gm.position.set(0, opts.level, 0);
    gm.rotation.x = opts.rotX ?? 0;
    gm.rotation.z = opts.rotZ ?? 0;
    if (opts.scale) {
        gm.scaling.set(opts.scale[0], opts.scale[1], opts.scale[2]);
    }
    gm.isReady = () => true; // NullEngine 放行查询路径
    gm.computeWorldMatrix(true);
    if (opts.heightAt) {
        (gm as unknown as { getHeightAtCoordinates: typeof opts.heightAt }).getHeightAtCoordinates =
            opts.heightAt;
    }
    return gm;
}

describe('getGroundHeightAt — 倾斜 + 非均匀缩放', () => {
    it('地形路径：倾斜(rotX/rotZ)+非均匀缩放 下世界↔本地逆矩阵变换正确', () => {
        envState.groundType = 'terrain';
        envState.groundLevel = 10;
        const LOCAL_H = 5; // 桩返回的固定本地高度
        const gm = makeGround({
            type: 'terrain',
            level: 10,
            rotX: 0.3,
            rotZ: 0.2,
            scale: [1.5, 0.8, 2.0], // 非均匀缩放
            heightAt: () => LOCAL_H,
        });
        _envSys.ground.mesh = gm;

        const x = 12;
        const z = -7;
        const result = getGroundHeightAt(x, z);

        // 复算预期：镜像 env-impl 863-888 的世界→本地→世界变换链
        const world = gm.getWorldMatrix();
        const inv = world.clone();
        inv.invert();
        const local = Vector3.TransformCoordinates(new Vector3(x, 0, z), inv);
        const worldBack = Vector3.TransformCoordinates(
            new Vector3(local.x, LOCAL_H, local.z),
            world
        );
        expect(result).toBeCloseTo(worldBack.y, 4);
        expect(Number.isFinite(result)).toBe(true);
    });

    it('地形路径：非均匀缩放确实参与变换（uniform vs non-uniform 结果不同）', () => {
        envState.groundType = 'terrain';
        envState.groundLevel = 10;
        const mk = (scale: [number, number, number]) =>
            makeGround({
                type: 'terrain',
                level: 10,
                rotX: 0.3,
                rotZ: 0.2,
                scale,
                heightAt: () => 5,
            });

        const nonUniform = mk([1.5, 0.8, 2.0]);
        _envSys.ground.mesh = nonUniform;
        const r1 = getGroundHeightAt(12, -7);

        const uniform = mk([1, 1, 1]);
        _envSys.ground.mesh = uniform;
        const r2 = getGroundHeightAt(12, -7);

        // 非均匀缩放改变世界矩阵 → 同一世界坐标的查询高度不同（证明缩放进入变换链）
        expect(r1).not.toBeCloseTo(r2, 4);
    });

    it('地形路径：getHeightAtCoordinates 返回非有限值时回退 groundLevel（isFinite 守卫）', () => {
        envState.groundType = 'terrain';
        envState.groundLevel = 10;
        const gm = makeGround({
            type: 'terrain',
            level: 10,
            rotX: 0.3,
            heightAt: () => NaN, // 触发守卫
        });
        _envSys.ground.mesh = gm;

        const r = getGroundHeightAt(12, -7);
        expect(Number.isFinite(r)).toBe(true);
        expect(r).toBe(10); // 回退 groundLevel
    });
});

describe('getGroundHeightAt — 平面倾斜（getTiltedPlaneHeight）', () => {
    it('无倾斜时退化为 groundLevel', () => {
        envState.groundType = 'flat'; // 非地形（terrain 之外的分支走 getTiltedPlaneHeight）
        envState.groundLevel = 10;
        const gm = makeGround({ type: 'other', level: 10 });
        _envSys.ground.mesh = gm;

        expect(getGroundHeightAt(0, 0)).toBeCloseTo(10, 5);
        expect(getGroundHeightAt(50, -30)).toBeCloseTo(10, 5);
    });

    it('rotation.x=30° 时满足平面方程 height = L - tan(θ)·z', () => {
        envState.groundType = 'flat';
        envState.groundLevel = 10;
        const theta = Math.PI / 6; // 30°
        const gm = makeGround({ type: 'other', level: 10, rotX: theta });
        _envSys.ground.mesh = gm;

        // 原点 → groundLevel
        expect(getGroundHeightAt(0, 0)).toBeCloseTo(10, 5);
        // z=10 → L - tan(30°)·10 ≈ 4.2265
        expect(getGroundHeightAt(0, 10)).toBeCloseTo(10 - Math.tan(theta) * 10, 3);
    });
});
