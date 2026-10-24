/**
 * [doc:architecture] UI persistent store — ADR-141 split from core/state.ts.
 * 状态访问规约见 scene-state.ts 头部注释（单一写入点 + 禁止直接赋值 export let）。
 */

import type { UIState } from './types';

// ======== Popup State ========

export let popupOpen = false;
export function setPopupOpen(v: boolean): void {
    popupOpen = v;
}

// ======== UI State ========

/**
 * [audit:fix 2026-09] uiState 默认值（补齐「无默认值、消费方各自兜底」）：
 * 字段值对齐各消费方现有兜底语义（grep 消费点确认，逐一注释）；
 * 标注 undefined 的字段：init.ts 启动恢复链不将其镜像回 uiState（Go 持有用户持久值，
 * 若写入具体默认值，下次 flushUIState 的整对象载荷会经 Go json.Unmarshal 合并覆盖用户值）。
 * _buildUIStatePayload 过滤 undefined 值 → 这些字段不进入持久化载荷，零 clobber。
 */
export function defaultUIState(): UIState {
    return {
        // ===== init.ts 启动恢复链会镜像的字段：具体默认值（恢复时持久化值优先覆盖）=====
        performanceMode: 'auto', // settings-system.ts:151 兜底 'auto'
        fpsLimit: 0, // scene.ts:281 兜底 0（0=不限）
        frameCapEnabled: true, // scene.ts:277 `=== false` / settings-graphics `!== false`（undefined 视为 true）
        defaultPhysicsEnabled: true, // model-loader.ts:704 `!== false`（undefined 视为 true）
        renderScale: 1, // render-loop.ts:56 / settings-system.ts:145 兜底 1
        cameraSensitivity: 1, // camera-factory.ts:55 兜底 1
        invertYAxis: false, // camera-factory.ts:48/81 `=== true`（undefined 视为 false）
        autoScaleModel: false, // model-loader.ts:737 truthy 判断（默认关）
        autoCenterModel: true, // model-manager focus(id, frameCamera = true)：undefined 走默认参 true，true 等价
        materialCategoryMap: {}, // material.ts `?? null` / settings-resources `|| {}`：空表=无覆盖
        screenshotFormat: 'image/png', // scene-menu/motion-pose/thumbnail 兜底 image/png
        screenshotQuality: 0.9, // 同上兜底 0.9
        thumbnailResolution: 512, // library-core/audio-bus 等兜底 512
        screenshotDir: '', // settings-media.ts:416 兜底 空串
        resourceViewMode: 'list', // library-core 模块级默认 list
        volume: 0.7, // audio.ts:513 guardNum(uiState.volume, 0.7)
        audioOffset: 0, // audio.ts:524 guardNum(uiState.audioOffset, 0)
        bpmQuantizeEnabled: true, // settings-media get: v !== false；proc-motion 默认开
        autoLoadCompanionAudio: true, // ui-state.ts `!== false`（默认开）
        sfxEnabled: true, // audio-bus.ts:58/93 `!== false`
        sfxVolume: 0.7, // audio-bus.ts:59 兜底 0.7
        footstepEnabled: false, // footstep.ts:136 `if (!uiState.footstepEnabled)`（默认关）
        footstepVolume: 0.8, // audio-bus.ts:106 兜底 0.8
        autoUpdateEnabled: false, // init.ts:201 truthy 判断（默认关）
        showFpsClock: true, // status-bar `!== false`（undefined/null=显示）
        showRuntimeBadge: true, // 同上
        keepAwake: true, // settings-appearance `!== false`（undefined 视为 true）
        screenOrientation: 'auto', // settings-appearance 兜底 auto
        // ===== 恢复链不镜像回 uiState 的字段：显式 undefined（不进持久化载荷，避免 clobber Go 用户值）=====
        scale: undefined,
        popupWidth: undefined,
        accent: undefined,
        fontFamily: undefined,
        animations: undefined,
        blurBg: undefined,
        autoCameraEnabled: undefined,
        autoCameraBeatsPerSwitch: undefined,
        audioRepeatMode: undefined,
        keyBindings: undefined,
    };
}

export const uiState: UIState = {};
// [audit:fix 2026-09] 模块加载即填充默认值；init.ts 恢复链随后以持久化值覆盖对应字段（持久化优先）。
// 保持 const 对象标识不变：消费方持有同一引用，只做属性合并，不重新赋值对象本体。
Object.assign(uiState, defaultUIState());

/** 持久化回调。由 env-bridge.ts 在初始化时注册，避免循环依赖。 */
let _uiPersistCb: (() => void) | null = null;
export function setUIPersistCallback(cb: () => void): void {
    _uiPersistCb = cb;
}

export function setUIState(state: UIState): void {
    Object.assign(uiState, state);
    try {
        _uiPersistCb?.();
    } catch (e) {
        // [audit:P3] 持久化回调异常不应阻塞 UI 状态更新
        console.error('[ui-state] persist callback error:', e);
    }
}

// ======== UI 派生记忆态 ========

/** 当前选中的 time-of-day 预设 key。预设芯片高亮唯一来源，env-menu 顶层与 sky 子菜单共享同一状态。 */
export let activeTimeOfDayPreset = 'noon';
export function setActiveTimeOfDayPreset(v: string): void {
    activeTimeOfDayPreset = v;
}

// ======== VMD 伴音自动加载 ========
/** 加载 VMD 动作时自动发现并加载同目录同名音频（.mp3/.wav/.ogg/.flac）。默认开启。 */
export function isAutoLoadCompanionAudioEnabled(): boolean {
    return uiState.autoLoadCompanionAudio !== false;
}
