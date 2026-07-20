// [doc:architecture] Light Cone — 真实光锥网格 + ShaderMaterial（替代 ADR-152 的屏幕后处理假体积光）
// 职责: 为 SpotLight 生成可见锥形光柱，附加 blending + fresnel 边缘辉光
// 原理: 锥体 Mesh + 自定义 Shader（additive blending, 距离衰减 + 视角边缘增强）

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { safeDispose } from '@/core/dispose-helpers';

// ======== Shader Sources ========

const CONE_VERT = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec3 normal;

uniform mat4 world;
uniform mat4 worldViewProjection;

varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
    vec4 wp = world * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(world) * normal);
    gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const CONE_FRAG = /* glsl */ `
precision highp float;

varying vec3 vWorldPos;
varying vec3 vNormal;

uniform vec3 u_color;
uniform float u_intensity;
uniform float u_softness;
uniform float u_coneLength;
uniform vec3 u_apexPos;
uniform vec3 u_cameraPos;

void main() {
    // 距锥顶距离 → 归一化 t (0=顶点, 1=底面)
    float dist = length(vWorldPos - u_apexPos);
    float t = clamp(dist / max(u_coneLength, 0.01), 0.0, 1.0);

    // 距离衰减：靠近光源亮，远离渐隐
    float distFade = pow(1.0 - t, 1.5);

    // Fresnel 边缘辉光：视线与法线越垂直（边缘），越亮
    vec3 viewDir = normalize(u_cameraPos - vWorldPos);
    vec3 n = normalize(vNormal);
    float NdotV = abs(dot(n, viewDir));
    float fresnel = pow(1.0 - NdotV, 1.0 + u_softness * 2.0);

    // 合成：基础可见度 + 边缘增强
    float alpha = u_intensity * distFade * (0.12 + 0.88 * fresnel);
    alpha = clamp(alpha, 0.0, 1.0);

    gl_FragColor = vec4(u_color * alpha, alpha);
}
`;

// ======== Types ========

export interface LightConeEntry {
    mesh: Mesh;
    material: ShaderMaterial;
    /** 当前几何对应的锥长（变化时需重建几何） */
    geoLength: number;
    /** 当前几何对应的锥角（变化时需重建几何） */
    geoAngle: number;
}

// ======== Geometry ========

/** 创建锥体网格：顶点在原点，沿 +Y 延伸 */
function _createConeMesh(scene: Scene, coneLength: number, halfAngle: number): Mesh {
    const baseRadius = Math.tan(halfAngle) * coneLength;
    const cone = MeshBuilder.CreateCylinder(
        'lightCone',
        {
            height: coneLength,
            diameterTop: baseRadius * 2,
            diameterBottom: 0, // 锥顶在底部
            tessellation: 48,
            subdivisions: 4,
        },
        scene
    );
    // 将锥顶（原 y=-h/2）平移到原点
    cone.bakeTransformIntoVertices(Matrix.Translation(0, coneLength / 2, 0));
    cone.isPickable = false;
    cone.renderingGroupId = 1; // 在透明物体之后渲染
    return cone;
}

// ======== Material ========

function _createConeMaterial(scene: Scene): ShaderMaterial {
    const mat = new ShaderMaterial(
        'lightConeMat',
        scene,
        { vertexSource: CONE_VERT, fragmentSource: CONE_FRAG },
        {
            attributes: ['position', 'normal'],
            uniforms: [
                'world',
                'worldViewProjection',
                'u_color',
                'u_intensity',
                'u_softness',
                'u_coneLength',
                'u_apexPos',
                'u_cameraPos',
            ],
            needAlphaBlending: true,
        }
    );
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.backFaceCulling = false; // 双面渲染 → 体积感
    mat.disableDepthWrite = true; // 不写深度（避免遮挡其他透明物体）
    return mat;
}

// ======== Orientation ========

