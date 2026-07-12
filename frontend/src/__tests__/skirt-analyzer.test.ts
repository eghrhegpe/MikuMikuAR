import { describe, it, expect } from 'vitest';
import { analyzeSkirt, type SkirtAnalyzerOptions } from '../scene/physics/skirt-analyzer';

// ============================================================================
// 合成 mesh 生成器 — 构造可控的测试几何体
// ============================================================================

interface MeshData {
    positions: Float32Array;
    indices: Uint32Array;
}

/**
 * 创建底部开口、顶部封顶的圆柱体（模拟裙子 mesh）。
 * - 底部（Y=0）开口 → 产生 boundary edges
 * - 顶部（Y=height）用 fan 封顶 → 无 boundary edges
 */
function createOpenBottomCylinder(
    radius: number,
    height: number,
    radialSegs: number,
    heightSegs: number
): MeshData {
    const positions: number[] = [];
    const indices: number[] = [];

    for (let r = 0; r <= heightSegs; r++) {
        const y = (r / heightSegs) * height;
        for (let a = 0; a < radialSegs; a++) {
            const angle = (a / radialSegs) * Math.PI * 2;
            positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        }
    }
    const centerIdx = (heightSegs + 1) * radialSegs;
    positions.push(0, height, 0);

    for (let r = 0; r < heightSegs; r++) {
        for (let a = 0; a < radialSegs; a++) {
            const v0 = r * radialSegs + a;
            const v1 = r * radialSegs + ((a + 1) % radialSegs);
            const v2 = (r + 1) * radialSegs + a;
            const v3 = (r + 1) * radialSegs + ((a + 1) % radialSegs);
            indices.push(v0, v1, v2);
            indices.push(v1, v3, v2);
        }
    }
    const topRingStart = heightSegs * radialSegs;
    for (let a = 0; a < radialSegs; a++) {
        const v0 = topRingStart + a;
        const v1 = topRingStart + ((a + 1) % radialSegs);
        indices.push(centerIdx, v1, v0);
    }

    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** 创建全封闭球体（合并极点，无 boundary edges，用于 fallback 测试） */
function createSphere(radius: number, segs: number): MeshData {
    const positions: number[] = [];
    const indices: number[] = [];

    // 北极顶点
    const northPole = 0;
    positions.push(0, radius, 0);

    // 中间环（lat 1 到 segs-1）
    for (let lat = 1; lat < segs; lat++) {
        const theta = (lat / segs) * Math.PI;
        for (let lon = 0; lon < segs; lon++) {
            const phi = (lon / segs) * Math.PI * 2;
            positions.push(
                radius * Math.sin(theta) * Math.cos(phi),
                radius * Math.cos(theta),
                radius * Math.sin(theta) * Math.sin(phi)
            );
        }
    }

    // 南极顶点
    const southPole = positions.length / 3;
    positions.push(0, -radius, 0);

    // 北极 fan
    for (let lon = 0; lon < segs; lon++) {
        const v0 = 1 + lon;
        const v1 = 1 + ((lon + 1) % segs);
        indices.push(northPole, v1, v0);
    }

    // 中间四边形
    for (let lat = 0; lat < segs - 2; lat++) {
        for (let lon = 0; lon < segs; lon++) {
            const v0 = 1 + lat * segs + lon;
            const v1 = 1 + lat * segs + ((lon + 1) % segs);
            const v2 = 1 + (lat + 1) * segs + lon;
            const v3 = 1 + (lat + 1) * segs + ((lon + 1) % segs);
            indices.push(v0, v1, v2);
            indices.push(v1, v3, v2);
        }
    }

    // 南极 fan
    const lastRingStart = 1 + (segs - 2) * segs;
    for (let lon = 0; lon < segs; lon++) {
        const v0 = lastRingStart + lon;
        const v1 = lastRingStart + ((lon + 1) % segs);
        indices.push(southPole, v0, v1);
    }

    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/**
 * 创建「裤子」mesh：两条相互分离、底部均开口的圆柱（左右腿），
 * 用于验证 P2a 防误判（多底环 → 非裙摆，安全跳过）。
 */
function createPantsMesh(
    radius: number,
    height: number,
    radialSegs: number,
    heightSegs: number,
    legGap: number
): MeshData {
    const left = createOpenBottomCylinder(radius, height, radialSegs, heightSegs);
    const right = createOpenBottomCylinder(radius, height, radialSegs, heightSegs);

    // 右腿整体沿 +X 平移 legGap，与左腿形成两个分离的底部环
    const rightPositions = new Float32Array(right.positions.length);
    for (let i = 0; i < right.positions.length; i += 3) {
        rightPositions[i] = right.positions[i] + legGap;
        rightPositions[i + 1] = right.positions[i + 1];
        rightPositions[i + 2] = right.positions[i + 2];
    }

    const leftCount = left.positions.length / 3;
    const positions = new Float32Array(left.positions.length + rightPositions.length);
    positions.set(left.positions, 0);
    positions.set(rightPositions, left.positions.length);

    const indices = new Uint32Array(left.indices.length + right.indices.length);
    indices.set(left.indices, 0);
    for (let i = 0; i < right.indices.length; i++) {
        indices[left.indices.length + i] = right.indices[i] + leftCount;
    }

    return { positions, indices };
}

// ============================================================================
// 测试
// ============================================================================

const defaultOpts: SkirtAnalyzerOptions = {
    chains: 8,
    segmentsPerChain: 4,
    skirtYRatio: 0.5,
};

describe('skirt-analyzer — P2a 防穿裤误判', () => {
    it('裤子 mesh（双分离底环）→ 判定非裙摆，返回空链', () => {
        const mesh = createPantsMesh(0.15, 1.0, 12, 6, 0.4);
        const result = analyzeSkirt(mesh.positions, mesh.indices, defaultOpts);

        // 两个分离的底部环 → 多底环守卫触发，安全跳过
        expect(result.chains.length).toBe(0);
        expect(result.totalSegments).toBe(0);
        expect(result.hasExistingSkirtBones).toBe(false);
    });

    it('裤子 mesh 不应误注入：与等效单裙摆对比', () => {
        // 左腿单独作为「单底环」应被识别为裙摆（用于对照说明：多环才是裤子信号）
        const singleLeg = createOpenBottomCylinder(0.15, 1.0, 12, 6);
        const pants = createPantsMesh(0.15, 1.0, 12, 6, 0.4);

        const singleResult = analyzeSkirt(singleLeg.positions, singleLeg.indices, defaultOpts);
        const pantsResult = analyzeSkirt(pants.positions, pants.indices, defaultOpts);

        // 单腿（单底环）生成链；裤子（双底环）跳过
        expect(singleResult.totalSegments).toBeGreaterThan(0);
        expect(pantsResult.totalSegments).toBe(0);
    });
});

describe('skirt-analyzer — 基础功能', () => {
    it('开口圆柱裙: 检测到 boundary edges', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const result = analyzeSkirt(mesh.positions, mesh.indices, defaultOpts);

        expect(result.boundaryEdgeCount).toBeGreaterThan(0);
        expect(result.method).toBe('boundary-edge');
    });

    it('开口圆柱裙: 生成正确数量的链', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const result = analyzeSkirt(mesh.positions, mesh.indices, defaultOpts);

        expect(result.chains.length).toBe(8);
    });

    it('开口圆柱裙: 每条链有正确数量的骨节', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const result = analyzeSkirt(mesh.positions, mesh.indices, defaultOpts);

        for (const chain of result.chains) {
            expect(chain.segments.length).toBeGreaterThan(0);
            expect(chain.segments.length).toBeLessThanOrEqual(4);
        }
        expect(result.totalSegments).toBeGreaterThan(0);
    });

    it('开口圆柱裙: 骨节 Y 坐标递增（从 hem 到 waist）', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const result = analyzeSkirt(mesh.positions, mesh.indices, defaultOpts);

        for (const chain of result.chains) {
            for (let i = 1; i < chain.segments.length; i++) {
                expect(chain.segments[i].restPosition[1]).toBeGreaterThanOrEqual(
                    chain.segments[i - 1].restPosition[1]
                );
            }
        }
    });

    it('开口圆柱裙: 顶点被分配到骨节', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const result = analyzeSkirt(mesh.positions, mesh.indices, defaultOpts);

        let totalAssigned = 0;
        for (const chain of result.chains) {
            for (const seg of chain.segments) {
                totalAssigned += seg.vertexIndices.length;
            }
        }
        expect(totalAssigned).toBeGreaterThan(0);
        expect(result.skirtVertexCount).toBeGreaterThan(0);
    });

    it('开口圆柱裙: 权重和为 1（每个顶点的总权重）', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const result = analyzeSkirt(mesh.positions, mesh.indices, defaultOpts);

        // 汇总每个顶点的权重
        const vertexWeights = new Map<number, number>();
        for (const chain of result.chains) {
            for (const seg of chain.segments) {
                for (let i = 0; i < seg.vertexIndices.length; i++) {
                    const v = seg.vertexIndices[i];
                    vertexWeights.set(v, (vertexWeights.get(v) ?? 0) + seg.weights[i]);
                }
            }
        }
        for (const [, w] of vertexWeights) {
            expect(w).toBeCloseTo(1.0, 2);
        }
    });
});

