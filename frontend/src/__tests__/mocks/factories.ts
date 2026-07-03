// [doc:mock-strategy] 测试 mock 工厂函数集合
// 用于快速创建常见的 mock 对象（mesh、material、model 等）
// 所有工厂函数返回的对象结构与 Babylon.js 对应类兼容

import {
    MockStandardMaterial,
    MockMesh,
    MockEngine,
    MockScene,
    MockColor3,
} from './babylon-classes';

/** 创建一个 mock StandardMaterial 实例（可通过 instanceof 守卫） */
export function createMockMaterial(
    name = 'mat0',
    opts?: Partial<{
        diffuseR: number;
        diffuseG: number;
        diffuseB: number;
        specularR: number;
        specularG: number;
        specularB: number;
        specularPower: number;
        alpha: number;
    }>
): any {
    const mat = new MockStandardMaterial(name);
    if (opts?.diffuseR !== undefined) {
        mat.diffuseColor.r = opts.diffuseR;
    }
    if (opts?.diffuseG !== undefined) {
        mat.diffuseColor.g = opts.diffuseG;
    }
    if (opts?.diffuseB !== undefined) {
        mat.diffuseColor.b = opts.diffuseB;
    }
    if (opts?.specularR !== undefined) {
        mat.specularColor.r = opts.specularR;
    }
    if (opts?.specularG !== undefined) {
        mat.specularColor.g = opts.specularG;
    }
    if (opts?.specularB !== undefined) {
        mat.specularColor.b = opts.specularB;
    }
    if (opts?.specularPower !== undefined) {
        mat.specularPower = opts.specularPower;
    }
    if (opts?.alpha !== undefined) {
        mat.alpha = opts.alpha;
    }
    return mat;
}

/** 创建一个 mock Mesh（带 material） */
export function createMockMesh(name = 'mesh0', material?: any): any {
    const mesh = new MockMesh(name);
    mesh.material = material ?? createMockMaterial(name);
    return mesh;
}

/** 向 modelRegistry 注册一个 mock 模型（带指定数量的 mesh） */
export function registerMockModel(
    modelRegistry: Map<string, any>,
    modelId: string,
    meshCount: number,
    meshNames?: string[]
): void {
    const meshes = Array.from({ length: meshCount }, (_, i) =>
        createMockMesh(meshNames?.[i] ?? `mesh${i}`)
    );
    modelRegistry.set(modelId, { meshes });
}

/** 创建 mock Engine + Scene 组合 */
export function createMockScene() {
    const engine = new MockEngine();
    const scene = new MockScene(engine);
    return { engine, scene };
}

/** 创建一个 mock Color3（与 MockColor3 行为一致的颜色对象） */
export function createMockColor3(r = 0, g = 0, b = 0): any {
    return new MockColor3(r, g, b);
}

/** 向 DOM 注入测试必需的元素（供 config.ts 的 dom 引用） */
export function setupMockDom(extraIds: string[] = []): void {
    const ids = [
        'renderCanvas',
        'statusBar',
        'loading',
        'loadingText',
        'btnMainAction',
        'btnMotionPopup',
        'playbackBar',
        'btnPlayPause',
        'btnLoopToggle',
        'timeDisplay',
        'seekBar',
        'seekProgress',
        'btnSettings',
        'btnScene',
        'sceneOverlay',
        ...extraIds,
    ];
    for (const id of ids) {
        if (!document.getElementById(id)) {
            const el = document.createElement('div');
            el.id = id;
            document.body.appendChild(el);
        }
    }
}

/** 清理 setupMockDom 创建的 DOM 元素 */
export function teardownMockDom(): void {
    document.body.innerHTML = '';
}
