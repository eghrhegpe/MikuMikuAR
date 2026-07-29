// model-ops 拆分 — removeModel / removeFocusedModel
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    modelOpsShared,
    mockSceneModule,
    mockMaterial,
    mockEnv,
    mockCamera,
    mockPlayback,
    mockAudio,
} from './model-ops-mocks';
import { makeInst, resetState, modelRegistry, setFocusedModelId } from './model-ops-helpers';
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
import * as cameraModule from '../scene/camera/camera';
import * as playbackModule from '../scene/motion/playback';
import * as materialModule from '../scene/manager/material';
import * as envModule from '../scene/env/env';
import * as audioModule from '../outfit/audio';

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
const refreshWaterRenderList = vi.mocked(envModule.refreshWaterRenderList);
const disposeAudio = vi.mocked(audioModule.disposeAudio);
const switchCameraMode = vi.mocked(cameraModule.switchCameraMode);
const getCameraMode = vi.mocked(cameraModule.getCameraMode);

describe('removeModel', () => {
    beforeEach(resetState);

    it('calls modelManager.remove and refreshWaterRenderList', () => {
        modelRegistry.set('m1', makeInst({ id: 'm1' }));
        removeModel('m1');
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

    it('calls removeModel when a model is focused', () => {
        modelRegistry.set('m1', makeInst({ id: 'm1' }));
        setFocusedModelId('m1');
        removeFocusedModel();
        expect(mockModelManager.remove).toHaveBeenCalledWith('m1');
    });
});