describe('skirt-analyzer — 已有裙骨检测', () => {
    it('骨骼名含 "skirt" → hasExistingSkirtBones=true, 不生成链', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const result = analyzeSkirt(mesh.positions, mesh.indices, {
            ...defaultOpts,
            boneNames: ['hips', 'spine', 'skirt_01', 'skirt_02'],
        });

        expect(result.hasExistingSkirtBones).toBe(true);
        expect(result.chains.length).toBe(0);
        expect(result.totalSegments).toBe(0);
    });

    it('骨骼名含 "裾" → hasExistingSkirtBones=true', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const result = analyzeSkirt(mesh.positions, mesh.indices, {
            ...defaultOpts,
            boneNames: ['上半身', '下半身', '裾_01'],
        });

        expect(result.hasExistingSkirtBones).toBe(true);
    });

    it('骨骼名含 "スカート" → hasExistingSkirtBones=true', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const result = analyzeSkirt(mesh.positions, mesh.indices, {
            ...defaultOpts,
            boneNames: ['上半身', 'スカート1'],
        });

        expect(result.hasExistingSkirtBones).toBe(true);
    });

    it('骨骼名不含裙骨 → 正常分析', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const result = analyzeSkirt(mesh.positions, mesh.indices, {
            ...defaultOpts,
            boneNames: ['hips', 'spine', 'head'],
        });

        expect(result.hasExistingSkirtBones).toBe(false);
        expect(result.chains.length).toBeGreaterThan(0);
    });
});

