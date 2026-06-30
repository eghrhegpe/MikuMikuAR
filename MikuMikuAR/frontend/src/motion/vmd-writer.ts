// vmd-writer.ts — 正确的二进制 VMD 写入器
// [doc:architecture] 程序化动作子系统 — VMD 二进制生成
// 帧格式确认自 babylon-mmd/esm/Loader/Parser/vmdObject.js:
//   BoneKeyFrameBytes = 15+4+12+16+64 = 111
//   MorphKeyFrameBytes = 15+4+4 = 23

export interface BoneKeyFrame {
    name: string; // 骨骼名（Shift-JIS 编码）
    frame: number; // 帧号 (30fps)
    position: [number, number, number];
    rotation: [number, number, number, number]; // 四元数 (x,y,z,w)
}

export interface MorphKeyFrame {
    name: string; // morph 名
    frame: number;
    weight: number; // 0..1
}

export const BONE_FRAME_SIZE = 111;
export const MORPH_FRAME_SIZE = 23;
const SIGNATURE = 'Vocaloid Motion Data 0002\0'; // 30 bytes
const DEFAULT_MODEL_NAME = 'Procedural'; // ≤20 bytes

// ======== Shift-JIS 轻量编码表 ========
// 覆盖程序化动作中使用的所有日文骨骼名（センター、上半身、頭、左腕、右腕 等）
// 以及常用 hiragana/katakana。未覆盖字符回退为码点低字节。
const _SJIS_MAP = new Map<number, number>(([
    // Katakana
    [0x30A2,0x8341],[0x30A4,0x8343],[0x30A6,0x8345],[0x30A8,0x8347],[0x30AA,0x8349],
    [0x30AB,0x834A],[0x30AD,0x834C],[0x30AF,0x834E],[0x30B1,0x8350],[0x30B3,0x8352],
    [0x30B5,0x8354],[0x30B7,0x8356],[0x30B9,0x8358],[0x30BB,0x835A],[0x30BD,0x835C],
    [0x30BF,0x835E],[0x30C1,0x8360],[0x30C4,0x8362],[0x30C6,0x8364],[0x30C8,0x8366],
    [0x30CA,0x8367],[0x30CB,0x8369],[0x30CC,0x836A],[0x30CD,0x836B],[0x30CE,0x836C],
    [0x30CF,0x836D],[0x30D2,0x8370],[0x30D5,0x8373],[0x30D8,0x8376],[0x30DB,0x8379],
    [0x30DE,0x837C],[0x30DF,0x837D],[0x30E0,0x837E],[0x30E1,0x837F],[0x30E2,0x8380],
    [0x30E4,0x8382],[0x30E6,0x8385],[0x30E8,0x8388],
    [0x30E9,0x8389],[0x30EA,0x838A],[0x30EB,0x838B],[0x30EC,0x838C],[0x30ED,0x838D],
    [0x30EF,0x838F],[0x30F2,0x8390],[0x30F3,0x8393],
    [0x30FC,0x815B], // ー
    // Hiragana
    [0x3042,0x82A0],[0x3044,0x82A2],[0x3046,0x82A4],[0x3048,0x82A6],[0x304A,0x82A8],
    [0x304B,0x82A9],[0x304D,0x82AB],[0x304F,0x82AD],[0x3051,0x82AF],[0x3053,0x82B1],
    [0x3055,0x82B3],[0x3057,0x82B5],[0x3059,0x82B7],[0x305B,0x82B9],[0x305D,0x82BB],
    [0x305F,0x82BD],[0x3061,0x82BF],[0x3064,0x82C2],[0x3066,0x82C4],[0x3068,0x82C6],
    [0x306A,0x82C7],[0x306B,0x82C9],[0x306C,0x82CA],[0x306D,0x82CB],[0x306E,0x82CC],
    [0x306F,0x82CD],[0x3072,0x82D0],[0x3075,0x82D3],[0x3078,0x82D6],[0x307B,0x82D9],
    [0x307E,0x82DC],[0x307F,0x82DD],[0x3080,0x82DE],[0x3081,0x82DF],[0x3082,0x82E0],
    [0x3084,0x82E2],[0x3086,0x82E5],[0x3088,0x82E8],
    [0x3089,0x82E9],[0x308A,0x82EA],[0x308B,0x82EB],[0x308C,0x82EC],[0x308D,0x82ED],
    [0x308F,0x82EF],[0x3092,0x82F0],[0x3093,0x82F1],
    // 浊音/半浊音 hiragana
    [0x304C,0x82AA],[0x304E,0x82AC],[0x3050,0x82AE],[0x3052,0x82B0],[0x3054,0x82B2],
    [0x3056,0x82B4],[0x3058,0x82B6],[0x305A,0x82B8],[0x305C,0x82BA],[0x305E,0x82BC],
    [0x3060,0x82BE],[0x3062,0x82C0],[0x3065,0x82C3],[0x3067,0x82C5],[0x3069,0x82C7],
    [0x3070,0x82CE],[0x3073,0x82D1],[0x3076,0x82D4],[0x3079,0x82D7],[0x307C,0x82DA],
    [0x3071,0x82CF],[0x3074,0x82D2],[0x3077,0x82D5],[0x307A,0x82D8],[0x307D,0x82DB],
    // 常用 MMD 骨骼 Kanji
    [0x4E0A,0x8FE3],[0x4E0B,0x89BA],[0x534A,0x94BC],[0x8EAB,0x9067],
    [0x982D,0x93AA],[0x9996,0x8EF1],[0x8170,0x8CF6],
    [0x5DE6,0x8DB6],[0x53F3,0x8945],[0x8155,0x9862],
    [0x8DB3,0x91AB],[0x524D,0x914E],[0x5F8C,0x8CE3],
    [0x76EE,0x96DA],[0x53E3,0x8CA5],[0x8033,0x8EAA],[0x9F3B,0x95E5],[0x9854,0x8AE7],
    [0x4F53,0x91CC],[0x5FC3,0x9053],[0x9854,0x8AE7],
    [0x624B,0x8EE8], // 手 (for other bone patterns)
] as [number,number][]));

