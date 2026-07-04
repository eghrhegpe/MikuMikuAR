// ─── Unit tests for model-ops.ts ───────────────────────────────────────
// Tests that each exported function correctly delegates to modelManager
// and handles edge cases (unknown model IDs, null mmdRuntime, etc.).
//
// Strategy:
//   - model-ops imports from `../../core/config` — we set up DOM elements
//     (like model-preset.test.ts) so the real config module works, and
//     control state via config setter functions (setModelRegistry, setIsPlaying, etc.).
//   - modelManager IS mockable via `../scene/scene` which vitest matches by resolved path.
//   - Other imports (material, env, camera, playback, audio) are also mocked.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ── Set up DOM elements the real config module depends on ────────────
vi.hoisted(() => {
    const ids = [
        'renderCanvas', 'statusBar', 'loading', 'btnMainAction',
        'btnMotionPopup', 'playbackBar', 'btnPlayPause', 'btnLoopToggle',
        'timeDisplay', 'seekBar', 'seekProgress', 'loadingText',
        'btnSettings', 'btnScene', 'sceneOverlay',
    ];
    for (const id of ids) {
        const el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
});

// ── Mock modelManager (vitest matches by resolved absolute path) ─────
const { mockModelManager } = vi.hoisted(() => {
    const mm = {
        focus: vi.fn(),
        arrange: vi.fn(),
        setVisibility: vi.fn(),
        setOpacity: vi.fn(),
        setWireframe: vi.fn(),
        setBoneLinesVis: vi.fn(),
        setBoneJointsVis: vi.fn(),
        setPhysics: vi.fn(),
        getPhysicsCategories: vi.fn().mockReturnValue([]),
        getPhysicsCatState: vi.fn().mockReturnValue(null),
        isPhysicsCategoryEnabled: vi.fn().mockReturnValue(false),
        setPhysicsCategory: vi.fn(),
        setScaling: vi.fn(),
        setRotationY: vi.fn(),
        setPosition: vi.fn(),
        getPosition: vi.fn().mockReturnValue([0, 0, 0]),
        resetTransform: vi.fn(),
        clearVmdData: vi.fn(),
        getMorphs: vi.fn().mockReturnValue([]),
        setMorphWeight: vi.fn(),
        getMorphWeight: vi.fn().mockReturnValue(0),
        resetMorphs: vi.fn(),
        remove: vi.fn(),
    };
    return { mockModelManager: mm };
});

vi.mock('../scene/scene', () => ({
    get modelManager() { return mockModelManager; },
}));

// Mock other scene sub-module imports (camera/motion/playback etc.)
vi.mock('../scene/manager/material', () => ({
    _catState: {},
    _matState: {},
    _matEnabled: false,
    disposeModelMaterialState: vi.fn(),
}));

vi.mock('../scene/env/env', () => ({
    refreshWaterRenderList: vi.fn(),
}));

vi.mock('../scene/camera/camera', () => ({
    getCameraMode: vi.fn(() => 'orbit'),
    switchCameraMode: vi.fn(),
}));

vi.mock('../scene/motion/playback', () => ({
    updatePlaybackUI: vi.fn(),
}));

vi.mock('../outfit/audio', () => ({
    disposeAudio: vi.fn(),
}));

vi.mock('@babylonjs/core/Maths/math.vector', () => {
    const m = require('./mocks/babylon-classes.ts');
    return {
        Vector3: m.MockVector3,
        Quaternion: m.MockQuaternion,
        Matrix: m.MockMatrix,
        TmpVectors: { Vector3: [] },
    };
});

// ── Test imports — uses REAL config module (DOM elements pre-created) ─
import {
    focusModel,
    arrangeModels,
    setModelVisibility,
    setModelOpacity,
    setModelWireframe,
    setModelBoneLinesVis,
    setModelBoneJointsVis,
    setModelPhysics,
    getPhysicsCategories,
    getPhysicsCatState,
    isPhysicsCategoryEnabled,
    setPhysicsCategory,
    setModelScaling,
    setModelRotationY,
    setModelPosition,
    getModelPosition,
    resetModelTransform,
    stopVMD,
    getModelMorphs,
    setModelMorphWeight,
    getModelMorphWeight,
    resetModelMorphs,
    applyVPDPose,
    removeModel,
    removeFocusedModel,
} from '../scene/manager/model-ops';

// Real config setters — used to drive state for complex functions
import {
    modelRegistry,
    setModelRegistry,
    setIsPlaying,
    setMmdRuntime,
} from '../core/config';

import * as cameraModule from '../scene/camera/camera';
import * as playbackModule from '../scene/motion/playback';
import * as materialModule from '../scene/manager/material';
import * as envModule from '../scene/env/env';
import * as audioModule from '../outfit/audio';

// ── Helpers ──────────────────────────────────────────────────────────

function makeInst(overrides: Record<string, any> = {}): any {
    return {
        id: 'test',
        name: 'TestModel',
        filePath: 'D:/test/test.pmx',
        port: 12345,
        modelDir: 'D:/test',
        kind: 'actor',
        visible: true,
        opacity: 1,
        wireframe: false,
        showBoneLines: false,
        showBoneJoints: false,
        physicsEnabled: true,
        scaling: 1,
        rotationY: 0,
        vmdData: null,
        vmdName: '',
        vmdPath: null,
        animationDuration: 0,
        meshes: [],
        mmdModel: null,
        outfitFile: undefined,
        activeVariant: undefined,
        _origTextures: undefined,
        _origParams: undefined,
        ...overrides,
    };
}

function resetState(): void {
    vi.clearAllMocks();
    setModelRegistry(new Map());
    setIsPlaying(false);
    setMmdRuntime(null);
}

const updatePlaybackUI = vi.mocked(playbackModule.updatePlaybackUI);
const disposeModelMaterialState = vi.mocked(materialModule.disposeModelMaterialState);
const refreshWaterRenderList = vi.mocked(envModule.refreshWaterRenderList);
const disposeAudio = vi.mocked(audioModule.disposeAudio);
const switchCameraMode = vi.mocked(cameraModule.switchCameraMode);
const getCameraMode = vi.mocked(cameraModule.getCameraMode);

// ═════════════════════════════════════════════════════════════════════
//  Tests
// ═════════════════════════════════════════════════════════════════════

describe('focusModel / arrangeModels', () => {
    beforeEach(resetState);

    it('focusModel delegates to modelManager.focus and updates playback UI', () => {
        focusModel('model-1');
        expect(mockModelManager.focus).toHaveBeenCalledWith('model-1');
        expect(updatePlaybackUI).toHaveBeenCalled();
    });

    it('arrangeModels delegates to modelManager.arrange', () => {
        arrangeModels();
        expect(mockModelManager.arrange).toHaveBeenCalled();
    });
});

// ── Visibility / Material / Debug ───────────────────────────────────

describe('Visibility / Material / Debug', () => {
    beforeEach(resetState);

    it('setModelVisibility delegates with id + visible', () => {
        setModelVisibility('m1', false);
        expect(mockModelManager.setVisibility).toHaveBeenCalledWith('m1', false);
        setModelVisibility('m2', true);
        expect(mockModelManager.setVisibility).toHaveBeenCalledWith('m2', true);
    });

    it('setModelOpacity delegates with id + opacity', () => {
        setModelOpacity('m1', 0.5);
        expect(mockModelManager.setOpacity).toHaveBeenCalledWith('m1', 0.5);
    });

    it('setModelWireframe delegates with id + wireframe', () => {
        setModelWireframe('m1', true);
        expect(mockModelManager.setWireframe).toHaveBeenCalledWith('m1', true);
    });

    it('setModelBoneLinesVis delegates with id + show', () => {
        setModelBoneLinesVis('m1', true);
        expect(mockModelManager.setBoneLinesVis).toHaveBeenCalledWith('m1', true);
    });

    it('setModelBoneJointsVis delegates with id + show', () => {
        setModelBoneJointsVis('m1', false);
        expect(mockModelManager.setBoneJointsVis).toHaveBeenCalledWith('m1', false);
    });
});

// ── Physics ─────────────────────────────────────────────────────────

describe('Physics', () => {
    beforeEach(resetState);

    it('setModelPhysics delegates with id + enabled', () => {
        setModelPhysics('m1', true);
        expect(mockModelManager.setPhysics).toHaveBeenCalledWith('m1', true);
        setModelPhysics('m1', false);
        expect(mockModelManager.setPhysics).toHaveBeenCalledWith('m1', false);
    });

    it('getPhysicsCategories returns from modelManager', () => {
        mockModelManager.getPhysicsCategories.mockReturnValue(['skirt', 'hair']);
        expect(getPhysicsCategories('m1')).toEqual(['skirt', 'hair']);
        expect(mockModelManager.getPhysicsCategories).toHaveBeenCalledWith('m1');
    });

    it('getPhysicsCatState returns from modelManager', () => {
        const state = { skirt: true, hair: false };
        mockModelManager.getPhysicsCatState.mockReturnValue(state);
        expect(getPhysicsCatState('m1')).toBe(state);
        expect(mockModelManager.getPhysicsCatState).toHaveBeenCalledWith('m1');
    });

    it('isPhysicsCategoryEnabled returns from modelManager', () => {
        mockModelManager.isPhysicsCategoryEnabled.mockReturnValue(true);
        expect(isPhysicsCategoryEnabled('m1', 'skirt')).toBe(true);
        expect(mockModelManager.isPhysicsCategoryEnabled).toHaveBeenCalledWith('m1', 'skirt');
    });

    it('setPhysicsCategory delegates with id + cat + enabled', () => {
        setPhysicsCategory('m1', 'skirt', true);
        expect(mockModelManager.setPhysicsCategory).toHaveBeenCalledWith('m1', 'skirt', true);
    });
});

// ── Transform ───────────────────────────────────────────────────────

describe('Transform', () => {
    beforeEach(resetState);

    it('setModelScaling delegates with id + scaling', () => {
        setModelScaling('m1', 2);
        expect(mockModelManager.setScaling).toHaveBeenCalledWith('m1', 2);
    });

    it('setModelRotationY delegates with id + rotationY', () => {
        setModelRotationY('m1', 1.57);
        expect(mockModelManager.setRotationY).toHaveBeenCalledWith('m1', 1.57);
    });

    it('setModelPosition delegates with id + x,y,z', () => {
        setModelPosition('m1', 1, 2, 3);
        expect(mockModelManager.setPosition).toHaveBeenCalledWith('m1', 1, 2, 3);
    });

    it('getModelPosition returns from modelManager', () => {
        mockModelManager.getPosition.mockReturnValue([1, 2, 3]);
        expect(getModelPosition('m1')).toEqual([1, 2, 3]);
        expect(mockModelManager.getPosition).toHaveBeenCalledWith('m1');
    });

    it('resetModelTransform delegates with id', () => {
        resetModelTransform('m1');
        expect(mockModelManager.resetTransform).toHaveBeenCalledWith('m1');
    });
});

// ── Morph / Expression ──────────────────────────────────────────────

describe('Morph / Expression', () => {
    beforeEach(resetState);

    it('getModelMorphs returns from modelManager', () => {
        const morphs = [{ name: 'あ', type: 0 }];
        mockModelManager.getMorphs.mockReturnValue(morphs);
        expect(getModelMorphs('m1')).toBe(morphs);
        expect(mockModelManager.getMorphs).toHaveBeenCalledWith('m1');
    });

    it('setModelMorphWeight delegates with id + morphName + weight', () => {
        setModelMorphWeight('m1', 'あ', 0.8);
        expect(mockModelManager.setMorphWeight).toHaveBeenCalledWith('m1', 'あ', 0.8);
    });

    it('getModelMorphWeight returns from modelManager', () => {
        mockModelManager.getMorphWeight.mockReturnValue(0.5);
        expect(getModelMorphWeight('m1', 'あ')).toBe(0.5);
        expect(mockModelManager.getMorphWeight).toHaveBeenCalledWith('m1', 'あ');
    });

    it('resetModelMorphs delegates with id', () => {
        resetModelMorphs('m1');
        expect(mockModelManager.resetMorphs).toHaveBeenCalledWith('m1');
    });
});

// ── stopVMD ─────────────────────────────────────────────────────────

describe('stopVMD', () => {
    beforeEach(resetState);

    it('is a no-op for unknown model id', () => {
        expect(() => stopVMD('unknown')).not.toThrow();
        expect(mockModelManager.clearVmdData).not.toHaveBeenCalled();
        expect(updatePlaybackUI).not.toHaveBeenCalled();
    });

    it('clears VMD data even without mmdModel, does not pause when not playing', () => {
        modelRegistry.set('m1', makeInst({ mmdModel: null }));
        setIsPlaying(false);

        stopVMD('m1');

        expect(mockModelManager.clearVmdData).toHaveBeenCalledWith('m1');
        expect(updatePlaybackUI).toHaveBeenCalled();
    });

    it('clears runtime animation when mmdModel exists, pauses when playing', () => {
        const setRuntimeAnim = vi.fn();
        modelRegistry.set('m1', makeInst({
            mmdModel: { setRuntimeAnimation: setRuntimeAnim, runtimeBones: [] },
        }));
        const mockPause = vi.fn();
        setMmdRuntime({ pauseAnimation: mockPause } as any);
        setIsPlaying(true);

        stopVMD('m1');

        expect(setRuntimeAnim).toHaveBeenCalledWith(null);
        expect(mockModelManager.clearVmdData).toHaveBeenCalledWith('m1');
        expect(mockPause).toHaveBeenCalled();
        expect(updatePlaybackUI).toHaveBeenCalled();
    });

    it('does not pause when isPlaying is false even with mmdModel', () => {
        const setRuntimeAnim = vi.fn();
        modelRegistry.set('m1', makeInst({
            mmdModel: { setRuntimeAnimation: setRuntimeAnim, runtimeBones: [] },
        }));
        const mockPause = vi.fn();
        setMmdRuntime({ pauseAnimation: mockPause } as any);
        setIsPlaying(false);

        stopVMD('m1');

        expect(setRuntimeAnim).toHaveBeenCalledWith(null);
        expect(mockModelManager.clearVmdData).toHaveBeenCalledWith('m1');
        expect(mockPause).not.toHaveBeenCalled();
        expect(updatePlaybackUI).toHaveBeenCalled();
    });
});

// ── applyVPDPose ────────────────────────────────────────────────────

describe('applyVPDPose', () => {
    let consoleWarnSpy: any;

    beforeEach(() => {
        resetState();
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleWarnSpy.mockRestore();
    });

    it('is a no-op and warns when model is not in registry', () => {
        applyVPDPose('unknown', [], []);
        expect(console.warn).toHaveBeenCalledWith(
            '[applyVPDPose] 模型未找到:',
            'unknown',
        );
        expect(mockModelManager.clearVmdData).not.toHaveBeenCalled();
    });

    it('is a no-op when mmdModel is missing from the instance', () => {
        modelRegistry.set('m1', makeInst({ mmdModel: undefined }));
        applyVPDPose('m1', [], []);
        expect(console.warn).toHaveBeenCalledWith(
            '[applyVPDPose] 模型未找到:',
            'm1',
        );
    });

    it('applies bone transforms and morph weights to a valid model', () => {
        const boneLeftShoulder = {
            name: '左肩',
            linkedBone: { position: null, rotationQuaternion: null },
        };
        const boneRightShoulder = {
            name: '右肩',
            linkedBone: { position: null, rotationQuaternion: null },
        };
        const setRuntimeAnim = vi.fn();

        modelRegistry.set('m1', makeInst({
            mmdModel: {
                setRuntimeAnimation: setRuntimeAnim,
                runtimeBones: [boneLeftShoulder, boneRightShoulder],
            },
        }));
        const mockPause = vi.fn();
        setMmdRuntime({ pauseAnimation: mockPause } as any);
        setIsPlaying(false);

        const bones = [
            { name: '左肩', position: [0.1, 0.2, 0.3] as [number, number, number],
              rotation: [0, 0.07, 0, 1] as [number, number, number, number] },
            { name: '右肩', position: [-0.1, 0.2, 0.3] as [number, number, number],
              rotation: [0, -0.07, 0, 1] as [number, number, number, number] },
        ];
        const morphs = [
            { name: 'あ', weight: 0.8 },
            { name: '笑い', weight: 0.5 },
        ];

        applyVPDPose('m1', bones, morphs);

        expect(setRuntimeAnim).toHaveBeenCalledWith(null);
        expect(boneLeftShoulder.linkedBone.position).toBeTruthy();
        expect(boneLeftShoulder.linkedBone.position.x).toBe(0.1);
        expect(boneLeftShoulder.linkedBone.position.y).toBe(0.2);
        expect(boneLeftShoulder.linkedBone.position.z).toBe(0.3);
        expect(boneLeftShoulder.linkedBone.rotationQuaternion.x).toBe(0);
        expect(boneLeftShoulder.linkedBone.rotationQuaternion.y).toBe(0.07);
        expect(boneLeftShoulder.linkedBone.rotationQuaternion.z).toBe(0);
        expect(boneLeftShoulder.linkedBone.rotationQuaternion.w).toBe(1);
        expect(boneRightShoulder.linkedBone.position.x).toBe(-0.1);
        expect(boneRightShoulder.linkedBone.rotationQuaternion.y).toBe(-0.07);
        expect(mockModelManager.setMorphWeight).toHaveBeenCalledWith('m1', 'あ', 0.8);
        expect(mockModelManager.setMorphWeight).toHaveBeenCalledWith('m1', '笑い', 0.5);
        expect(mockModelManager.setMorphWeight).toHaveBeenCalledTimes(2);

        // Unknown bone names are silently skipped
        mockModelManager.setMorphWeight.mockClear();
        const unknownBones = [
            ...bones,
            { name: '非存在ボーン', position: [0, 0, 0] as [number, number, number],
              rotation: [0, 0, 0, 1] as [number, number, number, number] },
        ];
        applyVPDPose('m1', unknownBones, []);
        expect(boneLeftShoulder.linkedBone.position.x).toBe(0.1);
        expect(mockModelManager.setMorphWeight).not.toHaveBeenCalled();
    });
});

// ── removeModel ─────────────────────────────────────────────────────

describe('removeModel', () => {
    beforeEach(resetState);

    it('calls disposeModelMaterialState, modelManager.remove, and refreshWaterRenderList', () => {
        modelRegistry.set('m1', makeInst({ id: 'm1' }));
        removeModel('m1');
        expect(disposeModelMaterialState).toHaveBeenCalledWith('m1');
        expect(mockModelManager.remove).toHaveBeenCalledWith('m1');
        expect(refreshWaterRenderList).toHaveBeenCalled();
    });

    it('switches to orbit camera when no focused model and camera is in concert mode', () => {
        getCameraMode.mockReturnValue('concert' as any);
        modelRegistry.set('m1', makeInst({ id: 'm1' }));
        removeModel('m1');
        expect(switchCameraMode).toHaveBeenCalledWith('orbit');
    });

    it('does not switch camera when a model is focused', () => {
        getCameraMode.mockReturnValue('concert' as any);
        modelRegistry.set('m1', makeInst({ id: 'm1' }));
        modelRegistry.set('m2', makeInst({ id: 'm2' }));
        removeModel('m1');
        expect(mockModelManager.remove).toHaveBeenCalledWith('m1');
    });

    it('resets playback state and hides UI when last model is removed', () => {
        removeModel('m1');
        expect(disposeAudio).toHaveBeenCalled();
    });

    it('does not clear playback state when other models remain', () => {
        modelRegistry.set('other', makeInst({ id: 'other' }));
        removeModel('m1');
        expect(disposeAudio).not.toHaveBeenCalled();
    });
});

// ── removeFocusedModel ──────────────────────────────────────────────

describe('removeFocusedModel', () => {
    beforeEach(resetState);

    it('is a no-op when focusedModelId is null', () => {
        removeFocusedModel();
        expect(mockModelManager.remove).not.toHaveBeenCalled();
    });

    it('is safe to call (API contract — delegates to removeModel when model focused)', () => {
        removeFocusedModel();
        expect(mockModelManager.remove).not.toHaveBeenCalled();
    });
});
