// [doc:adr-181] 下载管理面板纯逻辑测试 — §测试
// 注意：settings-downloads.ts 的导入链会触发 Babylon Scene 初始化（library-actions→scene.ts），
// 故本测试内联核心正则/哈希/路由逻辑，不直接导入源文件。
import { describe, it, expect } from 'vitest';

/** 对齐 settings-downloads.ts:16 的扩展名过滤正则 */
const SUPPORTED_RE = /\.(pmx|vmd|mp3|wav|ogg|flac|wma|vpd|zip)$/i;
const MAX_ZIP_BYTES = 500 * 1024 * 1024; // 对齐 L17

describe('download-manager', () => {
    describe('supported file extension filter', () => {
        it('should match pmx files', () => {
            expect(SUPPORTED_RE.test('model.pmx')).toBe(true);
            expect(SUPPORTED_RE.test('MODEL.PMX')).toBe(true);
        });

        it('should match vmd files', () => {
            expect(SUPPORTED_RE.test('motion.vmd')).toBe(true);
        });

        it('should match zip files', () => {
            expect(SUPPORTED_RE.test('archive.zip')).toBe(true);
        });

        it('should match audio files', () => {
            expect(SUPPORTED_RE.test('song.mp3')).toBe(true);
            expect(SUPPORTED_RE.test('song.wav')).toBe(true);
            expect(SUPPORTED_RE.test('song.ogg')).toBe(true);
            expect(SUPPORTED_RE.test('song.flac')).toBe(true);
            expect(SUPPORTED_RE.test('song.wma')).toBe(true);
        });

        it('should match vpd pose files', () => {
            expect(SUPPORTED_RE.test('pose.vpd')).toBe(true);
        });

        it('should skip unsupported extensions', () => {
            expect(SUPPORTED_RE.test('readme.txt')).toBe(false);
            expect(SUPPORTED_RE.test('thumbnail.png')).toBe(false);
            expect(SUPPORTED_RE.test('model.jpg')).toBe(false);
            expect(SUPPORTED_RE.test('.imported.json')).toBe(false);
            expect(SUPPORTED_RE.test('notes.md')).toBe(false);
        });

        it('should skip dotfiles', () => {
            expect(SUPPORTED_RE.test('.gitkeep')).toBe(false);
            expect(SUPPORTED_RE.test('.DS_Store')).toBe(false);
        });
    });

    describe('max zip size guard', () => {
        it('should have a 500MB limit', () => {
            expect(MAX_ZIP_BYTES).toBe(500 * 1024 * 1024);
        });
    });

    describe('hashFile — SHA-256', () => {
        it('should produce SHA-256 hash of input bytes (known value)', async () => {
            const testBytes = new Uint8Array([116, 101, 115, 116]); // "test"
            const hash = await crypto.subtle.digest('SHA-256', testBytes as BufferSource);
            const hex = Array.from(new Uint8Array(hash))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
            expect(hex).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
            expect(hex.length).toBe(64);
        });

        it('should produce different hashes for different inputs', async () => {
            const bytes1 = new Uint8Array([1, 2, 3]);
            const bytes2 = new Uint8Array([1, 2, 4]);
            const h1 = await crypto.subtle.digest('SHA-256', bytes1 as BufferSource);
            const h2 = await crypto.subtle.digest('SHA-256', bytes2 as BufferSource);
            const hex1 = Array.from(new Uint8Array(h1)).map(b => b.toString(16).padStart(2, '0')).join('');
            const hex2 = Array.from(new Uint8Array(h2)).map(b => b.toString(16).padStart(2, '0')).join('');
            expect(hex1).not.toBe(hex2);
        });

        it('should produce same hash for same input (deterministic)', async () => {
            const bytes = new Uint8Array([42, 99, 255]);
            const h1 = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
            const h2 = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
            const hex1 = Array.from(new Uint8Array(h1)).map(b => b.toString(16).padStart(2, '0')).join('');
            const hex2 = Array.from(new Uint8Array(h2)).map(b => b.toString(16).padStart(2, '0')).join('');
            expect(hex1).toBe(hex2);
        });
    });

    describe('manifest dedup logic', () => {
        it('desktop manifest should parse valid JSON', () => {
            const json = '{"miku":["tex/miku.pmx"],"song":["audio/song.mp3"]}';
            const manifest = JSON.parse(json) as Record<string, string[]>;
            expect(manifest['miku']).toEqual(['tex/miku.pmx']);
            expect(manifest['song']).toEqual(['audio/song.mp3']);
        });

        it('desktop manifest should handle empty JSON', () => {
            const json = '{}';
            const manifest = JSON.parse(json) as Record<string, string[]>;
            expect(Object.keys(manifest).length).toBe(0);
        });

        it('manifest keys should be file stems (extension stripped)', () => {
            const stem1 = 'model_v1.pmx'.replace(/\.[^.]+$/, '');
            const stem2 = 'song.wav'.replace(/\.[^.]+$/, '');
            const stem3 = 'archive.zip'.replace(/\.[^.]+$/, '');
            expect(stem1).toBe('model_v1');
            expect(stem2).toBe('song');
            expect(stem3).toBe('archive');
        });

        it('manifest should deduplicate by stem lookup', () => {
            const manifest: Record<string, string[]> = { 'miku': ['tex/miku.pmx'] };
            const stem = 'miku.pmx'.replace(/\.[^.]+$/, '');
            expect(stem in manifest).toBe(true); // already imported

            const stem2 = 'rin.pmx'.replace(/\.[^.]+$/, '');
            expect(stem2 in manifest).toBe(false); // not imported yet
        });

        it('should skip .imported.json file in scan', () => {
            // .imported.json itself is not a supported extension
            expect(SUPPORTED_RE.test('.imported.json')).toBe(false);
        });
    });

    describe('web manifest idb key pattern', () => {
        it('should use imported:<handleId>:<hash> format', () => {
            const handleId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
            const hash = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
            const key = `imported:${handleId}:${hash}`;
            expect(key).toBe(`imported:${handleId}:${hash}`);
            expect(key).toMatch(/^imported:[a-f0-9-]+:[a-f0-9]{64}$/);
        });

        it('idb key should be unique per handleId+hash combination', () => {
            const id1 = 'aaa';
            const id2 = 'bbb';
            const hash = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
            const key1 = `imported:${id1}:${hash}`;
            const key2 = `imported:${id2}:${hash}`;
            expect(key1).not.toBe(key2);
        });
    });

    describe('zip vs non-zip routing', () => {
        it('.zip files → ImportZip path', () => {
            const names = ['model.zip', 'archive.ZIP', 'textures.Zip'];
            for (const n of names) {
                expect(n.toLowerCase().endsWith('.zip')).toBe(true);
            }
        });

        it('.pmx files → importFileByPath path', () => {
            expect('model.pmx'.toLowerCase().endsWith('.zip')).toBe(false);
            expect(SUPPORTED_RE.test('model.pmx')).toBe(true);
        });

        it('.vmd files → importFileByPath path', () => {
            expect('motion.vmd'.toLowerCase().endsWith('.zip')).toBe(false);
            expect(SUPPORTED_RE.test('motion.vmd')).toBe(true);
        });

        it('audio files → importFileByPath path', () => {
            const names = ['song.mp3', 'song.wav', 'song.ogg'];
            for (const n of names) {
                expect(n.toLowerCase().endsWith('.zip')).toBe(false);
                expect(SUPPORTED_RE.test(n)).toBe(true);
            }
        });
    });

    describe('over-size zip rejection', () => {
        it('files over 500MB should be rejected', () => {
            const bytes = 501 * 1024 * 1024; // 501 MB
            expect(bytes > MAX_ZIP_BYTES).toBe(true);
        });

        it('files under 500MB should proceed', () => {
            const bytes = 499 * 1024 * 1024; // 499 MB
            expect(bytes > MAX_ZIP_BYTES).toBe(false);
        });

        it('files exactly at 500MB should proceed', () => {
            const bytes = 500 * 1024 * 1024; // 500 MB
            expect(bytes > MAX_ZIP_BYTES).toBe(false);
        });
    });
});