describe('skirt-analyzer — 退化 & 边界情况', () => {
    it('空输入 → 返回空结果', () => {
        const result = analyzeSkirt(new Float32Array(0), new Uint32Array(0));
        expect(result.chains).toEqual([]);
        expect(result.totalSegments).toBe(0);
        expect(result.method).toBe('none');
    });

    it('顶点数 < 3 → 返回空结果', () => {
        const positions = new Float32Array([0, 0, 0, 1, 0, 0]);
        const indices = new Uint32Array([0, 1, 0]);
        const result = analyzeSkirt(positions, indices);
        expect(result.chains).toEqual([]);
    });

    it('无三角形 → 返回空结果', () => {
        const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]);
        const indices = new Uint32Array(0);
        const result = analyzeSkirt(positions, indices);
        expect(result.chains).toEqual([]);
    });

    it('封闭球体 → 无 boundary edges, fallback 到 y-threshold', () => {
        const mesh = createSphere(1.0, 8);
        const result = analyzeSkirt(mesh.positions, mesh.indices, defaultOpts);

        expect(result.boundaryEdgeCount).toBe(0);
        expect(result.method).toBe('y-threshold');
        // 球体下半部分应该有顶点
        expect(result.skirtVertexCount).toBeGreaterThan(0);
    });

    it('极小 mesh（< MIN_SKIRT_VERTICES）→ 返回空', () => {
        // 极少顶点的圆柱
        const mesh = createOpenBottomCylinder(0.1, 0.2, 3, 1);
        const result = analyzeSkirt(mesh.positions, mesh.indices, defaultOpts);
        // 3 个径向顶点 × 2 层 = 6 个顶点 + 1 center = 7
        // skirt 区域可能只有底层 3 个 → 低于 MIN_SKIRT_VERTICES(6)
        expect(result.totalSegments).toBe(0);
    });
});

