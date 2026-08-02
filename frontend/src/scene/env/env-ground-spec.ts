// env-ground-spec.ts — ADR-226: 地面材质单一事实源（GroundMaterialSpec）
//
// 本模块是「结构收敛」骨架，Phase 1（重建路径）与 Phase 2（原地路径）已接入 applyGround。
// 它把「地面材质应该
// 长什么样」描述为一个纯数据结构 GroundMaterialSpec，由 buildGroundMaterialSpec
// 单一生成；重建 / 原地两条路径都从这份 spec 派生，杜绝 env-ground.ts 中
// 手拼 typeKey + 双路径平行逻辑导致的「加功能即材质错乱」脆弱性。
//
// 迁移阶段见 ADR-226：
//   Phase 1  applyGround 重建路径改调 createGroundMeshFromSpec
//   Phase 2  applyGround 原地路径改调 applyGroundMaterialSpec
//   Phase 4  删除旧双路径 + 手拼 typeKey

import {
    Scene,
    Mesh,
    GroundMesh,
    Color3,
    Material,
    PBRMaterial,
    Texture,
    MeshBuilder,
} from '@babylonjs/core';
import { EnvState } from '@/core/config';

import {
    GroundMat,
    createGroundMaterial,
    _getAlbedoTex,
    _setAlbedoTex,
    _setAlbedoColor,
    _needAlphaBlend,
    generateProceduralGroundTextures,
    INFINITE_GROUND_SIZE,
    _syncGroundRippleTexture,
    _disableGroundRippleTexture,
    buildGroundReflection,
    _syncTextureGroundTexture,
    applyGroundEdgeFade,
    _syncAllTextureOffsets,
    _updateGroundTexture,
    _syncGroundNormalTexture,
    _syncGroundEmissive,
    _syncPbrProperties,
    _effectiveBumpLevel,
    triggerTerrainReady,
    setGroundMesh,
    setGroundActualSize,
} from './env-ground';
import { createHeightmapGround, applyTerrainMaterial } from './env-terrain';
import { hasActiveGroundRipples } from './env-water';
import { underwaterFogController } from './env-underwater-fog';
import type { GroundProceduralKind } from './env-ground-presets';

// ===================================================================
// 1. Spec 数据结构
// ===================================================================

export type GroundGeometryKind = 'flat' | 'infinite' | 'terrain';
export type GroundSourceKind = 'solid' | 'canvas' | 'texture' | 'procedural';

/** 结构性字段：任一变化都要求重建几何/材质（取代手拼 typeKey 的判别符集合）。 */
export interface GroundStructuralSpec {
    geometry: GroundGeometryKind;
    size: number; // flat/infinite → meshSize；terrain → groundSize（纹理密度基准）
    terrainHeight: number;
    terrainScale: number;
    terrainSeed: number;
    terrainOctaves: number;
    pbrEnabled: boolean;
    sourceKind: GroundSourceKind;
    canvasStyle: string; // groundStyle
    overlay: string; // groundOverlay
    gridSize: number; // groundGridSize
    lineColor: [number, number, number];
    color: [number, number, number];
    pattern: string; // groundPattern
    proceduralTexture: string; // groundProceduralTexture
    proceduralSeed: number;
    proceduralScale: number;
    textureEnabled: boolean; // groundTextureEnabled
    textureUrl: string; // groundTexture
    textureScale: number; // groundTextureScale（terrain 模式下进结构性）
    textureRotation: number; // groundTextureRotation（terrain 模式下进结构性）
    reflectionQuality: string;
    alpha: number; // terrain 模式下进结构性（历史一致性）
    level: number; // terrain 模式下进结构性
}

/** 外观性字段：可增量 mutate，不触发重建。 */
export interface GroundAppearanceSpec {
    alpha: number;
    edgeFade: number;
    textureScale: number;
    textureRotation: number;
    normalTexture: string;
    normalStrength: number;
    metallic: number;
    roughness: number;
    reflectionBlur: number;
    reflectionDistort: number;
    reflectionBlend: number;
    scrollSpeedX: number;
    scrollSpeedZ: number;
    pitch: number;
    roll: number;
    // [doc:adr-230] 自发光地屏（外观性，增量同步，不进 specKey）。
    emissiveColor: [number, number, number];
    emissiveStrength: number;
    emissiveReflectMix: number;
    emissiveTexture: string; // 非空 = 复用 albedo 纹理作发光源
}

