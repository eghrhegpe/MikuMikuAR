// [doc:mock-strategy] 统一 babylon-mmd mock 类集合
// 所有测试文件共享同一套 mock 实现

export class MockMmdCamera {
    static _RotationMatrix: any = null;
    static _UpVector: any = null;
    static _TargetVector: any = null;
    position = { x: 0, y: 10, z: -15 };
    target = { x: 0, y: 0, z: 0 };
    animate() {}
    constructor() {}
    getClassName() { return 'MmdCamera'; }
}

export class MockMmdStandardMaterialProxy {
    constructor() {}
    getClassName() { return 'MmdStandardMaterialProxy'; }
}

export class MockMmdRuntimeShared {
    constructor() {}
    getClassName() { return 'MmdRuntimeShared'; }
}

export class MockMmdWasmRuntime {
    registerMesh() {}
    setMeshVisibility() {}
    setMeshOpacity() {}
    setMeshWireframe() {}
    constructor() {}
    getClassName() { return 'MmdWasmRuntime'; }
}

export class MockMmdWasmAnimation {
    runtimeAnimations: any[] = [];
    constructor() {}
    getClassName() { return 'MmdWasmAnimation'; }
}

export class MockVmdLoader {
    static LoadAsync() {}
    constructor() {}
    getClassName() { return 'VmdLoader'; }
}

export const MockRegisterMmdModelLoaders = () => {};
export const MockRegisterDxBmpTextureLoader = () => {};
export const MockGetMmdWasmInstance = async () => null;

export const emptyModule = {};
