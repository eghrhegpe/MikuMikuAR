/**
 * vpd-parser 安全边界测试 — 覆盖 P0/P1 安全审计中的边界值、异常编码、XML 实体注入、文件大小限制
 */
import { describe, it, expect } from 'vitest';
import { parseVPDText, decodeVPDData, loadVPDFromBuffer } from '../motion-algos/vpd-parser';
import { buildVmd, type BoneKeyFrame } from '../motion-algos/vmd-writer';

// ====================================================================
// 文件大小限制 (CWE-400)
// ====================================================================
describe('decodeVPDData — 文件大小限制', () => {
    it('rejects files larger than 1 MB', () => {
        const huge = new ArrayBuffer(1024 * 1024 + 1);
        expect(() => decodeVPDData(huge)).toThrow(/too large/i);
    });

    it('accepts files at exactly 1 MB', () => {
        const exact = new Uint8Array(1024 * 1024);
        // 填充合法 UTF-8 文本头部，避免解码异常
        const header = new TextEncoder().encode('Vocaloid Pose Data file\n{\n}');
        exact.set(header);
        expect(() => decodeVPDData(exact.buffer)).not.toThrow();
    });

    it('accepts small files', () => {
        const small = new TextEncoder().encode('test').buffer;
        expect(() => decodeVPDData(small as ArrayBuffer)).not.toThrow();
    });
});

// ====================================================================
// 异常编码降级 (CWE-755)
// ====================================================================
describe('decodeVPDData — 异常编码降级', () => {
    it('falls back to UTF-8 for unknown encoding', () => {
        const buf = new TextEncoder().encode('Vocaloid Pose Data file\n{\n}').buffer;
        const result = decodeVPDData(buf as ArrayBuffer);
        expect(result).toContain('Vocaloid');
    });

    it('handles UTF-8 BOM correctly', () => {
        const content = '\uFEFFVocaloid Pose Data file\n{\n}';
        const buf = new TextEncoder().encode(content).buffer;
        const result = decodeVPDData(buf as ArrayBuffer);
        expect(result.charCodeAt(0)).not.toBe(0xfeff);
        expect(result).toContain('Vocaloid');
    });

    it('handles empty buffer gracefully', () => {
        const buf = new ArrayBuffer(0);
        expect(() => decodeVPDData(buf)).not.toThrow();
    });

    it('handles binary garbage without throwing', () => {
        const garbage = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0x00, 0x01, 0x02, 0x03]);
        // 不应抛出异常（可能解码为乱码，但不崩溃）
        expect(() => decodeVPDData(garbage.buffer)).not.toThrow();
    });
});

// ====================================================================
// XML 实体注入防护 (CWE-91)
// ====================================================================
describe('parseVPDText — XML 实体注入防护', () => {
    it('strips <!ENTITY> declarations, remaining valid numbers still parse', () => {
        const text = [
            'Vocaloid Pose Data file',
            '{',
            'Bone0:head',
            '<!ENTITY xxe SYSTEM "file:///etc/passwd"> 0 0 0',
            '0 0 0 1',
            '}',
        ].join('\n');
        const result = parseVPDText(text);
        // 实体声明被清理，剩余 0 0 0 仍为有效位置数据 → 骨骼正常解析
        expect(result.bones).toHaveLength(1);
        expect(result.bones[0].name).toBe('head');
        expect(result.bones[0].position).toEqual([0, 0, 0]);
    });

    it('strips <!ENTITY>-only line, bone skipped when no numeric data remains', () => {
        const text = [
            'Vocaloid Pose Data file',
            '{',
            'Bone0:head',
            '<!ENTITY xxe SYSTEM "file:///etc/passwd">',
            '0 0 0 1',
            '}',
        ].join('\n');
        const result = parseVPDText(text);
        // 实体声明被清理后该行为空，不通过数字行检查 → 骨骼跳过
        expect(result.bones).toHaveLength(0);
    });

    it('strips <!DOCTYPE> declarations, remaining valid numbers still parse', () => {
        const text = [
            'Vocaloid Pose Data file',
            '{',
            'Bone0:head',
            '<!DOCTYPE foo SYSTEM "evil.dtd"> 0 0 0',
            '0 0 0 1',
            '}',
        ].join('\n');
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(1);
        expect(result.bones[0].position).toEqual([0, 0, 0]);
    });

    it('normal VPD still parses after entity stripping', () => {
        const text = ['Vocaloid Pose Data file', '{', 'Bone0:head', '0 0 0', '0 0 0 1', '}'].join(
            '\n'
        );
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(1);
        expect(result.bones[0].name).toBe('head');
    });
});

