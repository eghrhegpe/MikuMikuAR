// [doc:architecture] Pose Camera Angle — 多角度预设系统
// 职责: 定义预设相机角 + 切换逻辑（用于 Pose Studio 批量截图）

import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { getOrbitParams, setOrbitParams } from '../camera/camera';
import { scene } from '../scene';

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
 * 切换到指定预设角度。
 * 使用 ArcRotateCamera 的 alpha(方位角), beta(仰角), radius(距离)。
 * OrbitParams 不含 alpha，需直接操作 Babylon ArcRotateCamera。
 */
export function applyCameraPreset(preset: CameraAnglePreset): void {
    const beta = Math.PI / 2 - (preset.elevation * Math.PI) / 180;
    setOrbitParams({
        beta,
        distance: preset.distance,
    });
    // alpha 不在 OrbitParams 中，直接设置相机
    const cam = scene.activeCamera;
    if (cam instanceof ArcRotateCamera) {
        cam.alpha = (preset.azimuth * Math.PI) / 180;
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
