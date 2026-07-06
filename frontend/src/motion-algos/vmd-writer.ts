// vmd-writer.ts — 正确的二进制 VMD 写入器
// [doc:architecture] 程序化动作子系统 — VMD 二进制生成
// 帧格式确认自 babylon-mmd/esm/Loader/Parser/vmdObject.js:
//   BoneKeyFrameBytes = 15+4+12+16+64 = 111
//   MorphKeyFrameBytes = 15+4+4 = 23

import Encoding from 'encoding-japanese';

export interface BoneKeyFrame {
    name: string; // 骨骼名（Shift-JIS 编码）
    frame: number; // 帧号 (30fps)
    position: [number, number, number];
    rotation: [number, number, number, number]; // 四元数 (x,y,z,w)
    interp?: InterpCurve; // 插值曲线，默认 LINEAR
}

export interface MorphKeyFrame {
    name: string; // morph 名
    frame: number;
    weight: number; // 0..1
}

// VMD 插值曲线预设（64 字节 = 16 组 × 4 字节 [x1,y1,x2,y2]，值域 0-127）
export interface InterpCurve {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}
export const INTERP_LINEAR: InterpCurve = { x1: 20, y1: 20, x2: 107, y2: 107 };
export const INTERP_EASE_IN_OUT: InterpCurve = { x1: 20, y1: 40, x2: 80, y2: 107 };
export const INTERP_EASE_OUT: InterpCurve = { x1: 20, y1: 80, x2: 107, y2: 107 };
export const INTERP_EASE_IN: InterpCurve = { x1: 20, y1: 20, x2: 40, y2: 107 };
export const INTERP_SHARP: InterpCurve = { x1: 30, y1: 10, x2: 90, y2: 107 };

export const BONE_FRAME_SIZE = 111;
export const MORPH_FRAME_SIZE = 23;
const SIGNATURE = 'Vocaloid Motion Data 0002\0'; // 30 bytes
const DEFAULT_MODEL_NAME = 'Procedural'; // ≤20 bytes

/** 将字符串编码为 Shift-JIS 字节数组，截断/填充至 maxBytes。使用 encoding-japanese 完整覆盖 JIS X 0208。 */
function encodeShiftJis(str: string, maxBytes: number): Uint8Array {
    const sjisArr = Encoding.convert(str, {
        to: 'SJIS',
        from: 'UNICODE',
        type: 'array',
    });
    const clamped = sjisArr.slice(0, maxBytes);
    const result = new Uint8Array(maxBytes);
    result.set(clamped);
    return result;
}

/** Shift-JIS 编码字符串到 15 字节（空字节 0x00 填充）。 */
function encodeBoneName(name: string): Uint8Array {
    return encodeShiftJis(name, 15);
}

/** Shift-JIS 编码字符串到 20 字节（模型名字段用）。 */
function encodeModelName(name: string): Uint8Array {
    return encodeShiftJis(name, 20);
}

/** 检查名称能否被完整编码为 Shift-JIS（round-trip 无误）。 */
export function canEncodeName(name: string): boolean {
    const sjisArr = Encoding.convert(name, {
        to: 'SJIS',
        from: 'UNICODE',
        type: 'array',
    });
    const roundTrip = Encoding.convert(sjisArr, {
        to: 'UNICODE',
        from: 'SJIS',
        type: 'string',
    });
    return roundTrip === name;
}

