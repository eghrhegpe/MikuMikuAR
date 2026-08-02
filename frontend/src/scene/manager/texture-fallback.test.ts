// texture-fallback.test.ts — 多候选路径 fallback 生成 + 声明别名注册（ADR-189 防御性增强）
// 覆盖：深子目录文件可被带目录前缀的 PMX 声明命中；裸名/反斜杠/去重边界；
//      声明路径与磁盘目录名异写时按声明注册别名（tex\ vs Texture\）。
import { describe, it, expect } from 'vitest';
import { textureFallbackCandidates, registerDeclaredAliases } from './texture-fallback';

describe('textureFallbackCandidates', () => {
    it('深子目录文件：生成 首段+裸名 / 去首段 / 裸名 三类候选', () => {
        const cands = textureFallbackCandidates('textures/Normalmap/T_player_019_mint_nighty_02_d.png');
        expect(cands).toEqual([
            'T_player_019_mint_nighty_02_d.png', // 裸名
            'textures/T_player_019_mint_nighty_02_d.png', // 首段+裸名（命中声明 textures\xxx.png）
            'Normalmap/T_player_019_mint_nighty_02_d.png', // 去首段
        ]);
    });

    it('反斜杠路径归一化后同样生成候选', () => {
        const cands = textureFallbackCandidates('textures\\Normalmap\\face.png');
        expect(cands).toEqual(['face.png', 'textures/face.png', 'Normalmap/face.png']);
    });

    it('一层子目录：裸名 + 首段+裸名（无去首段重复）', () => {
        const cands = textureFallbackCandidates('textures/face.png');
        expect(cands).toEqual(['face.png', 'textures/face.png']);
    });

    it('裸名文件：仅自身候选（无多余变体）', () => {
        const cands = textureFallbackCandidates('face.png');
        expect(cands).toEqual(['face.png']);
    });

    it('重复调用返回相同候选（纯函数，调用方去重）', () => {
        const a = textureFallbackCandidates('tex/a.png');
        const b = textureFallbackCandidates('tex/a.png');
        expect(a).toEqual(b);
    });

    it('空/纯目录路径返回空数组', () => {
        expect(textureFallbackCandidates('')).toEqual([]);
        expect(textureFallbackCandidates('textures/')).toEqual([]); // 目录而非文件
    });
});

describe('registerDeclaredAliases（声明路径 ↔ 磁盘目录名异写兜底）', () => {
    const files = [
        { relativePath: 'Texture/face_d.png', data: new ArrayBuffer(1) },
        { relativePath: 'Texture/eye_d.png', data: new ArrayBuffer(2) },
    ];

    it('声明 tex\\face_d.png 时按声明路径注册别名（磁盘 Texture/face_d.png 命中）', () => {
        const out = registerDeclaredAliases(files, ['tex\\face_d.png', 'tex\\eye_d.png']);
        const paths = out.map((f) => f.relativePath);
        expect(paths).toContain('tex/face_d.png'); // 反斜杠归一 + 声明目录名注册
        expect(paths).toContain('tex/eye_d.png');
        // 别名共享原文件 data（引用同一 buffer）
        const alias = out.find((f) => f.relativePath === 'tex/face_d.png');
        expect(alias!.data).toBe(files[0].data);
    });

    it('声明 basename 磁盘不存在时不注册（真缺失，留待 audit 提示）', () => {
        const out = registerDeclaredAliases(files, ['tex/not_exist.png']);
        expect(out).toEqual(files); // 无新增
    });

    it('声明路径与磁盘路径一致时不重复注册', () => {
        const out = registerDeclaredAliases(files, ['Texture/face_d.png']);
        expect(out).toEqual(files);
    });

    it('空声明 / 空文件列表返回原列表', () => {
        expect(registerDeclaredAliases(files, [])).toEqual(files);
        expect(registerDeclaredAliases([], ['tex/a.png'])).toEqual([]);
    });
});