describe('skirt-analyzer — 参数边界', () => {
    it('chains 参数被 clamp 到 [4, 32]', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 24, 8);
        const result1 = analyzeSkirt(mesh.positions, mesh.indices, {
            chains: 1,
            segmentsPerChain: 4,
        });
        const result2 = analyzeSkirt(mesh.positions, mesh.indices, {
            chains: 100,
            segmentsPerChain: 4,
        });

        // chains=1 → clamped to 4
        expect(result1.chains.length).toBe(4);
        // chains=100 → clamped to 32
        expect(result2.chains.length).toBe(32);
    });

    it('segmentsPerChain 参数被 clamp 到 [4, 16]', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 24, 8);
        const result = analyzeSkirt(mesh.positions, mesh.indices, {
            chains: 8,
            segmentsPerChain: 1,
        });

        for (const chain of result.chains) {
            expect(chain.segments.length).toBeLessThanOrEqual(4);
        }
    });

    it('skirtYRatio 影响裙摆区域大小', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 8);
        const smallRatio = analyzeSkirt(mesh.positions, mesh.indices, {
            chains: 8,
            segmentsPerChain: 4,
            skirtYRatio: 0.1,
        });
        const largeRatio = analyzeSkirt(mesh.positions, mesh.indices, {
            chains: 8,
            segmentsPerChain: 4,
            skirtYRatio: 0.9,
        });

        // 更大的 Y 比例 → 更多顶点在裙摆区域
        expect(largeRatio.skirtVertexCount).toBeGreaterThanOrEqual(smallRatio.skirtVertexCount);
    });

    it('自定义 collisionRadius 传递到骨节', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const result = analyzeSkirt(mesh.positions, mesh.indices, {
            ...defaultOpts,
            collisionRadius: 0.05,
        });

        for (const chain of result.chains) {
            for (const seg of chain.segments) {
                expect(seg.radius).toBe(0.05);
            }
        }
    });

    it('默认 collisionRadius 由 mesh 尺寸推算', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const result = analyzeSkirt(mesh.positions, mesh.indices, defaultOpts);

        for (const chain of result.chains) {
            for (const seg of chain.segments) {
                expect(seg.radius).toBeGreaterThan(0);
            }
        }
    });
});

describe('skirt-analyzer — 角度分链正确性', () => {
    it('不同角度的顶点被分配到不同链', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 16, 6);
        const result = analyzeSkirt(mesh.positions, mesh.indices, {
            chains: 4,
            segmentsPerChain: 3,
        });

        // 4 条链，每条链的骨节应在不同角度区域
        expect(result.chains.length).toBe(4);

        // 每条链的骨节 rest 位置应有不同的角度
        const chainAngles: number[] = [];
        for (const chain of result.chains) {
            if (chain.segments.length === 0) {
                continue;
            }
            // 用所有骨节的平均角度
            let sx = 0,
                sz = 0;
            for (const seg of chain.segments) {
                sx += seg.restPosition[0];
                sz += seg.restPosition[2];
            }
            chainAngles.push(Math.atan2(sz, sx));
        }

        // 不同链的角度应该有差异
        const uniqueAngles = new Set(chainAngles.map((a) => a.toFixed(2)));
        expect(uniqueAngles.size).toBeGreaterThan(1);
    });
});

describe('skirt-analyzer — 类型兼容性', () => {
    it('接受普通 number[] 作为输入', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 8, 4);
        const plainPositions = Array.from(mesh.positions);
        const plainIndices = Array.from(mesh.indices);

        const result = analyzeSkirt(plainPositions, plainIndices, defaultOpts);
        expect(result.chains.length).toBeGreaterThan(0);
    });

    it('接受 Int32Array 作为 indices', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 8, 4);
        const intIndices = new Int32Array(mesh.indices);

        const result = analyzeSkirt(mesh.positions, intIndices, defaultOpts);
        expect(result.chains.length).toBeGreaterThan(0);
    });
});