export interface GroundMaterialSpec {
    structural: GroundStructuralSpec;
    appearance: GroundAppearanceSpec;
}

// ===================================================================
// 2. buildGroundMaterialSpec — 单一事实源
// ===================================================================

/** 由 EnvState 派生完整 Spec。新增材质相关字段只需在此赋值，specKey 自动纳入。 */
export function buildGroundMaterialSpec(state: EnvState): GroundMaterialSpec {
    const isTerrain = state.groundType === 'terrain';

    let sourceKind: GroundSourceKind;
    if (isTerrain) {
        if (state.groundProceduralTexture !== 'none' && !state.groundTextureEnabled) {
            sourceKind = 'procedural';
        } else if (state.groundTextureEnabled && state.groundTexture) {
            sourceKind = 'texture';
        } else {
            sourceKind = 'canvas'; // 含纯色（groundStyle==='solid'）
        }
    } else if (state.groundTextureEnabled && state.groundTexture) {
        sourceKind = 'texture';
    } else if (state.groundProceduralTexture !== 'none' && !state.groundTextureEnabled) {
        sourceKind = 'procedural';
    } else if (state.groundStyle === 'texture') {
        sourceKind = 'solid'; // groundStyle==='texture' 但无贴图 → 纯色兜底
    } else {
        sourceKind = 'canvas'; // grid/checker/dots/stripes/radial/solid(填充)
    }

    const geometry: GroundGeometryKind = isTerrain
        ? 'terrain'
        : state.groundInfiniteEnabled
          ? 'infinite'
          : 'flat';

    const structural: GroundStructuralSpec = {
        geometry,
        size: isTerrain
            ? state.groundSize
            : state.groundInfiniteEnabled
              ? INFINITE_GROUND_SIZE
              : state.groundSize,
        terrainHeight: state.groundTerrainHeight,
        terrainScale: state.groundTerrainScale,
        terrainSeed: state.groundTerrainSeed,
        terrainOctaves: state.groundTerrainOctaves,
        pbrEnabled: state.groundPbrEnabled,
        sourceKind,
        canvasStyle: state.groundStyle,
        overlay: state.groundOverlay,
        gridSize: state.groundGridSize,
        lineColor: state.groundLineColor,
        color: state.groundColor,
        pattern: state.groundPattern,
        proceduralTexture: state.groundProceduralTexture,
        proceduralSeed: state.groundProceduralSeed,
        proceduralScale: state.groundProceduralScale,
        textureEnabled: state.groundTextureEnabled,
        textureUrl: state.groundTexture,
        textureScale: state.groundTextureScale,
        textureRotation: state.groundTextureRotation,
        reflectionQuality: state.reflectionQuality,
        // alpha/level 仅 terrain 模式的 specKey 才纳入结构性（见 specKey terrain 分支，L207/L210）；
        // 非 terrain 由原地路径增量更新，不触发重建。此处统一存值，specKey 负责取舍。
        alpha: state.groundAlpha,
        level: state.groundLevel,
    };

    const appearance: GroundAppearanceSpec = {
        alpha: state.groundAlpha,
        edgeFade: state.groundEdgeFade,
        textureScale: state.groundTextureScale,
        textureRotation: state.groundTextureRotation,
        normalTexture: state.groundNormalTexture,
        normalStrength: state.groundNormalStrength,
        metallic: state.groundMetallic,
        roughness: state.groundRoughness,
        reflectionBlur: state.groundReflectionBlur,
        reflectionDistort: state.groundReflectionDistort,
        reflectionBlend: state.groundReflectionBlend,
        scrollSpeedX: state.groundScrollSpeedX,
        scrollSpeedZ: state.groundScrollSpeedZ,
        pitch: state.groundPitch,
        roll: state.groundRoll,
        emissiveColor: state.groundEmissiveColor,
        emissiveStrength: state.groundEmissiveStrength,
        emissiveReflectMix: state.groundEmissiveReflectMix,
        emissiveTexture: state.groundEmissiveTexture,
    };

    return { structural, appearance };
}

// ===================================================================
// 3. specKey — 由 structural 自动确定性序列化（取代手拼 typeKey）
// ===================================================================

