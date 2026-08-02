// texture-fallback.test.ts — 多候选路径 fallback 生成（ADR-189 防御性增强）
// 覆盖：深子目录文件可被带目录前缀的 PMX 声明命中；裸名/反斜杠/去重边界。
import { describe, it, expect } from 'vitest';
import { textureFallbackCandidates } from './texture-fallback';

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
