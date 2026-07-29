// [doc:adr-196] 场景运行时快照 — 供 AI 诊断助手注入上下文
//
// 采用 bridge 模式（对齐 performance.ts 的 registerRenderBridge）：
// scene.ts 在 initScene() 时通过 registerAiSnapshotBridge 注入引擎引用，
// 避免 ai → scene 的静态依赖（保持 ai 模块零循环依赖）。
// 未注册 bridge（initScene 前）时 captureSceneSnapshot 返回占位文本。

import type { Ktx2Capability } from '../gpu-capabilities';

/** AI 快照所需的引擎运行时读取桥接（由 scene.ts 注入）。 */
export interface SceneSnapshotBridge {
    getFps(): number;
    getModelCount(): number;
    getMeshCount(): number;
    getMaterialCount(): number;
    getActiveMotions(): string[];
    getPerformanceMode(): string;
    getRendererInfo(): { vendor: string; renderer: string };
    getKtx2Support(): Ktx2Capability;
}

/** 格式化后的快照数据（纯数据，便于测试）。 */
export interface SceneSnapshotData {
    fps: number;
    modelCount: number;
    meshCount: number;
    materialCount: number;
    activeMotions: string[];
    performanceMode: string;
    ktx2Supported: boolean;
    ktx2PreferredFormat: Ktx2Capability['preferredFormat'];
    rendererVendor: string;
    rendererName: string;
}

let _bridge: SceneSnapshotBridge | null = null;

/** 由 scene.ts 在 initScene() 时注入引擎引用（单向依赖，避免 ai → scene 静态耦合）。 */
export function registerAiSnapshotBridge(bridge: SceneSnapshotBridge): void {
    _bridge = bridge;
}

/** 将快照数据格式化为紧凑文本（≤ NFR-3 的 2048 字符预算）。 */
export function formatSceneSnapshot(d: SceneSnapshotData): string {
    const lines = [
        `FPS: ${d.fps.toFixed(1)}`,
        `模型数: ${d.modelCount}`,
        `Mesh 数: ${d.meshCount}`,
        `材质数: ${d.materialCount}`,
        `活动动画: ${d.activeMotions.length > 0 ? d.activeMotions.join(', ') : '(无)'}`,
        `性能模式: ${d.performanceMode}`,
        `KTX2: ${d.ktx2Supported ? `支持(${d.ktx2PreferredFormat ?? '?'})` : '不支持'}`,
        `GPU: ${d.rendererVendor} / ${d.rendererName}`,
    ];
    return lines.join('\n');
}

/** 采集当前场景快照结构化数据；未初始化时返回 null。 */
export function captureSceneSnapshotData(): SceneSnapshotData | null {
    if (!_bridge) {
        return null;
    }
    return {
        fps: _bridge.getFps(),
        modelCount: _bridge.getModelCount(),
        meshCount: _bridge.getMeshCount(),
        materialCount: _bridge.getMaterialCount(),
        activeMotions: _bridge.getActiveMotions(),
        performanceMode: _bridge.getPerformanceMode(),
        ktx2Supported: _bridge.getKtx2Support().supported,
        ktx2PreferredFormat: _bridge.getKtx2Support().preferredFormat,
        rendererVendor: _bridge.getRendererInfo().vendor,
        rendererName: _bridge.getRendererInfo().renderer,
    };
}

/** 采集当前场景快照文本；未初始化时返回占位符。 */
export function captureSceneSnapshot(): string {
    if (!_bridge) {
        return '(场景未初始化)';
    }
    const data: SceneSnapshotData = {
        fps: _bridge.getFps(),
        modelCount: _bridge.getModelCount(),
        meshCount: _bridge.getMeshCount(),
        materialCount: _bridge.getMaterialCount(),
        activeMotions: _bridge.getActiveMotions(),
        performanceMode: _bridge.getPerformanceMode(),
        ktx2Supported: _bridge.getKtx2Support().supported,
        ktx2PreferredFormat: _bridge.getKtx2Support().preferredFormat,
        rendererVendor: _bridge.getRendererInfo().vendor,
        rendererName: _bridge.getRendererInfo().renderer,
    };
    return formatSceneSnapshot(data);
}