/** 稳定 key：仅序列化结构性字段。新增结构性字段自动纳入，无遗漏风险。 */
export function specKey(spec: GroundMaterialSpec): string {
    const s = spec.structural;
    const pbrKey = `:pbr:${s.pbrEnabled ? 1 : 0}`;
    const infKey = `:inf:${s.geometry === 'infinite' ? 1 : 0}`;
    const proceduralKey =
        s.proceduralTexture !== 'none' && !s.textureEnabled
            ? `:proc:${s.proceduralTexture}:${s.proceduralSeed}:${s.proceduralScale}:overlay:${s.overlay}`
            : '';

    if (s.geometry === 'terrain') {
        return [
            'heightmap',
            s.terrainHeight,
            s.terrainScale,
            s.terrainSeed,
            s.terrainOctaves,
            s.level,
            s.size,
            s.color.join(','),
            s.alpha,
            s.textureEnabled ? 1 : 0,
            s.textureUrl,
            s.textureScale,
            s.textureRotation,
            pbrKey,
            proceduralKey,
            infKey,
        ].join(':');
    }
    if (s.textureEnabled && s.textureUrl) {
        return ['texture', s.textureUrl, s.size, s.reflectionQuality, pbrKey, infKey].join(':');
    }
    return [
        'canvas',
        s.canvasStyle,
        s.gridSize,
        s.color.join(','),
        s.lineColor.join(','),
        s.size,
        s.reflectionQuality,
        pbrKey,
        proceduralKey,
        infKey,
    ].join(':');
}

/** diffSpec 的结构性结论：是否需要重建。 */
export function groundSpecNeedsRebuild(
    prev: GroundMaterialSpec,
    next: GroundMaterialSpec
): boolean {
    return specKey(prev) !== specKey(next);
}

// ===================================================================
// 4. applyGroundMaterialSpec — 把 spec 落到已有材质（取代原地路径散布 mutate）
// ===================================================================

/**
 * 统一「填材质」逻辑。
 * @param isRebuild true=刚创建材质（各 source 分支自行设定正确 uScale）；
 *                  false=原地增量（UV 密度由通用块按 groundTextureScale 覆盖）。
 */
export function applyGroundMaterialSpec(
    mat: GroundMat,
    state: EnvState,
    scene: Scene,
    isRebuild = false
): void {
    const spec = buildGroundMaterialSpec(state);
    const sk = spec.structural;
    const ap = spec.appearance;

    const meshSize =
        state.groundType === 'terrain'
            ? state.groundSize
            : state.groundInfiniteEnabled
              ? INFINITE_GROUND_SIZE
              : state.groundSize;

    // ---- albedo source ----
    if (sk.sourceKind === 'procedural') {
        if (isRebuild) {
            const texs = generateProceduralGroundTextures(
                sk.proceduralTexture as Exclude<GroundProceduralKind, 'none'>,
                sk.proceduralSeed,
                scene,
                state
            );
            const scale = meshSize / 10 / Math.max(0.1, sk.proceduralScale);
            texs.albedo.uScale = texs.albedo.vScale = scale;
            texs.roughness.uScale = texs.roughness.vScale = scale;
            texs.normal.uScale = texs.normal.vScale = scale;
            _setAlbedoTex(mat, texs.albedo);
            _setAlbedoColor(mat, new Color3(1, 1, 1));
            if (mat instanceof PBRMaterial) {
                mat.bumpTexture = texs.normal;
                mat.bumpTexture.level = _effectiveBumpLevel(state);
                mat.metallicTexture = texs.roughness;
                mat.useRoughnessFromMetallicTextureAlpha = false;
                mat.useRoughnessFromMetallicTextureGreen = true;
            }
        }
        // 原地路径：程序化 albedo 已在 create 时生成，不重生成（与原地路径一致）
    } else if (sk.sourceKind === 'canvas') {
        _updateGroundTexture(mat, state);
        if (isRebuild) {
            const t = _getAlbedoTex(mat);
            if (t) {
                t.uScale = t.vScale = meshSize / 10 / Math.max(0.1, ap.textureScale);
            }
        }
    } else if (sk.sourceKind === 'texture') {
        _setAlbedoColor(mat, new Color3(1, 1, 1));
        _syncTextureGroundTexture(mat, state, scene); // 内部按 meshSize 设 uScale
    } else {
        // solid
        if (isRebuild) {
            _setAlbedoColor(mat, new Color3(sk.color[0], sk.color[1], sk.color[2]));
        }
    }

    // ---- alpha / transparency ----
    mat.alpha = ap.alpha;
    if (mat instanceof PBRMaterial) {
        mat.transparencyMode = _needAlphaBlend(state)
            ? Material.MATERIAL_ALPHABLEND
            : Material.MATERIAL_OPAQUE;
    }

    // ---- 原地专属：UV 密度 + 滚动 offset（重建由各 source 分支自行设 uScale）----
    if (!isRebuild) {
        const albedoTex = _getAlbedoTex(mat);
        if (albedoTex && albedoTex instanceof Texture) {
            albedoTex.uScale = albedoTex.vScale = meshSize / 10 / Math.max(0.1, ap.textureScale);
            _syncAllTextureOffsets(mat, state);
        }
    }

    // ---- normal / ripple / pbr / edge ----
    // 程序化来源自带法线贴图：空 groundNormalTexture 时保留程序化 normal，
    // 仅用户显式提供外部法线贴图才覆盖。否则 _syncGroundNormalTexture 的 else
    // 分支会把程序化 normal 清掉（与 legacy 重建路径一致，且修复 legacy 原地路径
    // 清掉程序化法线的历史 bug）。见 ADR-226。
    if (sk.sourceKind !== 'procedural' || state.groundNormalTexture) {
        _syncGroundNormalTexture(mat, state);
    }
    if (hasActiveGroundRipples()) {
        _syncGroundRippleTexture(mat, scene);
    } else {
        _disableGroundRippleTexture(mat);
    }
    if (mat instanceof PBRMaterial) {
        _syncPbrProperties(mat, state);
    }
    applyGroundEdgeFade(mat, ap.edgeFade, scene);
    // [doc:adr-230] 自发光增量同步（外观性，不触发重建）。
    _syncGroundEmissive(mat, state);
    // [adr-230 P1-fix] 水下焦散优先：同步完自发光后若在水下，重放焦散避免覆盖
    // （underwaterFogController 仅在边界穿越时写 emissive，此处必须显式重放）。
    if (underwaterFogController.isCausticsActive()) {
        underwaterFogController.applyCausticsTo(mat, scene);
    }
}