/** 构建单个骨骼关键帧 (111 bytes)。插值用线性默认值。 */
export function buildBoneFrame(frame: BoneKeyFrame): ArrayBuffer {
    const buf = new ArrayBuffer(BONE_FRAME_SIZE);
    const view = new DataView(buf);
    let off = 0;
    const nameBytes = encodeBoneName(frame.name);
    for (let i = 0; i < 15; i++) {
        view.setUint8(off++, nameBytes[i]);
    }
    view.setUint32(off, frame.frame, true);
    off += 4;
    view.setFloat32(off, frame.position[0], true);
    off += 4;
    view.setFloat32(off, frame.position[1], true);
    off += 4;
    view.setFloat32(off, frame.position[2], true);
    off += 4;
    view.setFloat32(off, frame.rotation[0], true);
    off += 4;
    view.setFloat32(off, frame.rotation[1], true);
    off += 4;
    view.setFloat32(off, frame.rotation[2], true);
    off += 4;
    view.setFloat32(off, frame.rotation[3], true);
    off += 4;
    // 64 bytes 插值：16 组 × 4 字节 [x1,y1,x2,y2]，默认 LINEAR
    const interp = frame.interp ?? INTERP_LINEAR;
    for (let i = 0; i < 16; i++) {
        view.setUint8(off++, interp.x1);
        view.setUint8(off++, interp.y1);
        view.setUint8(off++, interp.x2);
        view.setUint8(off++, interp.y2);
    }
    return buf;
}

/** 构建单个 morph 关键帧 (23 bytes)。 */
export function buildMorphFrame(frame: MorphKeyFrame): ArrayBuffer {
    const buf = new ArrayBuffer(MORPH_FRAME_SIZE);
    const view = new DataView(buf);
    let off = 0;
    const nameBytes = encodeBoneName(frame.name);
    for (let i = 0; i < 15; i++) {
        view.setUint8(off++, nameBytes[i]);
    }
    view.setUint32(off, frame.frame, true);
    off += 4;
    view.setFloat32(off, frame.weight, true);
    off += 4;
    return buf;
}

/** 构建完整 VMD ArrayBuffer。
 *  结构: 30(sig) + 20(model) + 4(boneCount) + boneFrames + 4(morphCount) + morphFrames
 *       + 4(cameraCount=0) + 4(lightCount=0) + 4(selfShadowCount=0) + 4(ikCount=0) */
export function buildVmd(
    boneFrames: BoneKeyFrame[],
    morphFrames: MorphKeyFrame[] = [],
    modelName: string = DEFAULT_MODEL_NAME
): ArrayBuffer {
    // 确保帧按帧号排序，防止解析器插值异常
    boneFrames.sort((a, b) => a.frame - b.frame);
    morphFrames.sort((a, b) => a.frame - b.frame);

    const headerSize = 30 + 20 + 4;
    const boneSize = boneFrames.length * BONE_FRAME_SIZE;
    const morphSize = morphFrames.length * MORPH_FRAME_SIZE;
    const trailer = 4 + 4 + 4 + 4; // camera + light + selfShadow + ik counts (all 0)
    const total = headerSize + boneSize + 4 + morphSize + trailer;
    const buf = new ArrayBuffer(total);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let off = 0;

    // Signature (30 bytes)
    const sig = new TextEncoder().encode(SIGNATURE);
    for (let i = 0; i < 30; i++) {
        u8[off++] = sig[i] ?? 0;
    }

    // Model name (20 bytes, Shift-JIS 编码)
    const modelNameBytes = encodeModelName(modelName);
    for (let i = 0; i < 20; i++) {
        u8[off++] = modelNameBytes[i];
    }

    // Bone frame count + frames
    view.setUint32(off, boneFrames.length, true);
    off += 4;
    for (const f of boneFrames) {
        u8.set(new Uint8Array(buildBoneFrame(f)), off);
        off += BONE_FRAME_SIZE;
    }

    // Morph frame count + frames
    view.setUint32(off, morphFrames.length, true);
    off += 4;
    for (const f of morphFrames) {
        u8.set(new Uint8Array(buildMorphFrame(f)), off);
        off += MORPH_FRAME_SIZE;
    }

    // Trailer: camera / light / selfShadow / ik counts = 0
    for (let i = 0; i < 4; i++) {
        view.setUint32(off, 0, true);
        off += 4;
    }

    return buf;
}
