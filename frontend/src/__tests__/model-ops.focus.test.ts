// model-ops 拆分 — focusModel/arrangeModels + Visibility/Material/Debug
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
import { resetState, setMmdRuntime } from './model-ops-helpers';
import {
    focusModel,
    arrangeModels,
    setModelVisibility,
    setModelOpacity,
    setModelWireframe,
    setModelBoneLinesVis,
    setModelBoneJointsVis,
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
vi.mock('@/core/audio', () => mockAudio());
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

describe('focusModel / arrangeModels', () => {
    beforeEach(resetState);

    it('focusModel delegates to modelManager.focus and updates playback UI', () => {
        setMmdRuntime({} as any);
        focusModel('model-1');
        expect(mockModelManager.focus).toHaveBeenCalledWith('model-1');
        expect(updatePlaybackUI).toHaveBeenCalled();
    });

    it('arrangeModels delegates to modelManager.arrange', () => {
        arrangeModels();
        expect(mockModelManager.arrange).toHaveBeenCalled();
    });
});

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