/** Unicode 码点 → Shift-JIS 双字节 (big-endian)。未映射字符回退为 UTF-8。 */
function _codeToSjis(cp: number): number[] {
    const sjis = _SJIS_MAP.get(cp);
    if (sjis !== undefined) return [(sjis >> 8) & 0xFF, sjis & 0xFF];
    // ASCII 直接映射
    if (cp < 0x80) return [cp];
    // 回退 UTF-8
    const utf8 = new TextEncoder().encode(String.fromCodePoint(cp));
    return Array.from(utf8);
}

/** Shift-JIS 编码字符串到 15 字节（空格 0x20 填充）。 */
function encodeBoneName(name: string): Uint8Array {
    const buf = new Uint8Array(15).fill(0x20);
    let pos = 0;
    for (let i = 0; i < name.length && pos < 15; i++) {
        const bytes = _codeToSjis(name.codePointAt(i)!);
        for (const b of bytes) {
            if (pos >= 15) break;
            buf[pos++] = b;
        }
    }
    return buf;
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
        view.setUint8(off++, 20); view.setUint8(off++, 20);
        view.setUint8(off++, 107); view.setUint8(off++, 107);
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
    for (let i = 0; i < 30; i++) u8[off++] = sig[i] ?? 0;

    // Model name (20 bytes, 按字符边界截断避免多字节断裂)
    const nameChars = [...modelName];
    const enc = new TextEncoder();
    for (const ch of nameChars) {
        const b = enc.encode(ch);
        if (off + b.length > 50) break; // 50 = 30+20，不超出 name 区域
        for (const byte of b) u8[off++] = byte;
    }
    off = 50; // skip remaining name bytes

    // Bone frame count + frames
    view.setUint32(off, boneFrames.length, true); off += 4;
    for (const f of boneFrames) {
        u8.set(new Uint8Array(buildBoneFrame(f)), off);
        off += BONE_FRAME_SIZE;
    }

    // Morph frame count + frames
    view.setUint32(off, morphFrames.length, true); off += 4;
    for (const f of morphFrames) {
        u8.set(new Uint8Array(buildMorphFrame(f)), off);
        off += MORPH_FRAME_SIZE;
    }

    // Trailer: camera / light / selfShadow / ik counts = 0
    for (let i = 0; i < 4; i++) {
        view.setUint32(off, 0, true); off += 4;
    }

    return buf;
}
