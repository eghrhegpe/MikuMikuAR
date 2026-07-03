import { describe, it, expect } from 'vitest';
import {
    DEFAULT_LIPSYNC_STATE,
    findLipMorph,
    findAllLipMorphs,
    amplitudeToWeight,
} from '../motion/lipsync';

describe('findLipMorph', () => {
    it('prefers あ first', () => {
        expect(findLipMorph(['まばたき', 'あ', 'A'])).toBe('あ');
    });

    it('falls back to ア when no あ', () => {
        expect(findLipMorph(['ア', 'A'])).toBe('ア');
    });

    it('falls back to A', () => {
        expect(findLipMorph(['まばたき', 'A'])).toBe('A');
    });

    it('falls back to a (lowercase)', () => {
        expect(findLipMorph(['a'])).toBe('a');
    });

    it('falls back to 口', () => {
        expect(findLipMorph(['口'])).toBe('口');
    });

    it('falls back to mouth', () => {
        expect(findLipMorph(['mouth'])).toBe('mouth');
    });

    it('falls back to open', () => {
        expect(findLipMorph(['open'])).toBe('open');
    });

    it('returns null when no candidate matches', () => {
        expect(findLipMorph(['まばたき', '笑い'])).toBeNull();
    });

    it('returns null for empty list', () => {
        expect(findLipMorph([])).toBeNull();
    });
});

describe('findAllLipMorphs', () => {
    it('finds all four morph types', () => {
        const result = findAllLipMorphs(['あ', 'い', 'う', 'え']);
        expect(result.open).toBe('あ');
        expect(result.close).toBe('い');
        expect(result.pucker).toBe('う');
        expect(result.smile).toBe('え');
    });

    it('returns null for unmatched categories', () => {
        const result = findAllLipMorphs(['あ']);
        expect(result.open).toBe('あ');
        expect(result.close).toBeNull();
        expect(result.pucker).toBeNull();
        expect(result.smile).toBeNull();
    });

    it('prefers Japanese names over Latin', () => {
        const result = findAllLipMorphs(['ア', 'A', 'イ', 'I', 'ウ', 'U', 'エ', 'E']);
        expect(result.open).toBe('ア');
        expect(result.close).toBe('イ');
        expect(result.pucker).toBe('ウ');
        expect(result.smile).toBe('エ');
    });

    it('falls back to Latin names', () => {
        const result = findAllLipMorphs(['A', 'I', 'U', 'E']);
        expect(result.open).toBe('A');
        expect(result.close).toBe('I');
        expect(result.pucker).toBe('U');
        expect(result.smile).toBe('E');
    });

    it('falls back to common names (mouth/close/pucker/smile)', () => {
        const result = findAllLipMorphs(['mouth', 'close', 'pucker', 'smile']);
        expect(result.open).toBe('mouth');
        expect(result.close).toBe('close');
        expect(result.pucker).toBe('pucker');
        expect(result.smile).toBe('smile');
    });

    it('finds smile via Japanese names', () => {
        const result = findAllLipMorphs(['にこり']);
        expect(result.smile).toBe('にこり');
    });

    it('finds smile via 笑い', () => {
        const result = findAllLipMorphs(['笑い']);
        expect(result.smile).toBe('笑い');
    });

    it('returns all null for empty input', () => {
        const result = findAllLipMorphs([]);
        expect(result.open).toBeNull();
        expect(result.close).toBeNull();
        expect(result.pucker).toBeNull();
        expect(result.smile).toBeNull();
    });

    it('returns all null for unrelated morphs', () => {
        const result = findAllLipMorphs(['まばたき', 'ウィンク', '笑い2']);
        expect(result.open).toBeNull();
        expect(result.close).toBeNull();
        expect(result.pucker).toBeNull();
        expect(result.smile).toBeNull();
    });
});

describe('amplitudeToWeight', () => {
    it('returns 0 below sensitivity threshold', () => {
        expect(amplitudeToWeight(0.1, 0.2, 0.8)).toBe(0);
        expect(amplitudeToWeight(0.19, 0.2, 0.8)).toBe(0);
    });

    it('returns 0 at exactly threshold (strict less-than)', () => {
        expect(amplitudeToWeight(0.2, 0.2, 0.8)).toBe(0);
    });

    it('maps linearly above threshold', () => {
        expect(amplitudeToWeight(0.6, 0.2, 0.8)).toBeCloseTo(0.4, 3);
    });

    it('scales by intensity at full amplitude', () => {
        expect(amplitudeToWeight(1.0, 0.2, 0.5)).toBeCloseTo(0.5, 3);
        expect(amplitudeToWeight(1.0, 0.2, 1.0)).toBeCloseTo(1.0, 3);
    });

    it('clamps amplitude > 1 to intensity', () => {
        expect(amplitudeToWeight(1.5, 0.2, 0.8)).toBeCloseTo(0.8, 3);
    });

    it('handles sensitivity=0 (full range)', () => {
        expect(amplitudeToWeight(0.5, 0, 1.0)).toBeCloseTo(0.5, 3);
    });

    it('handles sensitivity=1 (deadband edge)', () => {
        expect(amplitudeToWeight(0.9, 1, 0.8)).toBe(0);
        expect(amplitudeToWeight(1.0, 1, 0.8)).toBeCloseTo(0.8, 3);
    });

    it('handles intensity=0 (mouth never opens)', () => {
        expect(amplitudeToWeight(1.0, 0.2, 0)).toBe(0);
    });

    it('amplitude exactly at 0 with sensitivity 0', () => {
        expect(amplitudeToWeight(0, 0, 1.0)).toBeCloseTo(0, 5);
    });

    it('maps mid-range amplitude correctly', () => {
        // sensitivity=0.3, intensity=1.0, range=0.7
        // amp=0.65 → (0.65-0.3)/0.7 = 0.5 → 0.5*1.0 = 0.5
        expect(amplitudeToWeight(0.65, 0.3, 1.0)).toBeCloseTo(0.5, 3);
    });
});

describe('DEFAULT_LIPSYNC_STATE', () => {
    it('starts disabled', () => {
        expect(DEFAULT_LIPSYNC_STATE.enabled).toBe(false);
    });

    it('has sensible defaults', () => {
        expect(DEFAULT_LIPSYNC_STATE.sensitivity).toBeGreaterThan(0);
        expect(DEFAULT_LIPSYNC_STATE.sensitivity).toBeLessThan(1);
        expect(DEFAULT_LIPSYNC_STATE.intensity).toBeGreaterThan(0);
        expect(DEFAULT_LIPSYNC_STATE.intensity).toBeLessThanOrEqual(1);
    });
});
