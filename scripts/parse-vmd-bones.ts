// VMD 二进制结构解析器（AI 开发调试用）
// 用途: 离线核对 VMD 文件结构、提取骨骼名列表、验证偏移量
// 运行: npx tsx scripts/parse-vmd-bones.ts <path-to.vmd>
//
// VMD 帧格式（与 frontend/src/motion-algos/vmd-writer.ts 同源）：
//   Header: 30B 签名 + 20B 模型名 + 4B 骨骼帧数
//   BoneFrame: 15B 名(Shift-JIS,0-pad) + 4B frame(uint32 LE) + 12B pos(3×float32)
//              + 16B rot(4×float32,quat) + 64B interp(16×4) = 111B
//   MorphFrame: 15B 名 + 4B frame + 4B weight(float32) = 23B
//   Trailer: 4B cameraCount + 4B lightCount + 4B selfShadowCount + 4B ikCount (允许 0)

import fs from 'fs';

// Node 22+ 内置 TextDecoder 支持 'shift-jis'（含 CP932 扩展区），
// 无需 encoding-japanese 外部依赖，便于从根目录直接运行。
// 注意：运行时项目侧（vmd-writer/vpd-parser）仍用 encoding-japanese，
// 因前端 Vite bundle 需精确控制编码语义；此脚本仅调试用，差异可忽略。
const SJIS_DECODER = new TextDecoder('shift-jis');

const BONE_FRAME_SIZE = 111;
const MORPH_FRAME_SIZE = 23;
const HEADER_SIZE = 30 + 20; // sig + modelName（boneCount 在偏移 50 读取，不预含）

interface BoneFrame {
    name: string;
    frame: number;
    position: [number, number, number];
    rotation: [number, number, number, number];
}

interface MorphFrame {
    name: string;
    frame: number;
    weight: number;
}

interface VmdParseResult {
    signature: string;
    modelName: string;
    boneFrames: BoneFrame[];
    morphFrames: MorphFrame[];
    cameraCount: number;
    lightCount: number;
    selfShadowCount: number;
    ikCount: number;
    /** 解析结束后的字节偏移（应等于文件长度） */
    endOffset: number;
    /** 文件总字节 */
    fileSize: number;
}

/** Shift-JIS 字节解码为字符串（与 vmd-writer.ts encodeShiftJis 互逆）。 */
function decodeShiftJis(bytes: Buffer): string {
    // 去尾部的 0x00 填充
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    const trimmed = bytes.subarray(0, end);
    if (trimmed.length === 0) return '';
    return SJIS_DECODER.decode(trimmed);
}

