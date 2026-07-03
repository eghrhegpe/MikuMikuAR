// vpd-parser.ts — VPD 文本姿势文件解析器
// [doc:architecture] 程序化动作子系统 — VPD 解析 + VMD 生成
// VPD 格式：MMD 导出姿势文件，纯文本，记录骨骼变换。
// 本模块解析 VPD 并转换为 VMD 二进制，供 loadVMDMotion 加载。
// VMD 生成委托给 vmd-writer.ts（标准 111/23 字节帧格式）。

import { buildVmd, type BoneKeyFrame, type MorphKeyFrame } from './vmd-writer';

// VPD 解析结果
export interface VPDBoneData {
    name: string;
    position: [number, number, number];
    rotation: [number, number, number, number]; // 四元数
}

export interface VPDMorphData {
    name: string;
    weight: number;
}

export interface VPDPoseData {
    modelName: string;
    bones: VPDBoneData[];
    morphs: VPDMorphData[];
}

// ========== VPD 文本解析 ==========

/** Clean a potential VPD numeric line: remove // comments, ; terminators, and commas.
 *  Returns the cleaned string with space-separated numbers, ready for splitting. */
function _cleanNumericLine(line: string): string {
    return line.replace(/\/\/.*$/, '').replace(/[;,]/g, ' ').trim();
}

/** 解码 VPD 文本（支持 UTF-8 / Shift-JIS 兜底）。
 *  @param buffer 文件原始字节
 *  @returns 解码后的文本字符串 */
export function decodeVPDData(buffer: ArrayBuffer): string {
    const u8 = new Uint8Array(buffer);
    // UTF-8 BOM (0xEF 0xBB 0xBF)
    if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
        return new TextDecoder('utf-8').decode(buffer.slice(3));
    }
    // UTF-16LE BOM (0xFF 0xFE)
    if (u8[0] === 0xff && u8[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(buffer);
    }
    // 无 BOM → 尝试 UTF-8；若含无效 UTF-8 序列则回退 Shift-JIS
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        return text;
    } catch {
        // Shift-JIS 兜底（部分 MMD 模型导出 VPD 使用 Shift-JIS）
        return new TextDecoder('shift-jis').decode(buffer);
    }
}

/** 解析 VPD 文本为结构化数据。
 *  VPD 格式：骨骼名独立一行，下一行为位置 (x y z)，再下一行为旋转 (x y z w)。*/
export function parseVPDText(text: string): VPDPoseData {
    const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    const bones: VPDBoneData[] = [];
    const morphs: VPDMorphData[] = [];
    let modelName = '';
    let i = 0;

    // 匹配骨骼名行：格式 "BoneN:名稱" 或纯名称，且后缀两行是数字
    // 排除已知元数据关键字，防止误匹配
    const _nonBonePrefix = /^(?:Vocaloid|model|\/\/|;|\{|\}|Bone\d+\s|\s*$)/;
    // 仅含数字的行（位置/旋转数据行）
    const _numericLine = /^[-\d.eE\s]+$/;
    // Morph 行格式：MorphN:名称
    const _morphLine = /^Morph\d+(?::|\{)(.+)$/;

    while (i < lines.length) {
        const line = lines[i];

        // 跳过元数据行
        if (_nonBonePrefix.test(line)) {
            if (line.startsWith('model')) {
                const m = line.match(/model\s+"([^"]+)"/);
                if (m) {
                    modelName = m[1];
                }
            }
            i++;
            continue;
        }

        // Morph 解析：MorphN:名称 下一行是单个浮点数 weight
        const morphMatch = line.match(_morphLine);
        if (morphMatch && i + 1 < lines.length) {
            const mName = morphMatch[1].trim();
            const wLine = lines[i + 1].trim();
            const w = Number(wLine);
            if (isFinite(w)) {
                morphs.push({ name: mName, weight: w });
                i += 2;
                continue;
            }
        }

        // 骨骼名匹配：需要后两行都是纯数字行且解析成功
        const nameMatch = line.match(/^(?:Bone\d+(?::|\{))?(.+)$/);
        if (nameMatch && i + 2 < lines.length) {
            const name = nameMatch[1].trim();
            // 清理数字行（移除 // 注释、; 终止符、逗号），兼容两种 VPD 格式
            const posClean = _cleanNumericLine(lines[i + 1]);
            const rotClean = _cleanNumericLine(lines[i + 2]);
            if (_numericLine.test(posClean) && _numericLine.test(rotClean)) {
                const posParts = posClean.split(/\s+/).map(Number);
                const rotParts = rotClean.split(/\s+/).map(Number);
                if (
                    posParts.length >= 3 &&
                    rotParts.length >= 4 &&
                    posParts.every((v: number) => isFinite(v)) &&
                    rotParts.every((v: number) => isFinite(v))
                ) {
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
        i++;
    }
    return { modelName, bones, morphs };
}

// ========== VMD 生成（委托 vmd-writer.ts）==========

/** 将 VPD 姿势数据转换为标准 VMD 二进制数据。
 *  所有骨骼帧写入帧号 0（静止姿势）。
 *  @param pose VPD 解析结果
 *  @returns 标准 VMD ArrayBuffer */
export function poseDataToVmdBuffer(pose: VPDPoseData): ArrayBuffer {
    const boneFrames: BoneKeyFrame[] = pose.bones.map((b) => ({
        name: b.name,
        frame: 0, // VPD 是静止姿势，所有帧在帧 0
        position: b.position,
        rotation: b.rotation,
    }));
    const morphFrames: MorphKeyFrame[] = (pose.morphs || []).map((m) => ({
        name: m.name,
        frame: 0,
        weight: m.weight,
    }));
    return buildVmd(boneFrames, morphFrames, pose.modelName || 'VPDPose');
}

/** 从 ArrayBuffer（VPD 文件内容）解析并生成 VMD。
 *  @param buffer VPD 文件原始字节
 *  @returns 标准 VMD ArrayBuffer */
export function loadVPDFromBuffer(buffer: ArrayBuffer): ArrayBuffer {
    const text = decodeVPDData(buffer);
    const pose = parseVPDText(text);
    if (pose.bones.length === 0) {
        throw new Error('VPD: no bone data found');
    }
    return poseDataToVmdBuffer(pose);
}
