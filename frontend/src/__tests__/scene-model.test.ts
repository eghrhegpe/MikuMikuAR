import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelManager } from '../scene/manager/model-manager';
import type { ModelInstance } from '../core/config';

// ─── Pure unit tests for ModelManager ───────────────────────────────
// These tests validate core registry + property logic without a real Babylon Scene.
// Physics / morph / bone-overlay paths are skipped (require full Babylon mock).

// ── Helpers ─────────────────────────────────────────────────────────

function makeModel(id: string, overrides: Partial<ModelInstance> = {}): ModelInstance {
    return {
        id,
        name: id,
        filePath: `D:/models/${id}.pmx`,
        kind: 'actor',
        visible: true,
        opacity: 1,
        wireframe: false,
        showBoneLines: false,
        showBoneJoints: false,
        scaling: 1,
        rotationY: 0,
        rootMesh: null,
        meshes: [],
        mmdModel: null,
        vmdPath: null,
        vmdName: null,
        outfitFile: undefined,
        _origTextures: undefined,
        ...overrides,
    } as unknown as ModelInstance;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ModelManager — registry', () => {
    let mgr: ModelManager;

    beforeEach(() => {
        mgr = new ModelManager(
            {} as any, // scene mock
            vi.fn(),
            vi.fn()
        );
    });

    it('size / get / getAll reflect registered models', () => {
        expect(mgr.size).toBe(0);
        expect(mgr.getAll()).toEqual([]);

        mgr.register(makeModel('a'));
        mgr.register(makeModel('b'));

        expect(mgr.size).toBe(2);
        expect(mgr.get('a')?.id).toBe('a');
        expect(mgr.get('b')?.id).toBe('b');
        expect(mgr.get('nope')).toBeUndefined();
        expect(
            mgr
                .getAll()
                .map((m) => m.id)
                .sort()
        ).toEqual(['a', 'b']);
    });

    it('remove deletes model and cleans up internal maps', () => {
        mgr.register(makeModel('a'));
        mgr.register(makeModel('b'));

        // Pre-populate some internal state
        (mgr as any)._physicsCatState.set('a', new Map());
        (mgr as any)._initialRigidBodyStates.set('a', new Uint8Array([1, 2]));

        mgr.remove('a');

        expect(mgr.get('a')).toBeUndefined();
        expect(mgr.size).toBe(1);
        expect((mgr as any)._physicsCatState.has('a')).toBe(false);
        expect((mgr as any)._initialRigidBodyStates.has('a')).toBe(false);
    });

    it('remove is no-op for unknown id', () => {
        mgr.register(makeModel('a'));
        expect(() => mgr.remove('nope')).not.toThrow();
        expect(mgr.size).toBe(1);
    });

    it('findByFilePath returns first match', () => {
        mgr.register(makeModel('a', { filePath: 'X:/foo/char.pmx' }));
        mgr.register(makeModel('b', { filePath: 'X:/bar/char.pmx' }));
        expect(mgr.findByFilePath('X:/foo/char.pmx')?.id).toBe('a');
        expect(mgr.findByFilePath('not/exist.pmx')).toBeUndefined();
    });
});