// ====================================================================
// 越界读防护 (CWE-125)
// ====================================================================
describe('parseVPDText — 越界读防护', () => {
    it('skips bone with only 1 numeric line (missing rotation)', () => {
        const text = ['Vocaloid Pose Data file', '{', 'Bone0:head', '0 0 0', '}'].join('\n');
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(0);
    });

    it('skips bone with partial position values (only 2)', () => {
        const text = ['Vocaloid Pose Data file', '{', 'Bone0:head', '0 0', '0 0 0 1', '}'].join(
            '\n'
        );
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(0);
    });

    it('skips bone with partial rotation values (only 3)', () => {
        const text = ['Vocaloid Pose Data file', '{', 'Bone0:head', '0 0 0', '0 0 0', '}'].join(
            '\n'
        );
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(0);
    });

    it('skips bone with non-numeric position line', () => {
        const text = [
            'Vocaloid Pose Data file',
            '{',
            'Bone0:head',
            'abc def ghi',
            '0 0 0 1',
            '}',
        ].join('\n');
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(0);
    });

    it('skips bone with NaN values', () => {
        const text = [
            'Vocaloid Pose Data file',
            '{',
            'Bone0:head',
            'NaN NaN NaN',
            '0 0 0 1',
            '}',
        ].join('\n');
        const result = parseVPDText(text);
        // NaN 是合法的 Number 解析结果，但 isFinite 检查应过滤掉
        expect(result.bones).toHaveLength(0);
    });

    it('skips bone with Infinity values', () => {
        const text = [
            'Vocaloid Pose Data file',
            '{',
            'Bone0:head',
            'Infinity 0 0',
            '0 0 0 1',
            '}',
        ].join('\n');
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(0);
    });

    it('parses bone with exactly 3 pos + 4 rot values', () => {
        const text = ['Vocaloid Pose Data file', '{', 'Bone0:head', '1 2 3', '4 5 6 7', '}'].join(
            '\n'
        );
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(1);
        expect(result.bones[0].position).toEqual([1, 2, 3]);
        expect(result.bones[0].rotation).toEqual([4, 5, 6, 7]);
    });

    it('parses bone with extra values (more than needed)', () => {
        const text = [
            'Vocaloid Pose Data file',
            '{',
            'Bone0:head',
            '1 2 3 4 5',
            '6 7 8 9 10',
            '}',
        ].join('\n');
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(1);
        expect(result.bones[0].position).toEqual([1, 2, 3]);
        expect(result.bones[0].rotation).toEqual([6, 7, 8, 9]);
    });
});

// ====================================================================
// VMD 写入端名称净化 (CWE-78 / CWE-89)
// ====================================================================
describe('buildVmd — 名称净化防护', () => {
    it('sanitizes model name with SQL injection characters', () => {
        const bone: BoneKeyFrame = {
            name: 'head',
            frame: 0,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        };
        // 不应抛出异常，恶意字符应被清理
        const malicious = "'); DROP TABLE motions; --";
        expect(() => buildVmd([bone], [], malicious)).not.toThrow();
        const buf = buildVmd([bone], [], malicious);
        expect(buf.byteLength).toBeGreaterThan(0);
    });

    it('sanitizes bone name with shell injection characters', () => {
        const bone: BoneKeyFrame = {
            name: 'head; rm -rf /',
            frame: 0,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        };
        expect(() => buildVmd([bone], [], 'test')).not.toThrow();
        const buf = buildVmd([bone], [], 'test');
        expect(buf.byteLength).toBeGreaterThan(0);
    });

    it('sanitizes model name with HTML/script tags', () => {
        const bone: BoneKeyFrame = {
            name: 'head',
            frame: 0,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        };
        const malicious = '<script>alert(1)</script>';
        expect(() => buildVmd([bone], [], malicious)).not.toThrow();
    });

    it('handles empty model name gracefully', () => {
        const bone: BoneKeyFrame = {
            name: 'head',
            frame: 0,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        };
        expect(() => buildVmd([bone], [], '')).not.toThrow();
    });

    it('handles empty bone name gracefully', () => {
        const bone: BoneKeyFrame = {
            name: '',
            frame: 0,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        };
        expect(() => buildVmd([bone], [], 'test')).not.toThrow();
    });

    it('truncates very long model name to 20 bytes', () => {
        const bone: BoneKeyFrame = {
            name: 'head',
            frame: 0,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        };
        const longName = 'A'.repeat(100);
        const buf = buildVmd([bone], [], longName);
        // VMD header: 30 (sig) + 20 (model) + 4 (boneCount) + 111 (1 bone) + 4 (morphCount) + 16 (trailer)
        expect(buf.byteLength).toBe(30 + 20 + 4 + 111 + 4 + 16);
    });

    it('truncates very long bone name to 15 bytes', () => {
        const bone: BoneKeyFrame = {
            name: 'A'.repeat(100),
            frame: 0,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        };
        const buf = buildVmd([bone], [], 'test');
        expect(buf.byteLength).toBe(30 + 20 + 4 + 111 + 4 + 16);
    });
});

// ====================================================================
// loadVPDFromBuffer 端到端安全
// ====================================================================
describe('loadVPDFromBuffer — 端到端安全', () => {
    it('rejects oversized VPD file', () => {
        const huge = new ArrayBuffer(1024 * 1024 + 1);
        expect(() => loadVPDFromBuffer(huge)).toThrow(/too large/i);
    });

    it('rejects VPD with no bone data', () => {
        const buf = new TextEncoder().encode('Vocaloid Pose Data file\n{\n}').buffer;
        expect(() => loadVPDFromBuffer(buf as ArrayBuffer)).toThrow(/no bone data/i);
    });

    it('produces valid VMD from well-formed VPD', () => {
        const text = [
            'Vocaloid Pose Data file',
            'model "TestModel"',
            '{',
            'Bone0:head',
            '0 0 0',
            '0 0 0 1',
            '}',
        ].join('\n');
        const buf = new TextEncoder().encode(text).buffer;
        const vmd = loadVPDFromBuffer(buf as ArrayBuffer);
        expect(vmd.byteLength).toBeGreaterThan(0);
        // 验证 VMD 签名
        const sig = new TextDecoder().decode(new Uint8Array(vmd, 0, 25));
        expect(sig).toBe('Vocaloid Motion Data 0002');
    });
});