// ===================================================================
// 5. createGroundMeshFromSpec — 建几何 + 基础材质 + 填材质（取代重建路径 if/else）
// ===================================================================

/** 创建地面 mesh 并落好材质。Phase 1 已接入：applyGround 非 terrain 重建路径调用本函数。 */
export function createGroundMeshFromSpec(state: EnvState, scene: Scene): Mesh {
    const spec = buildGroundMaterialSpec(state);

    // ---- 地形 ----
    if (spec.structural.geometry === 'terrain') {
        const hg = createHeightmapGround(state, scene, (gm: GroundMesh) => {
            const mat = gm.material as GroundMat;
            applyTerrainMaterial(gm, state, scene);
            // [adr-230 P1] 先 install 再 applyGroundMaterialSpec：install 捕获初始快照后，
            // _syncGroundEmissive 内的 noteGroundEmissiveChanged 会把 orig 刷新为当前用户态
            // emissive（避免水下重建时 orig 误捕获焦散纹理，出水后残留焦散）。
            underwaterFogController.install(mat);
            applyGroundMaterialSpec(mat, state, scene, true);
            triggerTerrainReady();
        });
        setGroundMesh(hg);
        buildGroundReflection(state);
        return hg;
    }

    // ---- 平面 / 无限 ----
    const meshSize = state.groundInfiniteEnabled ? INFINITE_GROUND_SIZE : state.groundSize;
    const ground = MeshBuilder.CreateGround(
        'envGround',
        { width: meshSize, height: meshSize, subdivisions: 2 },
        scene
    );
    ground.isPickable = false;
    ground.position.y = state.groundLevel;
    ground.rotation.x = (state.groundPitch * Math.PI) / 180;
    ground.rotation.z = (state.groundRoll * Math.PI) / 180;

    const mat = createGroundMaterial(state, scene);
    mat.alpha = state.groundAlpha;
    mat.backFaceCulling = false; // 与 legacy applyGround 重建路径对齐（L1284）
    ground.material = mat;

    setGroundActualSize(meshSize);
    // [adr-230 P1] 先 install 再 applyGroundMaterialSpec（理由同上：避免水下重建
    // 时 orig 误捕获焦散纹理）。
    underwaterFogController.install(mat);
    applyGroundMaterialSpec(mat, state, scene, true);
    setGroundMesh(ground);
    buildGroundReflection(state);
    return ground;
}