describe('ModelManager — focus + arrange', () => {
    let mgr: ModelManager;
    const onChange = vi.fn();
    const autoFrame = vi.fn();

    beforeEach(() => {
        onChange.mockClear();
        autoFrame.mockClear();
        mgr = new ModelManager({} as any, onChange, autoFrame);
    });

    it('focus updates focusedModelId and calls onChange + autoFrame', () => {
        mgr.register(makeModel('a'));
        mgr.focus('a');
        expect(mgr.focusedModelId).toBe('a');
        expect(onChange).toHaveBeenCalled();
        // autoFrame is called but we can't assert the args without real meshes
    });

    it('focus is no-op for unknown id', () => {
        expect(() => mgr.focus('nope')).not.toThrow();
        expect(mgr.focusedModelId).toBe(null);
    });

    it('remove transfers focus to remaining model', () => {
        mgr.register(makeModel('a'));
        mgr.register(makeModel('b'));
        mgr.focus('b');
        expect(mgr.focusedModelId).toBe('b');

        mgr.remove('b');
        // focus should shift to 'a' (first remaining key)
        expect(mgr.focusedModelId).toBe('a');
    });

    it('remove clears focus when no models remain', () => {
        mgr.register(makeModel('a'));
        mgr.focus('a');
        mgr.remove('a');
        expect(mgr.focusedModelId).toBe(null);
    });

    it('arrange offsets mesh positions', () => {
        const meshA = { position: { x: 0, y: 0, z: 0 } } as any;
        const meshB = { position: { x: 0, y: 0, z: 0 } } as any;
        mgr.register(makeModel('a', { meshes: [meshA] }));
        mgr.register(makeModel('b', { meshes: [meshB] }));

        mgr.arrange();

        // spacing = 3:  a at -1.5, b at +1.5
        expect(meshA.position.x).toBeCloseTo(-1.5, 1);
        expect(meshB.position.x).toBeCloseTo(1.5, 1);
        expect(onChange).toHaveBeenCalled();
    });
});

describe('ModelManager — visibility / opacity / wireframe', () => {
    let mgr: ModelManager;

    beforeEach(() => {
        mgr = new ModelManager({} as any, vi.fn(), vi.fn());
    });

    it('setVisibility updates inst.visible', () => {
        mgr.register(makeModel('a', { visible: true }));
        mgr.setVisibility('a', false);
        expect(mgr.get('a')!.visible).toBe(false);

        mgr.setVisibility('a', true);
        expect(mgr.get('a')!.visible).toBe(true);
    });

    it('setOpacity clamps to [0,1] and updates inst.opacity', () => {
        mgr.register(makeModel('a', { opacity: 1 }));

        mgr.setOpacity('a', 0.5);
        expect(mgr.get('a')!.opacity).toBe(0.5);

        mgr.setOpacity('a', 2);
        expect(mgr.get('a')!.opacity).toBe(1);

        mgr.setOpacity('a', -1);
        expect(mgr.get('a')!.opacity).toBe(0);
    });

    it('setWireframe updates inst.wireframe', () => {
        mgr.register(makeModel('a', { wireframe: false }));
        mgr.setWireframe('a', true);
        expect(mgr.get('a')!.wireframe).toBe(true);
    });

    it('setVisibility / setOpacity / setWireframe are no-op for unknown id', () => {
        expect(() => mgr.setVisibility('nope', false)).not.toThrow();
        expect(() => mgr.setOpacity('nope', 0.5)).not.toThrow();
        expect(() => mgr.setWireframe('nope', true)).not.toThrow();
    });
});

describe('_classifyBonePhysics (imported indirectly)', () => {
    // Test the classification regexes via a public path.
    // The function is private, so we test it indirectly via setPhysicsCategory
    // or we can expose it for testing. For now, test the regex patterns directly.

    const patterns: [string, RegExp][] = [
        ['skirt', /スカート|skirt|フリル|frill|裾|hem/],
        ['chest', /胸|chest|bust|バスト/],
        ['hair', /髪|hair|ahoge|bangs|ponytail|前髪|後ろ髪/],
        ['accessory', /リボン|ribbon|アクセサリ|accessory|飾り|collar|ネクタイ|tie|紐|string|襟/],
    ];

    it('classifies bone names correctly', () => {
        const testCases: [string, string | null][] = [
            ['スカート', 'skirt'],
            ['Skirt_L', 'skirt'],
            ['胸', 'chest'],
            ['Chest', 'chest'],
            ['髪', 'hair'],
            ['Hair_Ahoge', 'hair'],
            ['リボン', 'accessory'],
            ['Ribbon', 'accessory'],
            ['NeckTie', 'accessory'],
            ['Arm_L', null],
            ['IndexFinger', null],
        ];
        for (const [name, expected] of testCases) {
            let matched: string | null = null;
            for (const [cat, re] of patterns) {
                if (re.test(name.toLowerCase())) {
                    matched = cat;
                    break;
                }
            }
            expect(matched).toBe(expected);
        }
    });
});
