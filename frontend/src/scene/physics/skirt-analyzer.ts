/**
 * skirt-analyzer.ts — ADR-084 Phase 1: 裙摆拓扑分析
 *
 * 纯几何模块，无 Babylon.js / babylon-mmd / WASM 依赖。
 * 输入 mesh 顶点 + 索引数据，输出虚拟裙骨链结构。
 *
 * 算法管线:
 *   1. 包围盒计算 → 确定 Y 轴裙摆区域阈值
 *   2. edge→triangle 映射 → boundary edge 检测
 *   3. boundary edge 连通分量 → 裙边环识别
 *   4. 角度聚类 → 径向分链
 *   5. Y 轴分层 → 每链骨节
 *   6. 顶点→骨节最近邻映射 + 距离衰减权重
 *
 * 关联: ADR-084, ADR-081 (physics-bridge 复用)
 */

// ============================================================================
// 类型定义
// ============================================================================

export interface SkirtSegment {
    /** Rest pose 位置 [x, y, z] */
    readonly restPosition: [number, number, number];
    /** 该骨节关联的顶点索引 */
    readonly vertexIndices: number[];
    /** 每个关联顶点的权重（与 vertexIndices 并行，和为 1） */
    readonly weights: number[];
    /** 碰撞球半径（由 mesh 尺寸推算） */
    readonly radius: number;
}

export interface SkirtChain {
    /** 链上的骨节序列（从裙边 hem 到腰部 waist，Y 递增） */
    readonly segments: SkirtSegment[];
}

export interface SkirtAnalysisResult {
    /** 虚拟裙骨链列表 */
    readonly chains: SkirtChain[];
    /** 总骨节数 */
    readonly totalSegments: number;
    /** 裙摆区域顶点数 */
    readonly skirtVertexCount: number;
    /** 诊断: 检测到的 boundary edge 数 */
    readonly boundaryEdgeCount: number;
    /** 使用的方法 */
    readonly method: 'boundary-edge' | 'y-threshold' | 'none';
    /** 是否检测到已有裙骨（有则跳过自动生成） */
    readonly hasExistingSkirtBones: boolean;
}

export interface SkirtAnalyzerOptions {
    /** 期望链数（默认 12，范围 4-32） */
    chains?: number;
    /** 每链骨节数（默认 8，范围 4-16） */
    segmentsPerChain?: number;
    /** 裙摆区域 Y 阈值比例（默认 0.3 = 模型高度 30% 以下） */
    skirtYRatio?: number;
    /** 已知骨骼名列表（用于检测是否已有裙骨） */
    boneNames?: string[];
    /** 碰撞球半径（默认 auto，按 mesh 尺寸推算） */
    collisionRadius?: number;
}

// ============================================================================
// 常量
// ============================================================================

/** 裙骨名匹配正则（英文/中文/日文） */
const SKIRT_BONE_PATTERN = /skirt|裾|スカート|sukato/i;

/** 默认参数 */
const DEFAULT_CHAINS = 12;
const DEFAULT_SEGMENTS_PER_CHAIN = 8;
const DEFAULT_SKIRT_Y_RATIO = 0.3;
/** 最少裙摆顶点数，低于此数判定无裙摆 */
const MIN_SKIRT_VERTICES = 6;
/** 连通分量最少顶点数，低于此数忽略 */
const MIN_COMPONENT_SIZE = 3;

// ============================================================================
// Union-Find
// ============================================================================

class UnionFind {
    private parent: Map<number, number> = new Map();

    find(x: number): number {
        if (!this.parent.has(x)) {
            this.parent.set(x, x);
            return x;
        }
        let root = x;
        while (this.parent.get(root)! !== root) {
            root = this.parent.get(root)!;
        }
        // 路径压缩
        let cur = x;
        while (this.parent.get(cur)! !== root) {
            const next = this.parent.get(cur)!;
            this.parent.set(cur, root);
            cur = next;
        }
        return root;
    }

    union(a: number, b: number): void {
        const ra = this.find(a);
        const rb = this.find(b);
        if (ra !== rb) {
            this.parent.set(ra, rb);
        }
    }

    /** 获取所有连通分量 → Set<number>[] */
    components(): Map<number, number[]> {
        const groups = new Map<number, number[]>();
        for (const key of this.parent.keys()) {
            const root = this.find(key);
            const arr = groups.get(root);
            if (arr) {
                arr.push(key);
            } else {
                groups.set(root, [key]);
            }
        }
        return groups;
    }
}

// ============================================================================
// 工具函数
// ============================================================================

