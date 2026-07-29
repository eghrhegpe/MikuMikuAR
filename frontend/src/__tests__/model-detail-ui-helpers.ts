// [doc:adr-204] model-detail-ui-helpers.ts — 纯 fixture（拆自 model-detail-ui.test.ts）
import { modelRegistry } from '../core/config';
import type { PopupLevel } from '../core/config';
import { mockModelManager } from './model-detail-ui-mocks';

export function fakeMesh(name = 'mat0'): any {
    return {
        name,
        position: { x: 0, y: 0, z: 0, set() {} },
        scaling: { setAll() {} },
        rotation: { y: 0 },
        setEnabled() {},
        getTotalVertices() {
            return 1000;
        },
        getTotalIndices() {
            return 3000;
        },
        material: {
            name,
            alpha: 1,
            diffuseColor: {
                r: 1,
                g: 1,
                b: 1,
                clone() {
                    return { ...this };
                },
            },
            specularColor: {
                r: 0.8,
                g: 0.8,
                b: 0.8,
                clone() {
                    return { ...this };
                },
            },
            specularPower: 50,
            ambientColor: {
                r: 0.3,
                g: 0.3,
                b: 0.3,
                clone() {
                    return { ...this };
                },
            },
        },
    };
}

export function createModel(id: string, overrides?: Partial<any>): string {
    const defaults = {
        id,
        name: 'test-model',
        filePath: 'D:/models/test.pmx',
        port: 1234,
        modelDir: 'D:/models',
        meshes: [fakeMesh('mat0')],
        rootMesh: fakeMesh('root'),
        vmdData: null,
        vmdName: '',
        vmdPath: null,
        animationDuration: 0,
        kind: 'actor' as const,
        visible: true,
        opacity: 1,
        wireframe: false,
        showBoneLines: false,
        showBoneJoints: false,
        physicsEnabled: true,
        scaling: 1,
        rotationY: 0,
    };
    const entry = { ...defaults, ...overrides } as any;
    modelRegistry.set(id, entry);
    // Also register in the mock modelManager so functions that query
    // modelManager.get(id) (e.g. buildModelInfoLevel, buildModelTagsLevel,
    // buildMorphPreviewLevel) can find the model.
    mockModelManager.get.mockImplementation((mid: string) => (mid === id ? entry : undefined));
    return id;
}

export function cleanup(): void {
    modelRegistry.clear();
    mockModelManager.get.mockReset();
}

export function hasRenderCustom(level: PopupLevel): boolean {
    return typeof level.renderCustom === 'function';
}
