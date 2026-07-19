// [doc:architecture] Pose Camera Angle — 多角度预设系统
// 职责: 定义预设相机角 + 切换逻辑（用于 Pose Studio 批量截图）

import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { setOrbitParams } from '../camera/camera';
import { scene } from '../scene';
import { modelRegistry, focusedModelId } from '../../core/config';

/** 预设角度定义 */
export interface CameraAnglePreset {
    name: string;
    /** 方位角（度） */
    azimuth: number;
    /** 仰角（度） */
    elevation: number;
    /** 距离 */
    distance: number;
    /** 描述 */
    description: string;
}

/** 预设相机角度列表 */
export const CAMERA_PRESETS: CameraAnglePreset[] = [
    { name: '正面', azimuth: 0, elevation: 10, distance: 22, description: '标准正面' },
    { name: '左45°', azimuth: -45, elevation: 10, distance: 22, description: '左侧45度' },
    { name: '右45°', azimuth: 45, elevation: 10, distance: 22, description: '右侧45度' },
    { name: '侧面', azimuth: -90, elevation: 5, distance: 22, description: '左侧面' },
    { name: '俯视', azimuth: 0, elevation: 45, distance: 28, description: '俯视45度' },
    { name: '特写', azimuth: 0, elevation: 5, distance: 12, description: '近距离特写' },
];

/**
 * 角色正面在世界中的基准相机 alpha（经验标定值）。
 * 模型默认朝向使正面落在世界 -Z，对应 Babylon ArcRotateCamera 的 alpha = -π/2；
 * 原代码把「正面」锚在 alpha=0（+X），导致实际拍到的是侧面。
 * 预设方位角相对此基准叠加，再减去模型当前偏航，使全部预设以角色朝向为参考。
 */
const FRONT_BASE_RAD = -Math.PI / 2;

/**
 * 聚焦模型绕 Y 轴的当前偏航（弧度）。
 * 用于让预设方位角随角色朝向旋转。
 */
function getFocusedModelYaw(): number {
    const id = focusedModelId;
    if (!id) {
        return 0;
    }
    const inst = modelRegistry.get(id);
    return inst?.rotationY ?? 0;
}

/**
 * 计算某预设对应的相机 alpha（弧度），以聚焦模型朝向为参考。
 * 公式：基准正面角 + 预设相对方位角(度→弧度) − 模型偏航。
 * 角色旋转 yaw 后，所有预设整体绕角色朝向旋转，保持「正面=正脸」不变。
 */
export function presetCameraAlpha(preset: CameraAnglePreset, yaw: number): number {
    return FRONT_BASE_RAD + (preset.azimuth * Math.PI) / 180 - yaw;
}

/**
 * 切换到指定预设角度。
 * 使用 ArcRotateCamera 的 alpha(方位角), beta(仰角), radius(距离)。
 * OrbitParams 不含 alpha，需直接操作 Babylon ArcRotateCamera。
 * 方位角以角色朝向为参考（基准正面角 + 预设相对方位 − 模型偏航）。
 */
export function applyCameraPreset(preset: CameraAnglePreset): void {
    const yaw = getFocusedModelYaw();
    const beta = Math.PI / 2 - (preset.elevation * Math.PI) / 180;
    setOrbitParams({
        beta,
        distance: preset.distance,
    });
    // alpha 不在 OrbitParams 中，直接设置相机；以角色朝向为参考
    const cam = scene.activeCamera;
    if (cam instanceof ArcRotateCamera) {
        cam.alpha = presetCameraAlpha(preset, yaw);
    }
}

/**
 * 获取所有预设的列表（用于 UI 展示）。
 */
export function getAllPresets(): CameraAnglePreset[] {
    return [...CAMERA_PRESETS];
}

/**
 * 按索引获取预设。
 */
export function getPreset(index: number): CameraAnglePreset | undefined {
    return CAMERA_PRESETS[index];
}
