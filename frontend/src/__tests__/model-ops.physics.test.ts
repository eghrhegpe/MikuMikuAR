// model-ops 拆分 — Physics + Transform
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
import { resetState } from './model-ops-helpers';
import {
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
} from '../scene/manager/model-ops';
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

const _disposeModelMaterialState = vi.mocked(materialModule.disposeModelMaterialState);

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
