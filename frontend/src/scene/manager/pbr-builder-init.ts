// [doc:adr-188] PBR 材质构建器动态导入与切换
// 提取为独立模块，避免 scene.ts 的 Babylon.js 顶层初始化在测试环境无法导入。

import { logWarn } from '../../core/logger';

/**
 * 动态导入 PBRMaterialBuilder 并覆盖 MmdModelLoader.SharedMaterialBuilder。
 * 默认 'babylon-mmd/esm/Loader/mmdModelLoader' import 已注册 MmdStandardMaterialBuilder，
 * PBR 模式下调用此函数切换为 PBRMaterialBuilder。
 * @internal 导出供测试
 */
export async function tryApplyPbrMaterialBuilder(): Promise<void> {
    try {
        const { MmdModelLoader } = await import('babylon-mmd/esm/Loader/mmdModelLoader.pure');
        const { PBRMaterialBuilder } = await import('babylon-mmd/esm/Loader/pbrMaterialBuilder');
        MmdModelLoader.SharedMaterialBuilder = new PBRMaterialBuilder();
        logWarn(
            'scene',
            'PBR 模式已启用：MmdModelLoader.SharedMaterialBuilder = PBRMaterialBuilder',
        );
    } catch (e) {
        logWarn('scene', 'PBRMaterialBuilder 加载失败，回退 StandardMaterial：', e);
    }
}