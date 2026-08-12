// model-preset-helpers.ts — 共享测试辅助（ADR-204 P3，拆自 model-preset.test.ts）
// 仅包含纯函数与 setup 函数；vi.mock 调用保留在各拆分文件顶部（vitest 要求顶层 hoist）。
// 注意：本模块被测试文件 import 后，其 `../scene/motion/playback` / `../core/toast` 等导入
// 会随测试文件的 vi.mock 一起被替换为 mock（vitest 按测试文件的模块图解析），故 updatePlaybackUI 取到的是 mock。
import { vi } from 'vitest';
import * as sceneModule from '../scene/scene';
import { updatePlaybackUI } from '../scene/motion/playback';
import { MockPBRMaterial } from './mocks/babylon-classes';
import {
    modelRegistry,
    dom,
    setMmdRuntime,
    setIsPlaying,
    isPlaying,
    mmdRuntime,
} from '../core/config';

// 在 vi.hoisted 中调用，确保 config.ts 的 dom 在 import 时已拿到有效元素
export function createTestDom(): void {
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
        if (!document.getElementById(id)) {
            const el = document.createElement('div');
            el.id = id;
            document.body.appendChild(el);
        }
    }
}

export function cloneColor(c: any) {
    return {
        ...c,
        clone() {
            return cloneColor(this);
        },
    };
}

export const BASE_MAT_COLOR = {
    r: 1,
    g: 1,
    b: 1,
    set() {},
    clone() {
        return cloneColor(this);
    },
};

/** Create a fake mesh with the minimal interface needed by scene.ts operations. */
export function fakeMesh(name = 'mesh0'): any {
    return {
        name,
        position: {
            x: 0,
            y: 0,
            z: 0,
            set(x: number, y: number, z: number) {
                this.x = x;
                this.y = y;
                this.z = z;
            },
        },
        scaling: {
            setAll(_v: number) {
                /* noop */
            },
        },
        rotation: { y: 0 },
        setEnabled(_v: boolean) {
            /* noop */
        },
        material: {
            name,
            alpha: 1,
            diffuseColor: {
                ...BASE_MAT_COLOR,
                clone() {
                    return { ...this };
                },
            },
            specularColor: {
                ...BASE_MAT_COLOR,
                clone() {
                    return { ...this };
                },
            },
            specularPower: 50,
            ambientColor: {
                ...BASE_MAT_COLOR,
                clone() {
                    return { ...this };
                },
            },
        },
    };
}

/** Create N fake meshes, each with material name `mat{idx}`. */
export function fakeMeshes(count: number): any[] {
    return Array.from({ length: count }, (_, i) => {
        const m = fakeMesh(`mat${i}`);
        return m;
    });
}

/**
 * Create N fake meshes with PBRMaterial instances (ADR-188 PBR roundtrip).
 * material 为 MockPBRMaterial 实例（含 albedoColor/reflectionColor/roughness/metallic 与
 * PBRSubSurfaceConfiguration 插件 stub），供 _capturePbr/_applyPbrMatParams 分支使用。
 */
export function fakePbrMeshes(count: number): any[] {
    return Array.from({ length: count }, (_, i) => {
        const name = `mat${i}`;
        return {
            name,
            position: {
                x: 0, y: 0, z: 0,
                set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; },
            },
            scaling: { setAll() {} },
            rotation: { y: 0 },
            setEnabled() {},
            material: new MockPBRMaterial(name),
        };
    });
}

/** Create a fake ModelInstance, register it in modelRegistry, and return the id. */
export function createModel(id: string, meshCount = 1, overrides?: Partial<any>): string {
    const defaults = {
        id,
        name: 'test-model',
        filePath: 'D:/models/test.pmx',
        port: 1234,
        modelDir: 'D:/models',
        meshes: fakeMeshes(meshCount),
        rootMesh: fakeMeshes(1)[0],
        vmdData: null,
        vmdName: '',
        vmdPath: null,
        animationDuration: 0,
        kind: 'actor',
        visible: true,
        opacity: 1,
        wireframe: false,
        showBoneLines: false,
        showBoneJoints: false,
        physicsEnabled: true,
        scaling: 1,
        rotationY: 0,
    };
    modelRegistry.set(id, { ...defaults, ...overrides } as any);
    return id;
}

export function cleanup(): void {
    modelRegistry.clear();
    (sceneModule as any)._catState.clear();
    (sceneModule as any)._matState.clear();
    (sceneModule as any)._matEnabled.clear();
    setMmdRuntime(null);
    setIsPlaying(false);
}

export function applySpies(): void {
    vi.restoreAllMocks();
    vi.spyOn(sceneModule, 'setModelPosition').mockImplementation((id, x, y, z) => {
        const inst = modelRegistry.get(id);
        if (!inst) {
            return;
        }
        if (inst.rootMesh.position.set) {
            inst.rootMesh.position.set(x, y, z);
        }
        const mesh = inst.meshes[0];
        if (mesh.position.set) {
            mesh.position.set(x, y, z);
        }
    });
    vi.spyOn(sceneModule, 'setModelScaling').mockImplementation((id, scaling) => {
        const inst = modelRegistry.get(id);
        if (inst) {
            inst.scaling = scaling;
        }
    });
    vi.spyOn(sceneModule, 'setModelRotationY').mockImplementation((id, rotationY) => {
        const inst = modelRegistry.get(id);
        if (inst) {
            inst.rotationY = rotationY;
        }
    });
    vi.spyOn(sceneModule, 'setModelVisibility').mockImplementation((id, visible) => {
        const inst = modelRegistry.get(id);
        if (inst) {
            inst.visible = visible;
        }
    });
    vi.spyOn(sceneModule, 'setModelOpacity').mockImplementation((id, opacity) => {
        const inst = modelRegistry.get(id);
        if (inst) {
            inst.opacity = opacity;
        }
    });
    vi.spyOn(sceneModule, 'setModelWireframe').mockImplementation((id, wireframe) => {
        const inst = modelRegistry.get(id);
        if (inst) {
            inst.wireframe = wireframe;
        }
    });
    vi.spyOn(sceneModule, 'stopVMD').mockImplementation((id) => {
        const inst = modelRegistry.get(id);
        if (!inst) {
            return;
        }
        if (inst.mmdModel && mmdRuntime) {
            inst.mmdModel.setRuntimeAnimation(null);
        }
        inst.vmdData = null;
        inst.vmdName = '';
        inst.vmdPath = null;
        inst.animationDuration = 0;
        if (isPlaying && mmdRuntime) {
            mmdRuntime.pauseAnimation();
            setIsPlaying(false);
        }
        updatePlaybackUI();
    });
}

/** 在拆分文件的 beforeAll 中调用：为 dom 单例补齐播放条等引用。 */
export function setupDomRefs(): void {
    dom.statusBar = document.createElement('div') as HTMLDivElement;
    dom.playbackBar = document.createElement('div') as HTMLDivElement;
    dom.btnPlayPause = document.createElement('button') as HTMLButtonElement;
    dom.btnLoopToggle = document.createElement('button') as HTMLButtonElement;
    dom.timeDisplay = document.createElement('span') as HTMLSpanElement;
    dom.seekProgress = document.createElement('div') as HTMLDivElement;
}

/** 在拆分文件的 beforeEach 中调用：等价于原始文件的 beforeEach(cleanup + applySpies)。 */
export function modelPresetBeforeEach(): void {
    cleanup();
    applySpies();
}
