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
const _SJIS_MAP = new Map<number, number>([
    // Katakana
    [0x30a2, 0x8341],
    [0x30a4, 0x8343],
    [0x30a6, 0x8345],
    [0x30a8, 0x8347],
    [0x30aa, 0x8349],
    [0x30ab, 0x834a],
    [0x30ad, 0x834c],
    [0x30af, 0x834e],
    [0x30b1, 0x8350],
    [0x30b3, 0x8352],
    [0x30b5, 0x8354],
    [0x30b7, 0x8356],
    [0x30b9, 0x8358],
    [0x30bb, 0x835a],
    [0x30bd, 0x835c],
    [0x30bf, 0x835e],
    [0x30c1, 0x8360],
    [0x30c4, 0x8362],
    [0x30c6, 0x8364],
    [0x30c8, 0x8366],
    [0x30ca, 0x8367],
    [0x30cb, 0x8369],
    [0x30cc, 0x836a],
    [0x30cd, 0x836b],
    [0x30ce, 0x836c],
    [0x30cf, 0x836d],
    [0x30d2, 0x8370],
    [0x30d5, 0x8373],
    [0x30d8, 0x8376],
    [0x30db, 0x8379],
    [0x30de, 0x837c],
    [0x30df, 0x837d],
    [0x30e0, 0x837e],
    [0x30e1, 0x837f],
    [0x30e2, 0x8380],
    [0x30e4, 0x8382],
    [0x30e6, 0x8385],
    [0x30e8, 0x8388],
    [0x30e9, 0x8389],
    [0x30ea, 0x838a],
    [0x30eb, 0x838b],
    [0x30ec, 0x838c],
    [0x30ed, 0x838d],
    [0x30ef, 0x838f],
    [0x30f2, 0x8390],
    [0x30f3, 0x8393],
    [0x30fc, 0x815b], // ー
    // Hiragana
    [0x3042, 0x82a0],
    [0x3044, 0x82a2],
    [0x3046, 0x82a4],
    [0x3048, 0x82a6],
    [0x304a, 0x82a8],
    [0x304b, 0x82a9],
    [0x304d, 0x82ab],
    [0x304f, 0x82ad],
    [0x3051, 0x82af],
    [0x3053, 0x82b1],
    [0x3055, 0x82b3],
    [0x3057, 0x82b5],
    [0x3059, 0x82b7],
    [0x305b, 0x82b9],
    [0x305d, 0x82bb],
    [0x305f, 0x82bd],
    [0x3061, 0x82bf],
    [0x3064, 0x82c2],
    [0x3066, 0x82c4],
    [0x3068, 0x82c6],
    [0x306a, 0x82c7],
    [0x306b, 0x82c9],
    [0x306c, 0x82ca],
    [0x306d, 0x82cb],
    [0x306e, 0x82cc],
    [0x306f, 0x82cd],
    [0x3072, 0x82d0],
    [0x3075, 0x82d3],
    [0x3078, 0x82d6],
    [0x307b, 0x82d9],
    [0x307e, 0x82dc],
    [0x307f, 0x82dd],
    [0x3080, 0x82de],
    [0x3081, 0x82df],
    [0x3082, 0x82e0],
    [0x3084, 0x82e2],
    [0x3086, 0x82e5],
    [0x3088, 0x82e8],
    [0x3089, 0x82e9],
    [0x308a, 0x82ea],
    [0x308b, 0x82eb],
    [0x308c, 0x82ec],
    [0x308d, 0x82ed],
    [0x308f, 0x82ef],
    [0x3092, 0x82f0],
    [0x3093, 0x82f1],
    // 浊音/半浊音 hiragana
    [0x304c, 0x82aa],
    [0x304e, 0x82ac],
    [0x3050, 0x82ae],
    [0x3052, 0x82b0],
    [0x3054, 0x82b2],
    [0x3056, 0x82b4],
    [0x3058, 0x82b6],
    [0x305a, 0x82b8],
    [0x305c, 0x82ba],
    [0x305e, 0x82bc],
    [0x3060, 0x82be],
    [0x3062, 0x82c0],
    [0x3065, 0x82c3],
    [0x3067, 0x82c5],
    [0x3069, 0x82c7],
    [0x3070, 0x82ce],
    [0x3073, 0x82d1],
    [0x3076, 0x82d4],
    [0x3079, 0x82d7],
    [0x307c, 0x82da],
    [0x3071, 0x82cf],
    [0x3074, 0x82d2],
    [0x3077, 0x82d5],
    [0x307a, 0x82d8],
    [0x307d, 0x82db],
    // 常用 MMD 骨骼 Kanji
    [0x4e0a, 0x8fe3],
    [0x4e0b, 0x89ba],
    [0x534a, 0x94bc],
    [0x8eab, 0x9067],
    [0x982d, 0x93aa],
    [0x9996, 0x8ef1],
    [0x8170, 0x8cf6],
    [0x5de6, 0x8db6],
    [0x53f3, 0x8945],
    [0x8155, 0x9862],
    [0x8db3, 0x91ab],
    [0x524d, 0x914e],
    [0x5f8c, 0x8ce3],
    [0x76ee, 0x96da],
    [0x53e3, 0x8ca5],
    [0x8033, 0x8eaa],
    [0x9f3b, 0x95e5],
    [0x9854, 0x8ae7],
    [0x4f53, 0x91cc],
    [0x5fc3, 0x9053],
    [0x9854, 0x8ae7],
    [0x624b, 0x8ee8], // 手 (for other bone patterns)
] as [number, number][]);

/** Unicode 码点 → Shift-JIS 双字节 (big-endian)。未映射字符回退为 UTF-8。 */
function _codeToSjis(cp: number): number[] {
    const sjis = _SJIS_MAP.get(cp);
    if (sjis !== undefined) {
        return [(sjis >> 8) & 0xff, sjis & 0xff];
    }
    // ASCII 直接映射
    if (cp < 0x80) {
        return [cp];
    }
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
            if (pos >= 15) {
                break;
            }
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
    // 64 bytes 插值：线性默认 (x1=20,y1=20,x2=107,y2=107) 每 4 字节重复 16 次
    for (let i = 0; i < 16; i++) {
        view.setUint8(off++, 20);
        view.setUint8(off++, 20);
        view.setUint8(off++, 107);
        view.setUint8(off++, 107);
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

    // Model name (20 bytes, 按字符边界截断避免多字节断裂)
    const nameChars = [...modelName];
    const enc = new TextEncoder();
    for (const ch of nameChars) {
        const b = enc.encode(ch);
        if (off + b.length > 50) {
            break;
        } // 50 = 30+20，不超出 name 区域
        for (const byte of b) {
            u8[off++] = byte;
        }
    }
    off = 50; // skip remaining name bytes

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