/** 计算将 +Y 对齐到 dir 的四元数 */
function _alignYToDir(dir: Vector3): Quaternion {
    const up = Vector3.Up();
    const d = Vector3.Dot(up, dir);
    if (d > 0.9999) {
        return Quaternion.Identity();
    }
    if (d < -0.9999) {
        return Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI);
    }
    const axis = Vector3.Cross(up, dir).normalize();
    const angle = Math.acos(Math.min(1, Math.max(-1, d)));
    return Quaternion.RotationAxis(axis, angle);
}

// ======== Public API ========

/**
 * 为聚光灯创建光锥。
 * @param scene Babylon 场景
 * @param light 聚光灯实例
 * @param color 光色
 * @param intensity 光锥亮度 (0-2)
 * @param coneLength 锥长
 * @param softness 边缘柔和度 (0-1)
 */
export function createLightCone(
    scene: Scene,
    light: SpotLight,
    color: Color3,
    intensity: number,
    coneLength: number,
    softness: number
): LightConeEntry {
    const halfAngle = light.angle / 2;
    const mesh = _createConeMesh(scene, coneLength, halfAngle);
    const material = _createConeMaterial(scene);
    mesh.material = material;

    // 初始 transform
    _applyTransform(mesh, light);

    // 初始 uniforms
    material.setColor3('u_color', color);
    material.setFloat('u_intensity', intensity);
    material.setFloat('u_softness', softness);
    material.setFloat('u_coneLength', coneLength);
    material.setVector3('u_apexPos', light.position.clone());

    return { mesh, material, geoLength: coneLength, geoAngle: light.angle };
}

/** 更新光锥的 transform（位置/朝向），每帧或灯光移动时调用 */
export function updateLightConeTransform(
    entry: LightConeEntry,
    light: SpotLight,
    coneLength: number
): void {
    _applyTransform(entry.mesh, light);
    // 复用模块级对象，避免每帧 clone 产生 GC 压力
    _tmpApex.x = light.position.x;
    _tmpApex.y = light.position.y;
    _tmpApex.z = light.position.z;
    entry.material.setVector3('u_apexPos', _tmpApex);
}

/** 更新光锥的 shader uniforms（颜色/亮度/柔和度） */
export function updateLightConeUniforms(
    entry: LightConeEntry,
    color: Color3,
    intensity: number,
    softness: number,
    coneLength: number
): void {
    entry.material.setColor3('u_color', color);
    entry.material.setFloat('u_intensity', intensity);
    entry.material.setFloat('u_softness', softness);
    entry.material.setFloat('u_coneLength', coneLength);
}

/** 锥长/锥角变化时重建几何 */
export function rebuildLightConeGeometry(
    entry: LightConeEntry,
    scene: Scene,
    light: SpotLight,
    coneLength: number
): void {
    const halfAngle = light.angle / 2;
    // 仅在参数实际变化时重建
    if (Math.abs(entry.geoLength - coneLength) < 0.01 && Math.abs(entry.geoAngle - light.angle) < 0.001) {
        return;
    }
    // 重建几何（保留材质）
    const oldMesh = entry.mesh;
    const newMesh = _createConeMesh(scene, coneLength, halfAngle);
    newMesh.material = entry.material;
    newMesh.setEnabled(oldMesh.isEnabled());
    safeDispose(oldMesh);
    entry.mesh = newMesh;
    entry.geoLength = coneLength;
    entry.geoAngle = light.angle;
    _applyTransform(newMesh, light);
}

/** 设置光锥可见性 */
export function setLightConeEnabled(entry: LightConeEntry, enabled: boolean): void {
    entry.mesh.setEnabled(enabled);
}

/** 释放光锥资源（先 mesh 后 material，避免 mesh.dispose 内部引用已释放材质） */
export function disposeLightCone(entry: LightConeEntry): void {
    safeDispose(entry.mesh);
    safeDispose(entry.material);
}

// ======== Internal ========

/** 模块级临时向量（避免 updateLightConeTransform 每帧 clone 产生 GC 压力） */
const _tmpApex = { x: 0, y: 0, z: 0 };

function _applyTransform(mesh: Mesh, light: SpotLight): void {
    mesh.position.copyFrom(light.position);
    // SpotLight.direction 已归一化，直接对齐
    const dir = light.direction.normalize();
    mesh.rotationQuaternion = _alignYToDir(dir);
}
