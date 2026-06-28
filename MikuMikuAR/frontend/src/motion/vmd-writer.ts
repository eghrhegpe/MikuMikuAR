// vmd-writer.ts — 正确的二进制 VMD 写入器
// [doc:architecture] 程序化动作子系统 — VMD 二进制生成
// 帧格式确认自 babylon-mmd/esm/Loader/Parser/vmdObject.js:
//   BoneKeyFrameBytes = 15+4+12+16+64 = 111
//   MorphKeyFrameBytes = 15+4+4 = 23

export interface BoneKeyFrame {
    name: string;       // 骨骼名（Shift-JIS 编码）
    frame: number;      // 帧号 (30fps)
    position: [number, number, number];
    rotation: [number, number, number, number]; // 四元数 (x,y,z,w)
}

export interface MorphKeyFrame {
    name: string;       // morph 名
    frame: number;
    weight: number;     // 0..1
}

export const BONE_FRAME_SIZE = 111;
export const MORPH_FRAME_SIZE = 23;
const SIGNATURE = "Vocaloid Motion Data 0002\0"; // 30 bytes
const DEFAULT_MODEL_NAME = "Procedural"; // ≤20 bytes

/** Shift-JIS 编码骨骼名到 15 字节（空格 0x20 填充）。
 *  浏览器无内置 Shift-JIS 编码器，用 UTF-8 兜底（babylon-mmd 解码时同样回退）。 */
function encodeBoneName(name: string): Uint8Array {
    const buf = new Uint8Array(15).fill(0x20);
    const bytes = new TextEncoder().encode(name);
    for (let i = 0; i < Math.min(bytes.length, 15); i++) buf[i] = bytes[i];
    return buf;
}

/** 构建单个骨骼关键帧 (111 bytes)。插值用线性默认值。 */
export function buildBoneFrame(frame: BoneKeyFrame): ArrayBuffer {
    const buf = new ArrayBuffer(BONE_FRAME_SIZE);
    const view = new DataView(buf);
    let off = 0;
    const nameBytes = encodeBoneName(frame.name);
    for (let i = 0; i < 15; i++) view.setUint8(off++, nameBytes[i]);
    view.setUint32(off, frame.frame, true); off += 4;
    view.setFloat32(off, frame.position[0], true); off += 4;
    view.setFloat32(off, frame.position[1], true); off += 4;
    view.setFloat32(off, frame.position[2], true); off += 4;
    view.setFloat32(off, frame.rotation[0], true); off += 4;
    view.setFloat32(off, frame.rotation[1], true); off += 4;
    view.setFloat32(off, frame.rotation[2], true); off += 4;
    view.setFloat32(off, frame.rotation[3], true); off += 4;
    // 64 bytes 插值：线性默认 (x1=20,y1=20,x2=107,y2=107) 每 4 字节重复 16 次
    for (let i = 0; i < 16; i++) {
        view.setUint8(off++, 20);   // x1
        view.setUint8(off++, 20);   // y1
        view.setUint8(off++, 107);  // x2
        view.setUint8(off++, 107);  // y2
    }
    return buf;
}

/** 构建单个 morph 关键帧 (23 bytes)。 */
export function buildMorphFrame(frame: MorphKeyFrame): ArrayBuffer {
    const buf = new ArrayBuffer(MORPH_FRAME_SIZE);
    const view = new DataView(buf);
    let off = 0;
    const nameBytes = encodeBoneName(frame.name);
    for (let i = 0; i < 15; i++) view.setUint8(off++, nameBytes[i]);
    view.setUint32(off, frame.frame, true); off += 4;
    view.setFloat32(off, frame.weight, true); off += 4;
    return buf;
}

/** 构建完整 VMD ArrayBuffer。boneFrames/morphFrames 可为空数组。
 *  结构: 30(sig) + 20(model) + 4(boneCount) + boneFrames + 4(morphCount) + morphFrames
 *       + 4(cameraCount=0) + 4(lightCount=0) + 4(shadowCount=0) */
export function buildVmd(
    boneFrames: BoneKeyFrame[],
    morphFrames: MorphKeyFrame[] = [],
    modelName: string = DEFAULT_MODEL_NAME,
): ArrayBuffer {
    const headerSize = 30 + 20 + 4;
    const boneSize = boneFrames.length * BONE_FRAME_SIZE;
    const morphSize = morphFrames.length * MORPH_FRAME_SIZE;
    const trailer = 4 + 4 + 4; // camera + light + shadow counts (all 0)
    const total = headerSize + boneSize + 4 + morphSize + trailer;
    const buf = new ArrayBuffer(total);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let off = 0;

    // Signature (30 bytes)
    const sig = new TextEncoder().encode(SIGNATURE);
    for (let i = 0; i < 30; i++) u8[off++] = sig[i] ?? 0;

    // Model name (20 bytes, Shift-JIS/UTF-8, null-padded)
    const nameBytes = new TextEncoder().encode(modelName);
    for (let i = 0; i < Math.min(nameBytes.length, 20); i++) u8[off++] = nameBytes[i];
    off = 50; // skip remaining name bytes (already 0)

    // Bone frame count + frames
    view.setUint32(off, boneFrames.length, true); off += 4;
    for (const f of boneFrames) {
        const fb = new Uint8Array(buildBoneFrame(f));
        u8.set(fb, off);
        off += BONE_FRAME_SIZE;
    }

    // Morph frame count + frames
    view.setUint32(off, morphFrames.length, true); off += 4;
    for (const f of morphFrames) {
        const fb = new Uint8Array(buildMorphFrame(f));
        u8.set(fb, off);
        off += MORPH_FRAME_SIZE;
    }

    // Trailer: camera/light/shadow counts = 0
    view.setUint32(off, 0, true); off += 4;
    view.setUint32(off, 0, true); off += 4;
    view.setUint32(off, 0, true); off += 4;

    return buf;
}