function edgeKey(a: number, b: number): string {
    return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function clampInt(v: number, lo: number, hi: number): number {
    return Math.round(Math.min(hi, Math.max(lo, v)));
}

// ============================================================================
// 主分析函数
// ============================================================================

/**
 * 分析 mesh 拓扑，识别裙摆区域并生成虚拟骨骼链。
 *
 * @param positions 顶点位置数组 [x0,y0,z0, x1,y1,z1, ...]
 * @param indices 三角形索引数组 [i0,i1,i2, i3,i4,i5, ...]
 * @param options 分析选项
 * @returns 裙摆分析结果
 */
export function analyzeSkirt(
    positions: Float32Array | number[],
    indices: Uint32Array | number[] | Int32Array,
    options?: SkirtAnalyzerOptions,
): SkirtAnalysisResult {
    const empty: SkirtAnalysisResult = {
        chains: [],
        totalSegments: 0,
        skirtVertexCount: 0,
        boundaryEdgeCount: 0,
        method: 'none',
        hasExistingSkirtBones: false,
    };

    // --- 参数解析 ---
    const chainCount = clampInt(options?.chains ?? DEFAULT_CHAINS, 4, 32);
    const segmentsPerChain = clampInt(options?.segmentsPerChain ?? DEFAULT_SEGMENTS_PER_CHAIN, 4, 16);
    const skirtYRatio = Math.min(1, Math.max(0.1, options?.skirtYRatio ?? DEFAULT_SKIRT_Y_RATIO));

    // --- 输入校验 ---
    const posArr = positions instanceof Float32Array ? positions : new Float32Array(positions);
    const idxArr = indices instanceof Uint32Array
        ? indices
        : indices instanceof Int32Array
            ? new Uint32Array(indices)
            : new Uint32Array(indices);

    const vertexCount = posArr.length / 3;
    const triangleCount = idxArr.length / 3;
    if (vertexCount < 3 || triangleCount < 1) {
        return empty;
    }

    // --- 1. 已有裙骨检测 ---
    if (options?.boneNames && options.boneNames.length > 0) {
        const hasSkirt = options.boneNames.some((n) => SKIRT_BONE_PATTERN.test(n));
        if (hasSkirt) {
            return { ...empty, hasExistingSkirtBones: true };
        }
    }

    // --- 2. 包围盒计算 ---
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < posArr.length; i += 3) {
        const x = posArr[i];
        const y = posArr[i + 1];
        const z = posArr[i + 2];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    const modelHeight = Math.max(maxY - minY, 1e-6);
    const skirtYThreshold = minY + modelHeight * skirtYRatio;
    const modelWidth = Math.max(maxX - minX, maxZ - minZ, 1e-6);
    const collisionRadius = options?.collisionRadius ?? Math.max(modelWidth * 0.015, 0.01);

    // --- 3. edge→triangle 映射 ---
    const edgeCounts = new Map<string, number>();
    for (let t = 0; t < triangleCount; t++) {
        const i0 = idxArr[t * 3];
        const i1 = idxArr[t * 3 + 1];
        const i2 = idxArr[t * 3 + 2];
        for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]] as const) {
            const key = edgeKey(a, b);
            edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
        }
    }

    // --- 4. boundary edges（仅被 1 个三角形引用的边） ---
    const boundaryEdges: Array<[number, number]> = [];
    for (const [key, count] of edgeCounts) {
        if (count === 1) {
            const sep = key.indexOf('_');
            boundaryEdges.push([parseInt(key.slice(0, sep)), parseInt(key.slice(sep + 1))]);
        }
    }

    // --- 5. boundary edge 连通分量 ---
    const uf = new UnionFind();
    for (const [a, b] of boundaryEdges) {
        uf.union(a, b);
    }

    // 取所有 boundary 顶点
    const boundaryVertices = new Set<number>();
    for (const [a, b] of boundaryEdges) {
        boundaryVertices.add(a);
        boundaryVertices.add(b);
    }

    // 连通分量分组
    const components = uf.components();

    // P2a 防误判（穿裤模型）：先收集所有「底部」连通分量（Y 均值 ≤ 裙摆阈值且规模达标）。
    // 真实裙摆底部为单个连续环（开放 hem）；裤子/连体衣底部为 ≥2 个分离环（左右腿洞）。
    // 多环 → 判定非裙摆，安全跳过自动生成，避免对腿部误注入虚拟裙骨。
    const bottomComponents: number[][] = [];
    for (const [, verts] of components) {
        if (verts.length < MIN_COMPONENT_SIZE) continue;
        let sumY = 0;
        for (const v of verts) {
            sumY += posArr[v * 3 + 1];
        }
        const avgY = sumY / verts.length;
        if (avgY <= skirtYThreshold) {
            bottomComponents.push(verts);
        }
    }
    if (bottomComponents.length >= 2) {
        // 多底部环 → 裤子/连体衣，非裙摆，安全跳过
        return { ...empty, boundaryEdgeCount: boundaryEdges.length, hasExistingSkirtBones: false };
    }
    // 取唯一的底部连通分量作为裙边环（无底部环则进入 fallback）
    const hemComponent: number[] | null = bottomComponents.length === 1 ? bottomComponents[0] : null;
    const hemAvgY = hemComponent ? skirtYThreshold : Infinity;

    // --- 6. 确定裙摆区域顶点 ---
    let skirtVertices: number[];
    let method: 'boundary-edge' | 'y-threshold';

    if (hemComponent && hemComponent.length >= MIN_COMPONENT_SIZE && hemAvgY <= skirtYThreshold) {
        // boundary edge 方法: 从 hem 顶点 BFS 向上扩展，收集裙摆区域所有顶点
        // 构建顶点邻接表
        const adjacency = new Map<number, Set<number>>();
        for (let t = 0; t < triangleCount; t++) {
            const i0 = idxArr[t * 3];
            const i1 = idxArr[t * 3 + 1];
            const i2 = idxArr[t * 3 + 2];
            for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]] as const) {
                if (!adjacency.has(a)) adjacency.set(a, new Set());
                if (!adjacency.has(b)) adjacency.set(b, new Set());
                adjacency.get(a)!.add(b);
                adjacency.get(b)!.add(a);
            }
        }
        // BFS from hem vertices, only going upward (Y >= hem vertex Y)
        const visited = new Set<number>(hemComponent);
        const queue = [...hemComponent];
        const hemMaxY = hemAvgY + modelHeight * 0.35; // 裙摆区域上限: hem 平均 Y + 35% 模型高度
        while (queue.length > 0) {
            const v = queue.shift()!;
            const vy = posArr[v * 3 + 1];
            if (vy > hemMaxY) continue;
            const neighbors = adjacency.get(v);
            if (!neighbors) continue;
            for (const n of neighbors) {
                if (visited.has(n)) continue;
                const ny = posArr[n * 3 + 1];
                if (ny >= vy - 0.001 && ny <= hemMaxY) { // 允许微小误差，向上扩展
                    visited.add(n);
                    queue.push(n);
                }
            }
        }
        skirtVertices = Array.from(visited);
        method = 'boundary-edge';
    } else {
        // fallback: Y 阈值法（无清晰底部 boundary edge 时）
        // P2a 防误判：仅取「外扩裙摆」区域，排除中央腿/裤柱。
        // 计算该 Y 带内顶点在 XZ 平面的质心与最大径向距离，
        // 仅保留径向距离 ≥ 35% 最大径向的顶点（裙摆为外扩锥，腿/裤为中央柱）。
        let bcx = 0, bcz = 0, bandCount = 0;
        for (let i = 0; i < vertexCount; i++) {
            if (posArr[i * 3 + 1] <= skirtYThreshold) {
                bcx += posArr[i * 3];
                bcz += posArr[i * 3 + 2];
                bandCount++;
            }
        }
        if (bandCount > 0) {
            bcx /= bandCount;
            bcz /= bandCount;
        }
        let maxRadial = 1e-6;
        for (let i = 0; i < vertexCount; i++) {
            if (posArr[i * 3 + 1] <= skirtYThreshold) {
                const dx = posArr[i * 3] - bcx;
                const dz = posArr[i * 3 + 2] - bcz;
                const r = Math.sqrt(dx * dx + dz * dz);
                if (r > maxRadial) maxRadial = r;
            }
        }
        const radialCut = maxRadial * 0.35;
        skirtVertices = [];
        for (let i = 0; i < vertexCount; i++) {
            if (posArr[i * 3 + 1] <= skirtYThreshold) {
                const dx = posArr[i * 3] - bcx;
                const dz = posArr[i * 3 + 2] - bcz;
                if (Math.sqrt(dx * dx + dz * dz) >= radialCut) {
                    skirtVertices.push(i);
                }
            }
        }
        method = 'y-threshold';
    }

    if (skirtVertices.length < MIN_SKIRT_VERTICES) {
        return { ...empty, boundaryEdgeCount: boundaryEdges.length };
    }

    // --- 7. 角度聚类 → 分链 ---
    // 计算裙摆顶点在 XZ 平面的质心
    let cx = 0, cz = 0;
    for (const v of skirtVertices) {
        cx += posArr[v * 3];
        cz += posArr[v * 3 + 2];
    }
    cx /= skirtVertices.length;
    cz /= skirtVertices.length;

    // 每个顶点的角度
    const vertexAngles = new Map<number, number>();
    for (const v of skirtVertices) {
        const angle = Math.atan2(posArr[v * 3 + 2] - cz, posArr[v * 3] - cx);
        vertexAngles.set(v, angle);
    }

    // 按角度排序
    const sortedByAngle = [...skirtVertices].sort((a, b) => vertexAngles.get(a)! - vertexAngles.get(b)!);

    // 分成 chainCount 个组（每个组 = 一条链）
    const chainGroups: number[][] = [];
    const verticesPerChain = Math.ceil(sortedByAngle.length / chainCount);
    for (let i = 0; i < chainCount; i++) {
        const start = i * verticesPerChain;
        const end = Math.min(start + verticesPerChain, sortedByAngle.length);
        if (start >= sortedByAngle.length) {
            chainGroups.push([]);
        } else {
            chainGroups.push(sortedByAngle.slice(start, end));
        }
    }

    // --- 8. 每链分层 → 骨节 ---
    const chains: SkirtChain[] = [];
    // P3d: 收集所有骨节（跨链），用于第 9 步全局顶点映射，消除链间缝隙
    const allSegments: SkirtSegment[] = [];

    for (const group of chainGroups) {
        if (group.length === 0) {
            chains.push({ segments: [] });
            continue;
        }

        // 按 Y 升序排序（裙边 → 腰部）
        const sortedByY = [...group].sort((a, b) => posArr[a * 3 + 1] - posArr[b * 3 + 1]);

        // 分成 segmentsPerChain 层
        const actualSegments = Math.min(segmentsPerChain, sortedByY.length);
        const verticesPerSegment = Math.ceil(sortedByY.length / actualSegments);
        const segments: SkirtSegment[] = [];

        for (let s = 0; s < actualSegments; s++) {
            const start = s * verticesPerSegment;
            const end = Math.min(start + verticesPerSegment, sortedByY.length);
            const segVertices = sortedByY.slice(start, end);
            if (segVertices.length === 0) continue;

            // 骨节 rest 位置 = 该层顶点的平均位置
            let sx = 0, sy = 0, sz = 0;
            for (const v of segVertices) {
                sx += posArr[v * 3];
                sy += posArr[v * 3 + 1];
                sz += posArr[v * 3 + 2];
            }
            const restPosition: [number, number, number] = [
                sx / segVertices.length,
                sy / segVertices.length,
                sz / segVertices.length,
            ];

            const seg: SkirtSegment = {
                restPosition,
                vertexIndices: [],
                weights: [],
                radius: collisionRadius,
            };
            segments.push(seg);
            allSegments.push(seg); // P3d: 跨链收集同一引用
        }

        chains.push({ segments });
    }

    // --- 9. 顶点→骨节映射（全局，跨链，P3d 链间缝隙修复）---
    // 相比原「每链内映射」，全局映射让链边界处的顶点同时受相邻两条链的骨节影响，
    // 消除相邻链各自独立位移导致的撕裂。每个顶点取全局最近的 2 个骨节，
    // 按距离反比分配权重（和为 1）。
    for (const v of skirtVertices) {
        const vx = posArr[v * 3];
        const vy = posArr[v * 3 + 1];
        const vz = posArr[v * 3 + 2];

        // 找最近的 2 个骨节（全局）
        const distances = allSegments.map((seg, idx) => {
            const dx = vx - seg.restPosition[0];
            const dy = vy - seg.restPosition[1];
            const dz = vz - seg.restPosition[2];
            return { idx, dist: Math.sqrt(dx * dx + dy * dy + dz * dz) };
        });
        distances.sort((a, b) => a.dist - b.dist);

        // 取最近 2 个（或 1 个如果只有 1 个骨节）
        const k = Math.min(2, distances.length);
        let totalInvDist = 0;
        const invDists: number[] = [];
        for (let i = 0; i < k; i++) {
            const d = Math.max(distances[i].dist, 1e-6);
            const inv = 1 / d;
            invDists.push(inv);
            totalInvDist += inv;
        }

        for (let i = 0; i < k; i++) {
            const seg = allSegments[distances[i].idx];
            const weight = invDists[i] / totalInvDist;
            seg.vertexIndices.push(v);
            seg.weights.push(weight);
        }
    }

    const totalSegments = chains.reduce((sum, c) => sum + c.segments.length, 0);

    return {
        chains,
        totalSegments,
        skirtVertexCount: skirtVertices.length,
        boundaryEdgeCount: boundaryEdges.length,
        method,
        hasExistingSkirtBones: false,
    };
}
