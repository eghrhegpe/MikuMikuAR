// [doc:architecture] Pose Preset — T-pose / A-pose VPD 发生器
// 职责: 程序化生成 T-pose（双臂水平）和 A-pose（双臂 45°下垂）VPD 二进制数据
// 路线: ADR-061 §2.2 — 2A 预设法（VPD 预设，零运行时依赖）

const VMD_HEADER_SIGNATURE = 'Vocaloid Motion Data 0002';
const BONE_FRAME_SIZE = 111; // 标准 VMD 骨骼帧大小

export type PoseType = 'tpose' | 'apose' | 'rest';

/**
 * 生成 T-pose 或 A-pose 的 VMD 二进制数据，可经 VmdLoader 解析后应用。
 * 仅包含骨骼帧（无 morph/相机帧）。
 * 
 * T-pose: 双臂水平展开（绕 Z 轴旋转约 90°，上腕外张）
 * A-pose: 双臂下垂约 45°（绕 Z 轴旋转约 -45°）
 * Rest: 返回默认姿态（零旋转）
 */
export function generatePoseVmd(type: PoseType): ArrayBuffer {
    // MMD 标准骨骼名（日文 + 英文变体）
    const poseData: Array<{ name: string; rotation: [number, number, number, number] }> = [];

    // 通用姿态数据：所有骨骼都设为 identity（零旋转、零偏移）
    const identityQ: [number, number, number, number] = [0, 0, 0, 1];
    const zeroPos: [number, number, number] = [0, 0, 0];

    // 需要设置特定旋转的骨骼（按 MMD 标准骨骼名）
    function addBone(name: string, rx: number, ry: number, rz: number): void {
        // 四元数从欧拉角（弧度）
        const cx = Math.cos(rx / 2);
        const sx = Math.sin(rx / 2);
        const cy = Math.cos(ry / 2);
        const sy = Math.sin(ry / 2);
        const cz = Math.cos(rz / 2);
        const sz = Math.sin(rz / 2);
        // ZYX 顺序
        const qw = cx * cy * cz + sx * sy * sz;
        const qx = sx * cy * cz - cx * sy * sz;
        const qy = cx * sy * cz + sx * cy * sz;
        const qz = cx * cy * sz - sx * sy * cz;
        poseData.push({ name, rotation: [qx, qy, qz, qw] });
    }

    if (type === 'tpose') {
        // T-pose: 双臂水平展开
        // 左腕: 绕 Z 轴旋转 -90°（上臂外展）
        addBone('左腕', 0, 0, -Math.PI / 2);
        // 右腕: 绕 Z 轴旋转 90°
        addBone('右腕', 0, 0, Math.PI / 2);
        // 左ひじ: 伸直
        addBone('左ひじ', 0, 0, 0);
        // 右ひじ: 伸直
        addBone('右ひじ', 0, 0, 0);
        // 肩: 微调
        addBone('左肩', 0, 0, -Math.PI / 6);
        addBone('右肩', 0, 0, Math.PI / 6);
    } else if (type === 'apose') {
        // A-pose: 双臂 45° 下垂
        addBone('左腕', 0, 0, -Math.PI / 4);
        addBone('右腕', 0, 0, Math.PI / 4);
        // ひじ微曲
        addBone('左ひじ', 0, 0, Math.PI / 8);
        addBone('右ひじ', 0, 0, -Math.PI / 8);
        // 肩微抬
        addBone('左肩', 0, 0, -Math.PI / 12);
        addBone('右肩', 0, 0, Math.PI / 12);
    }
    // rest: 无骨骼数据（所有骨骼保持 identity）

    // ── 构建 VMD 二进制 ──
    const encoder = new TextEncoder();
    const header = encoder.encode(VMD_HEADER_SIGNATURE);
    // 补到 30 字节
    const headerBuf = new Uint8Array(30);
    headerBuf.set(header.slice(0, 30));

    // 模型名（20 字节，全 0）
    const modelName = new Uint8Array(20);

    // 骨骼帧数
    const boneCount = poseData.length;
    const boneFrameBuf = new Uint8Array(boneCount * BONE_FRAME_SIZE);

    for (let i = 0; i < boneCount; i++) {
        const off = i * BONE_FRAME_SIZE;
        const pd = poseData[i];
        // 骨骼名（15 字节，Shift-JIS 编码）
        const nameBuf = encoder.encode(pd.name);
        for (let j = 0; j < Math.min(nameBuf.length, 15); j++) {
            boneFrameBuf[off + j] = nameBuf[j];
        }
        // 帧号（4 字节，uint32）— 第 0 帧
        const dv = new DataView(boneFrameBuf.buffer, boneFrameBuf.byteOffset + off);
        dv.setUint32(15, 0, true);
        // 位置（12 字节，3×float32）— 零位置
        dv.setFloat32(19, zeroPos[0], true);
        dv.setFloat32(23, zeroPos[1], true);
        dv.setFloat32(27, zeroPos[2], true);
        // 旋转（16 字节，4×float32）— 四元数
        dv.setFloat32(31, pd.rotation[0], true);
        dv.setFloat32(35, pd.rotation[1], true);
        dv.setFloat32(39, pd.rotation[2], true);
        dv.setFloat32(43, pd.rotation[3], true);
        // 插值曲线（64 字节）— 默认线性
        for (let k = 0; k < 64; k++) {
            boneFrameBuf[off + 47 + k] = k < 16 ? 0 : (k < 32 ? 127 : (k < 48 ? 0 : 127));
        }
    }

    // ── 计算总大小 ──
    // 头部 30 + 模型名 20 + 骨骼帧数 4 + 骨骼帧数据 + 尾部（morph 帧数 4 + 0 morph 帧 + camera/light/shadow/ik 各 4 字节=16）
    const tailSize = 4 + 0 + 16; // morph 帧数(0) + camera/light/shadow/ik 各 4 字节
    const totalSize = 30 + 20 + 4 + boneCount * BONE_FRAME_SIZE + tailSize;

    const out = new Uint8Array(totalSize);
    let off = 0;
    out.set(headerBuf, off); off += 30;
    out.set(modelName, off); off += 20;
    // 骨骼帧数
    const totalDv = new DataView(out.buffer);
    totalDv.setUint32(50, boneCount, true);
    off += 4;
    out.set(boneFrameBuf, off); off += boneCount * BONE_FRAME_SIZE;

    // morph 帧数 = 0
    const morphDv = new DataView(out.buffer, off);
    morphDv.setUint32(0, 0, true); off += 4;
    // camera/light/shadow/ik 计数
    for (let i = 0; i < 4; i++) {
        const subDv = new DataView(out.buffer, off);
        subDv.setUint32(0, 0, true);
        off += 4;
    }

    return out.buffer;
}
