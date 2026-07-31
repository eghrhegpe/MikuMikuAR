// model-ops 拆分 — Morph/Expression + stopVMD
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    modelOpsShared,
    mockSceneModule,
    mockMaterial,
    mockEnv,
    mockCamera,
    mockPlayback,
    mockAudio,
} from './model-ops-mocks';
import {
    makeInst,
    resetState,
    modelRegistry,
    setMmdRuntime,
    setIsPlaying,
} from './model-ops-helpers';
import {
    stopVMD,
    getModelMorphs,
    setModelMorphWeight,
    getModelMorphWeight,
    resetModelMorphs,
} from '../scene/manager/model-ops';
import * as playbackModule from '../scene/motion/playback';
import * as materialModule from '../scene/manager/material';

const mockModelManager = modelOpsShared.mockModelManager;

vi.hoisted(() => {
    const ids = [
        'renderCanvas',
        'statusBar',
        'loading',
        'btnMainAction',
        'btnMotionPopup',
        'playbackBar',
        'btnPlayPause',
        'btnLoopToggle',
        'timeDisplay',
        'seekBar',
        'seekProgress',
        'loadingText',
        'btnSettings',
        'btnScene',
        'sceneOverlay',
    ];
    for (const id of ids) {
        const el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
});

vi.mock('../scene/scene', () => mockSceneModule(modelOpsShared.mockModelManager));
// 注意：vi.mock 工厂必须直接引用 imported 绑定 modelOpsShared.mockModelManager，
// 不能引用下方局部 const mockModelManager（vi.mock 被 hoist，工厂求值时局部 const 尚未初始化）。
vi.mock('../scene/manager/material', () => mockMaterial());
vi.mock('../scene/env/env', () => mockEnv());
vi.mock('../scene/camera/camera', () => mockCamera());
vi.mock('../scene/motion/playback', () => mockPlayback());
vi.mock('../outfit/audio', () => mockAudio());
vi.mock('@babylonjs/core/Maths/math.vector', async () => {
    const m = await vi.importActual<any>('./mocks/babylon-classes.ts');
    return {
        Vector3: m.MockVector3,
        Quaternion: m.MockQuaternion,
        Matrix: m.MockMatrix,
        TmpVectors: { Vector3: [] },
    };
});

const updatePlaybackUI = vi.mocked(playbackModule.updatePlaybackUI);
const _disposeModelMaterialState = vi.mocked(materialModule.disposeModelMaterialState);

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
        modelRegistry.set(
            'm1',
            makeInst({
                mmdModel: { setRuntimeAnimation: setRuntimeAnim, runtimeBones: [] },
            })
        );
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
        modelRegistry.set(
            'm1',
            makeInst({
                mmdModel: { setRuntimeAnimation: setRuntimeAnim, runtimeBones: [] },
            })
        );
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