/** 解析 VMD 二进制为结构化数据。失败时抛出带精确偏移的 Error。 */
function parseVmd(data: Buffer): VmdParseResult {
    if (data.length < HEADER_SIZE) {
        throw new Error(`文件过小: ${data.length} 字节 (最小头部 ${HEADER_SIZE})`);
    }

    // ── Header ──
    const signature = data.subarray(0, 30).toString('ascii').replace(/\0/g, '');
    if (!signature.startsWith('Vocaloid Motion Data 0002')) {
        throw new Error(`签名无效: "${signature}" (期望 "Vocaloid Motion Data 0002")`);
    }
    const modelName = decodeShiftJis(data.subarray(30, 50));

    let pos = HEADER_SIZE; // 50

    // ── Bone frames ──
    const boneCount = data.readUInt32LE(pos);
    pos += 4;
    const boneFrames: BoneFrame[] = [];
    const boneNames = new Set<string>();
    for (let i = 0; i < boneCount; i++) {
        if (pos + BONE_FRAME_SIZE > data.length) {
            throw new Error(`骨骼帧 ${i} 越界: pos=${pos}, 需要 ${BONE_FRAME_SIZE} 字节`);
        }
        const nameBytes = data.subarray(pos, pos + 15);
        const name = decodeShiftJis(nameBytes);
        const frame = data.readUInt32LE(pos + 15);
        const px = data.readFloatLE(pos + 19);
        const py = data.readFloatLE(pos + 23);
        const pz = data.readFloatLE(pos + 27);
        const rx = data.readFloatLE(pos + 31);
        const ry = data.readFloatLE(pos + 35);
        const rz = data.readFloatLE(pos + 39);
        const rw = data.readFloatLE(pos + 43);
        boneFrames.push({
            name,
            frame,
            position: [px, py, pz],
            rotation: [rx, ry, rz, rw],
        });
        boneNames.add(name);
        pos += BONE_FRAME_SIZE;
    }

    // ── Morph frames ──
    if (pos + 4 > data.length) {
        throw new Error(`缺少 morphCount: pos=${pos}`);
    }
    const morphCount = data.readUInt32LE(pos);
    pos += 4;
    const morphFrames: MorphFrame[] = [];
    for (let i = 0; i < morphCount; i++) {
        if (pos + MORPH_FRAME_SIZE > data.length) {
            throw new Error(`Morph 帧 ${i} 越界: pos=${pos}, 需要 ${MORPH_FRAME_SIZE} 字节`);
        }
        const name = decodeShiftJis(data.subarray(pos, pos + 15));
        const frame = data.readUInt32LE(pos + 15);
        const weight = data.readFloatLE(pos + 19);
        morphFrames.push({ name, frame, weight });
        pos += MORPH_FRAME_SIZE;
    }

    // ── Trailer (camera / light / selfShadow / ik) ──
    const readTrailer = (label: string): number => {
        if (pos + 4 > data.length) {
            throw new Error(`缺少 ${label}Count: pos=${pos}`);
        }
        const v = data.readUInt32LE(pos);
        pos += 4;
        return v;
    };
    const cameraCount = readTrailer('camera');
    const lightCount = readTrailer('light');
    const selfShadowCount = readTrailer('selfShadow');
    const ikCount = readTrailer('ik');

    // 注: 标准 VMD 还可能在 trailer 之后包含 camera/light/selfShadow/ik 块的数据，
    // 本解析器仅核对 count，不展开这些块（与 vmd-writer.ts 写入侧一致：均写 0）

    return {
        signature,
        modelName,
        boneFrames,
        morphFrames,
        cameraCount,
        lightCount,
        selfShadowCount,
        ikCount,
        endOffset: pos,
        fileSize: data.length,
    };
}

// ── CLI 入口 ──
const path = process.argv[2];
if (!path) {
    console.error('用法: npx tsx scripts/parse-vmd-bones.ts <path-to.vmd>');
    process.exit(1);
}

const data = fs.readFileSync(path);
const result = parseVmd(data);

console.log('═══ VMD 解析报告 ═══');
console.log(`文件: ${path}`);
console.log(`签名: ${result.signature}`);
console.log(`模型名: "${result.modelName}"`);
console.log(`骨骼帧数: ${result.boneFrames.length}`);
console.log(`Morph 帧数: ${result.morphFrames.length}`);
console.log(`Camera/Light/SelfShadow/IK: ${result.cameraCount}/${result.lightCount}/${result.selfShadowCount}/${result.ikCount}`);
console.log(`解析偏移: ${result.endOffset} / 文件长度: ${result.fileSize} ${result.endOffset === result.fileSize ? '✅' : '⚠️ 不一致'}`);

// 骨骼名汇总
const boneNames = [...new Set(result.boneFrames.map((b) => b.name))].sort();
console.log(`\n── 不同骨骼 ${boneNames.length} 个 ──`);
boneNames.forEach((n, i) => {
    const frames = result.boneFrames.filter((b) => b.name === n);
    const frameRange =
        frames.length > 0
            ? `${Math.min(...frames.map((f) => f.frame))}..${Math.max(...frames.map((f) => f.frame))}`
            : '-';
    console.log(`  ${String(i + 1).padStart(3)}. ${n.padEnd(30)} (${frames.length} 帧, range ${frameRange})`);
});

// Morph 名汇总
if (result.morphFrames.length > 0) {
    console.log(`\n── 不同 Morph ${new Set(result.morphFrames.map((m) => m.name)).size} 个 ──`);
    [...new Set(result.morphFrames.map((m) => m.name))].sort().forEach((n, i) => {
        const frames = result.morphFrames.filter((m) => m.name === n);
        console.log(`  ${String(i + 1).padStart(3)}. ${n.padEnd(30)} (${frames.length} 帧)`);
    });
}
