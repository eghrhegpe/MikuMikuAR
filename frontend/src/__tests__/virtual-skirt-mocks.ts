// virtual-skirt-mocks.ts — 共享 vi.mock 工厂（ADR-204 P3，拆自 virtual-skirt.test.ts）
// 仅 mock WASM 物理绑定层 + core/backend 能力层；math.vector / skirt-analyzer / physics-bridge / logger 保持真实。
// 工厂函数供各拆分文件以 `vi.mock('<原路径>', () => factory())` 引用，避免 7 处 vi.mock 重复书写。
import { vi } from 'vitest';

// 跨用例共享的调用顺序 / 初始变换捕获（P1 校验用）
// 注意：不能用 vi.hoisted 再 export —— Vite 禁止导出 hoisted 变量。
// 本模块工厂函数均为间接调用（vi.mock('...', () => mockX())），执行时机晚于模块初始化，
// 故用普通对象即可安全共享实例（且仅被本测试集各文件各自隔离导入）。
export const hoisted = {
    callOrder: [] as string[],
    initialTransforms: [] as number[][],
};

export const resetHoisted = () => {
    hoisted.callOrder.length = 0;
    hoisted.initialTransforms.length = 0;
};

export const mockMmdWasmPhysicsRuntimeImpl = () => ({
    MmdWasmPhysicsRuntimeImpl: class {
        wasmInstance = {};
        addRigidBody = vi.fn(() => true);
        removeRigidBody = vi.fn(() => true);
        addConstraint = vi.fn(() => true);
        removeConstraint = vi.fn(() => true);
    },
});

// [doc:adr-178] virtual-skirt 现依赖能力层 getCachedCapabilities；隔离 backend 避免测试中拉起 adapter 链
export const mockBackend = () => ({
    getCachedCapabilities: () => ({
        crossOriginIsolated: true,
        clipboardReliable: true,
        arScope: 'none' as const,
        ar: true,
        externalApps: true,
        plazaWindow: true,
        fsAccess: false,
        watchDir: true,
        proxyServer: true,
        fileServer: true,
        systemDirOpen: true,
        storageMode: true,
        screenshotSave: true,
        cacheManage: true,
        configPersist: true,
        modelScan: true,
        installApk: false,
        installLocal: false,
        inAppBrowser: false,
        fsSelectDir: false,
        localStaging: false,
        androidStorageMode: false,
    }),
});

export const mockRigidBody = () => ({
    RigidBody: class {
        isDynamic = true;
        constructor(_runtime: unknown, _info: unknown) {}
        dispose = () => {
            hoisted.callOrder.push('rb.dispose');
        };
        setTransformMatrix = vi.fn(() => {
            hoisted.callOrder.push('rb.setTransformMatrix');
        });
        getTransformMatrixToArray = (arr: Float32Array, offset = 0) => {
            arr[offset + 12] = 0.1;
            arr[offset + 13] = 0.2;
            arr[offset + 14] = 0.3;
        };
    },
});

export const mockRigidBodyConstructionInfo = () => ({
    RigidBodyConstructionInfo: class {
        shape: unknown = null;
        motionType = 0;
        mass = 0;
        linearDamping = 0;
        angularDamping = 0;
        friction = 0;
        restitution = 0;
        disableDeactivation = false;
        constructor(_wasm: unknown) {}
        dispose = () => {
            hoisted.callOrder.push('info.dispose');
        };
        setInitialTransform = (m: { m: number[] }) => {
            hoisted.initialTransforms.push([m.m[12], m.m[13], m.m[14]]);
        };
    },
});

export const mockConstraint = () => ({
    Generic6DofSpringConstraint: class {
        constructor(
            _r: unknown,
            _a: unknown,
            _b: unknown,
            _fa: unknown,
            _fb: unknown,
            _use: unknown
        ) {}
        dispose = () => {
            hoisted.callOrder.push('constraint.dispose');
        };
        enableSpring = vi.fn();
        setStiffness = vi.fn();
        setDamping = vi.fn();
    },
});

export const mockPhysicsShape = () => ({
    PhysicsSphereShape: class {
        constructor(_r: unknown, _radius: unknown) {}
        dispose = () => {
            hoisted.callOrder.push('shape.dispose');
        };
    },
    PhysicsBoxShape: class {
        constructor(_r: unknown, _size: unknown) {}
        dispose = () => {
            hoisted.callOrder.push('shape.dispose');
        };
    },
});

export const mockMotionType = () => ({
    MotionType: { Dynamic: 0, Static: 1, Kinematic: 2 },
});
