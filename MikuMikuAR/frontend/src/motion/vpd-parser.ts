// vpd-parser.ts — VPD 文本姿势文件解析器
// [doc:architecture] 程序化动作子系统 — VPD 解析 + VMD 生成
// VPD 格式：MMD 导出姿势文件，纯文本，记录骨骼变换。
// 本模块解析 VPD 并转换为 VMD 二进制，供 loadVMDMotion 加载。
// VMD 生成委托给 vmd-writer.ts（标准 111/23 字节帧格式）。

import { buildVmd, type BoneKeyFrame } from "./vmd-writer";

// VPD 解析结果
export interface VPDBoneData {
    name: string;
    position: [number, number, number];
    rotation: [number, number, number, number]; // 四元数
}

export interface VPDPoseData {
    modelName: string;
    bones: VPDBoneData[];
}

// ========== VPD 文本解析 ==========

/** 解码 VPD 文本（支持 UTF-8 / Shift-JIS 兜底）。
 *  @param buffer 文件原始字节
 *  @returns 解码后的文本字符串 */
export function decodeVPDData(buffer: ArrayBuffer): string {
    const u8 = new Uint8Array(buffer);
    // UTF-8 BOM (0xEF 0xBB 0xBF)
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
        return new TextDecoder("utf-8").decode(buffer.slice(3));
    }
    // UTF-16LE BOM (0xFF 0xFE)
    if (u8[0] === 0xFF && u8[1] === 0xFE) {
        return new TextDecoder("utf-16le").decode(buffer);
    }
    // 无 BOM → 尝试 UTF-8；若含无效 UTF-8 序列则回退 Shift-JIS
    try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        return text;
    } catch {
        // Shift-JIS 兜底（部分 MMD 模型导出 VPD 使用 Shift-JIS）
        return new TextDecoder("shift-jis").decode(buffer);
    }
}

/** 解析 VPD 文本为结构化数据。
 *  VPD 格式：骨骼名独立一行，下一行为位置 (x y z)，再下一行为旋转 (x y z w)。*/
export function parseVPDText(text: string): VPDPoseData {
    const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    const bones: VPDBoneData[] = [];
    let modelName = "";
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // 跳过元数据行
        if (line.startsWith("Vocaloid Pose Data")) { i++; continue; }
        if (line.startsWith("//") || line.startsWith(";")) { i++; continue; }
        if (line.startsWith("{") || line.startsWith("}")) { i++; continue; }

        // model 行
        if (line.startsWith("model")) {
            const m = line.match(/model\s+"([^"]+)"/);
            if (m) modelName = m[1];
            i++;
            continue;
        }

        // 骨骼名行：格式 "BoneN:名称" 或 "名称"
        // 下一行是位置，再下一行是旋转
        const nameMatch = line.match(/^(?:Bone\d+:)?(.+)$/);
        if (nameMatch) {
            const name = nameMatch[1].trim();
            // 读取位置行（下一行）
            if (i + 1 < lines.length) {
                const posParts = lines[i + 1].trim().split(/\s+/).map(Number);
                if (posParts.length >= 3) {
                    // 读取旋转行（再下一行）
                    if (i + 2 < lines.length) {
                        const rotParts = lines[i + 2].trim().split(/\s+/).map(Number);
                        if (rotParts.length >= 4) {
                            bones.push({
                                name,
                                position: [posParts[0], posParts[1], posParts[2]],
                                rotation: [rotParts[0], rotParts[1], rotParts[2], rotParts[3]],
                            });
                            i += 3;
                            continue;
                        }
                    }
                }
            }
        }
        i++;
    }
    return { modelName, bones };
}

// ========== VMD 生成（委托 vmd-writer.ts）==========

/** 将 VPD 姿势数据转换为标准 VMD 二进制数据。
 *  所有骨骼帧写入帧号 0（静止姿势）。
 *  @param pose VPD 解析结果
 *  @returns 标准 VMD ArrayBuffer */
export function poseDataToVmdBuffer(pose: VPDPoseData): ArrayBuffer {
    const boneFrames: BoneKeyFrame[] = pose.bones.map(b => ({
        name: b.name,
        frame: 0, // VPD 是静止姿势，所有帧在帧 0
        position: b.position,
        rotation: b.rotation,
    }));
    return buildVmd(boneFrames, [], pose.modelName || "VPDPose");
}

/** 从 ArrayBuffer（VPD 文件内容）解析并生成 VMD。
 *  @param buffer VPD 文件原始字节
 *  @returns 标准 VMD ArrayBuffer */
export function loadVPDFromBuffer(buffer: ArrayBuffer): ArrayBuffer {
    const text = decodeVPDData(buffer);
    const pose = parseVPDText(text);
    if (pose.bones.length === 0) {
        throw new Error("VPD: no bone data found");
    }
    return poseDataToVmdBuffer(pose);
}
