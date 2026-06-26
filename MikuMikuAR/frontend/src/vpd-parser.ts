export interface VPDPoseBone {
    name: string;
    position: [number, number, number];
    rotation: [number, number, number, number];
}

export interface VPDPoseData {
    bones: VPDPoseBone[];
}

const BONE_KEYFRAME_SIZE = 66;

export function parseVPDText(text: string): VPDPoseData {
    const bones: VPDPoseBone[] = [];
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    if (text.charCodeAt(0) === 0xFFFE) text = text.slice(1);

    const lines = text.split(/\r?\n/);
    let inBody = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === "{") { inBody = true; continue; }
        if (line === "}") { inBody = false; continue; }
        if (!inBody || line.startsWith("Vocaloid") || line === "") continue;

        const boneMatch = line.match(/^Bone\d+:(.+)$/);
        if (boneMatch) {
            const boneName = boneMatch[1].trim();
            const posLine = lines[++i]?.trim();
            const rotLine = lines[++i]?.trim();
            if (!posLine || !rotLine) break;

            const posParts = posLine.split(/\s+/).filter(s => s.length > 0);
            const rotParts = rotLine.split(/\s+/).filter(s => s.length > 0);
            if (posParts.length < 3 || rotParts.length < 4) continue;

            bones.push({
                name: boneName,
                position: [parseFloat(posParts[0]), parseFloat(posParts[1]), parseFloat(posParts[2])],
                rotation: [parseFloat(rotParts[0]), parseFloat(rotParts[1]), parseFloat(rotParts[2]), parseFloat(rotParts[3])],
            });
        }
    }

    return { bones };
}

export function decodeVPDData(buffer: ArrayBuffer): string {
    const utf8 = new TextDecoder("utf-8", { fatal: true });
    try {
        let text = utf8.decode(buffer);
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        if (text.charCodeAt(0) === 0xFFFE) text = text.slice(1);
        return text;
    } catch {
        let text = new TextDecoder("shift-jis").decode(buffer);
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        if (text.charCodeAt(0) === 0xFFFE) text = text.slice(1);
        return text;
    }
}

function encodeBoneName(name: string): Uint8Array {
    const buf = new Uint8Array(15).fill(0x20);
    try {
        const sjis = new (TextEncoder as any)("shift-jis", { NONSTANDARD_allowLegacyEncoding: true }).encode(name);
        for (let i = 0; i < Math.min(sjis.length, 15); i++) buf[i] = sjis[i];
    } catch {
        const utf8 = new TextEncoder().encode(name);
        for (let i = 0; i < Math.min(utf8.length, 15); i++) buf[i] = utf8[i];
    }
    return buf;
}

export function buildVmdBoneFrame(
    boneName: string,
    pos: [number, number, number],
    rot: [number, number, number, number],
): ArrayBuffer {
    const buf = new ArrayBuffer(BONE_KEYFRAME_SIZE);
    const view = new DataView(buf);
    let offset = 0;

    const nameBytes = encodeBoneName(boneName);
    for (let i = 0; i < 15; i++) view.setUint8(offset++, nameBytes[i]);

    view.setUint32(offset, 0, true);
    offset += 4;

    view.setFloat32(offset, pos[0], true); offset += 4;
    view.setFloat32(offset, pos[1], true); offset += 4;
    view.setFloat32(offset, pos[2], true); offset += 4;

    view.setFloat32(offset, rot[0], true); offset += 4;
    view.setFloat32(offset, rot[1], true); offset += 4;
    view.setFloat32(offset, rot[2], true); offset += 4;
    view.setFloat32(offset, rot[3], true); offset += 4;

    for (let i = 0; i < 16; i++) view.setUint8(offset++, 0x7F);

    for (let i = 0; i < 3; i++) view.setUint8(offset++, 0x00);

    return buf;
}

export function poseDataToVmdBuffer(pose: VPDPoseData): ArrayBuffer {
    const count = pose.bones.length;
    const buf = new ArrayBuffer(54 + count * BONE_KEYFRAME_SIZE + 4);
    const view = new DataView(buf);
    let offset = 0;

    const sig = new TextEncoder().encode("Vocaloid Motion Data 0002\0");
    for (let i = 0; i < 30; i++) view.setUint8(offset++, sig[i] ?? 0);

    for (let i = 0; i < 20; i++) view.setUint8(offset++, 0);

    view.setUint32(offset, count, true);
    offset += 4;

    for (const bone of pose.bones) {
        const frame = buildVmdBoneFrame(bone.name, bone.position, bone.rotation);
        new Uint8Array(buf).set(new Uint8Array(frame), offset);
        offset += BONE_KEYFRAME_SIZE;
    }

    view.setUint32(offset, 0, true);

    return buf;
}

export function loadVPDFromBuffer(buffer: ArrayBuffer): ArrayBuffer {
    const text = decodeVPDData(buffer);
    const pose = parseVPDText(text);
    return poseDataToVmdBuffer(pose);
}
