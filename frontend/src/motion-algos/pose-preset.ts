// [doc:architecture] Pose Preset — T-pose / A-pose VMD 发生器
// 职责: 程序化生成 T-pose / A-pose / rest 的 VMD 二进制数据（经 VmdLoader 解析后应用）
// 路线: ADR-061 §2.2 — 2A 预设法（VPD 预设，零运行时依赖）
//
// [review] 骨骼名必须为 Shift-JIS 编码（VMD 规范）。原实现用 TextEncoder(UTF-8)
// 编码日文骨骼名（左腕/左ひじ 等）→ VmdLoader 按 Shift-JIS 读回得乱码 → 无法匹配
// 模型骨骼 → 姿态静默失效。现统一复用 vmd-writer.buildVmd（encoding-japanese 正确
// 编码 + 排序 + trailer），彻底消除手写二进制的编码风险。

import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import { buildVmd, type BoneKeyFrame } from './vmd-writer';

export type PoseType = 'tpose' | 'apose' | 'rest';

/**
 * 生成 T-pose / A-pose / rest 的 VMD 二进制数据，可经 VmdLoader 解析后应用。
 * 仅包含第 0 帧骨骼帧（无 morph/相机帧）。
 *
 * T-pose: 双臂水平展开（绕 Z 轴旋转约 90°，上腕外张）
 * A-pose: 双臂下垂约 45°（绕 Z 轴旋转约 -45°）
 * Rest:   空骨骼数据（所有骨骼保持 identity）
 */
export function generatePoseVmd(type: PoseType): ArrayBuffer {
    const boneFrames: BoneKeyFrame[] = [];

    // 按 MMD 标准日文骨骼名设置特定旋转（Babylon 原生 Euler→Quaternion，YXZ 顺序）
    function addBone(name: string, rx: number, ry: number, rz: number): void {
        const q = Quaternion.FromEulerAngles(rx, ry, rz);
        boneFrames.push({
            name,
            frame: 0,
            position: [0, 0, 0],
            rotation: [q.x, q.y, q.z, q.w],
        });
    }

    if (type === 'tpose') {
        // T-pose: 双臂水平展开
        addBone('左腕', 0, 0, -Math.PI / 2); // 左上臂外展
        addBone('右腕', 0, 0, Math.PI / 2); // 右上臂外展
        addBone('左ひじ', 0, 0, 0); // 左肘伸直
        addBone('右ひじ', 0, 0, 0); // 右肘伸直
        addBone('左肩', 0, 0, -Math.PI / 6); // 左肩微调
        addBone('右肩', 0, 0, Math.PI / 6); // 右肩微调
    } else if (type === 'apose') {
        // A-pose: 双臂 45° 下垂
        addBone('左腕', 0, 0, -Math.PI / 4);
        addBone('右腕', 0, 0, Math.PI / 4);
        addBone('左ひじ', 0, 0, Math.PI / 8); // 肘微曲
        addBone('右ひじ', 0, 0, -Math.PI / 8);
        addBone('左肩', 0, 0, -Math.PI / 12); // 肩微抬
        addBone('右肩', 0, 0, Math.PI / 12);
    }
    // rest: 无骨骼数据（空 boneFrames → 所有骨骼保持 identity）

    return buildVmd(boneFrames);
}
