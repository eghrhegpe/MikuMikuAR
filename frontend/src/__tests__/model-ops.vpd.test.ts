// model-ops 拆分 — applyVPDPose
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
import { makeInst, resetState, modelRegistry, setMmdRuntime, setIsPlaying } from './model-ops-helpers';
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
        expect(console.warn).toHaveBeenCalledWith('[applyVPDPose] 模型未找到:', 'unknown');
        expect(mockModelManager.clearVmdData).not.toHaveBeenCalled();
    });

    it('is a no-op when mmdModel is missing from the instance', () => {
        modelRegistry.set('m1', makeInst({ mmdModel: undefined }));
        applyVPDPose('m1', [], []);
        expect(console.warn).toHaveBeenCalledWith('[applyVPDPose] 模型未找到:', 'm1');
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

        modelRegistry.set(
            'm1',
            makeInst({
                mmdModel: {
                    setRuntimeAnimation: setRuntimeAnim,
                    runtimeBones: [boneLeftShoulder, boneRightShoulder],
                },
            })
        );
        const mockPause = vi.fn();
        setMmdRuntime({ pauseAnimation: mockPause } as any);
        setIsPlaying(false);

        const bones = [
            {
                name: '左肩',
                position: [0.1, 0.2, 0.3] as [number, number, number],
                rotation: [0, 0.07, 0, 1] as [number, number, number, number],
            },
            {
                name: '右肩',
                position: [-0.1, 0.2, 0.3] as [number, number, number],
                rotation: [0, -0.07, 0, 1] as [number, number, number, number],
            },
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
            {
                name: '非存在ボーン',
                position: [0, 0, 0] as [number, number, number],
                rotation: [0, 0, 0, 1] as [number, number, number, number],
            },
        ];
        applyVPDPose('m1', unknownBones, []);
        expect(boneLeftShoulder.linkedBone.position.x).toBe(0.1);
        expect(mockModelManager.setMorphWeight).not.toHaveBeenCalled();
    });
});
