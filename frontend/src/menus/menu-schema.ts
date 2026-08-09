// [doc:architecture] Menu Declarative Schema — ADR-093
// 单一数据源 + 单渲染器，消除命令式 builder 膨胀。
// 当前状态：P0+P1+P2 全量落地（57 面板），P3 类型化增强中。

import { envState } from '@/core/config';
import { setEnvState, getRenderState, setRenderState } from '@/scene/scene';
import { getLightState, setLightState } from '@/scene/render/lighting';
import { uiState, setUIState, focusedModelId, modelRegistry } from '@/core/state';
import {
    getPerceptionState,
    setPerceptionState,
} from '@/scene/motion/perception';
import { getModuleDefaultParam, getModuleState, setModuleParam } from '@/scene/motion/motion-modules/registry';

// [doc:adr-238] MenuNode 类型契约下沉 scene/shared/menu-node-types（纯类型叶），
// 此处引入 + re-export 保持既有消费者兼容（scene/motion 模块从叶引用，不再 import menus）。
import type { StatePath, ActionMenuCtx, MenuKind, ControlSpec, MenuNode } from '../scene/shared/menu-node-types';
export type { StatePath, ActionMenuCtx, MenuKind, ControlSpec, MenuNode } from '../scene/shared/menu-node-types';


// ======== 状态路径解析器 ========

/** 按 StatePath 获取当前值 */
export function getStateValue(path: StatePath, modelId?: string, actionId?: string): unknown {
    const [prefix, ...restParts] = path.split('.');
    const key = restParts.join('.');
    switch (prefix) {
        case 'env':
            return (envState as unknown as Record<string, unknown>)[key];
        case 'render':
            return (getRenderState() as unknown as Record<string, unknown>)[key];
        case 'light':
            return (getLightState() as unknown as Record<string, unknown>)[key];
        case 'ui':
            return (uiState as unknown as Record<string, unknown>)[key];
        case 'perception': {
            // [fix:P3] 场景级存储：参数统一单一来源，无 per-model 分支
            return (getPerceptionState() as unknown as Record<string, unknown>)[key];
        }
        case 'motionModule': {
            // 格式: motionModule.${moduleId}.${paramKey}
            // 注: 解构只取前两段，需从 path 重新解析剩余部分以支持 moduleId.paramKey 结构
            const rest = path.slice('motionModule.'.length);
            const dotIdx = rest.indexOf('.');
            if (dotIdx === -1) {
                return undefined;
            }
            const moduleId = rest.substring(0, dotIdx);
            const paramKey = rest.substring(dotIdx + 1);
            const mid = modelId ?? focusedModelId;
            if (!mid) {
                return undefined;
            }
            // [fix:P2] 改走 registry 单源（intent.motionModules + actionId）：
            // 此前读 inst.motionOverrideModules（per-model 旧源），与 registry 实际生效的
            // per-motion 新源脱节 → 滑块显示值 ≠ 生效值。缺省 actionId 回退激活动作。
            const modState = getModuleState(mid, moduleId, actionId);
            const v = modState.params[paramKey];
            // [doc:adr-116] 未 seed 时回退到模块注册默认值，避免滑块显示成负值 min（Q2 修复）
            if (v === undefined) {
                return getModuleDefaultParam(moduleId, paramKey);
            }
            return v;
        }
        default:
            return undefined;
    }
}

/** 按 StatePath 设置值 */
export function setStateValue(
    path: StatePath,
    value: unknown,
    modelId?: string,
    actionId?: string
): void {
    const [prefix, ...restParts] = path.split('.');
    const key = restParts.join('.');
    switch (prefix) {
        case 'env':
            setEnvState({ [key]: value });
            break;
        case 'light':
            setLightState({ [key]: value });
            break;
        case 'render':
            setRenderState({ [key]: value });
            break;
        case 'ui':
            setUIState({ [key]: value });
            break;
        case 'perception': {
            // [fix:P3] 场景级存储：参数统一单一来源，无 per-model 分支
            setPerceptionState({ [key]: value });
            break;
        }
        case 'motionModule': {
            // 格式: motionModule.${moduleId}.${paramKey}
            // 注: 解构只取前两段，需从 path 重新解析剩余部分
            const rest = path.slice('motionModule.'.length);
            const dotIdx = rest.indexOf('.');
            if (dotIdx === -1) {
                return;
            }
            const moduleId = rest.substring(0, dotIdx);
            const paramKey = rest.substring(dotIdx + 1);
            const mid = modelId ?? focusedModelId;
            if (!mid) {
                return;
            }
            // [fix:P2] 改走 registry 单源（intent.motionModules + actionId）：
            // 此前写 inst.motionOverrideModules（per-model 旧源），与 registry 生效源脱节。
            setModuleParam(mid, moduleId, paramKey, value as number | boolean, actionId);
            break;
        }
    }
}

/** 按 StatePath 获取 bind 函数（用于 registerControl 自更新） */
export function getBindFn(path: StatePath): () => unknown {
    return () => getStateValue(path);
}

// [doc:adr-238] E2E 状态读取器注入：core/dev-hooks 的 window.__state 钩子经
// core/e2e-state-bridge 获取 getStateValue（零依赖叶，不拖 scene 链），
// 本模块不再被 core 静态 import（切断 core→menus 反向边）。模块加载即注册。
import { setE2EStateReader } from '../core/e2e-state-bridge';
setE2EStateReader((path: string, modelId?: string): unknown =>
    getStateValue(path as StatePath, modelId)
);
