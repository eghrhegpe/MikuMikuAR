// [doc:architecture] Lighting — 预设过渡动画（tween）与预设应用
// 状态集中于 lightingState，本文件不再持有任何模块级可变状态。

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { lightingState, type LightingTween } from './lighting-state';
import { col3FromTriple } from '@/core/color-helpers';
import { addStageLight, removeStageLight, setStageLightState } from './lighting-stage';
import { LIGHTING_PRESETS } from './lighting-presets';

export function _cancelAllLightingTweens(): void {
    for (const [, tw] of lightingState.activeTweens) {
        tw.cancel();
    }
    lightingState.activeTweens.clear();
}

export function _tweenValue(
    from: number,
    to: number,
    durationMs: number,
    onUpdate: (v: number) => void,
    onComplete?: () => void
): LightingTween {
    const id = ++lightingState.tweenIdCounter;
    let cancelled = false;
    const start = performance.now();

    const tick = () => {
        if (cancelled) {
            return;
        }
        const t = Math.min(1, (performance.now() - start) / durationMs);
        const eased = t * (2 - t); // ease-out quad
        onUpdate(from + (to - from) * eased);
        if (t >= 1) {
            lightingState.activeTweens.delete(id);
            onComplete?.();
        } else {
            // 未完成时重新注册下一帧
            lightingState.scene?.onBeforeRenderObservable.addOnce(tick);
        }
    };

    const tw: LightingTween = {
        id,
        cancel: () => {
            cancelled = true;
            lightingState.activeTweens.delete(id);
        },
    };
    lightingState.activeTweens.set(id, tw);
    lightingState.scene!.onBeforeRenderObservable.addOnce(tick);
    return tw;
}

export function _tweenColor3(
    from: Color3,
    to: Color3,
    durationMs: number,
    onUpdate: (c: Color3) => void,
    onComplete?: () => void
): void {
    const result = new Color3(0, 0, 0);
    _tweenValue(
        0,
        1,
        durationMs,
        (t) => {
            result.r = from.r + (to.r - from.r) * t;
            result.g = from.g + (to.g - from.g) * t;
            result.b = from.b + (to.b - from.b) * t;
            onUpdate(result);
        },
        onComplete
    );
}

// ======== Lighting Preset Application ========

/**
 * 应用灯光预设——复用现有灯光，平滑过渡参数。
 * 由 EnvBridge 在 lightingPresetName 变化时调用。
 */
export function applyLightingPresetFromEnv(presetName: string | null): void {
    if (!presetName) {
        return;
    }
    const preset = LIGHTING_PRESETS[presetName];
    if (!preset) {
        return;
    }

    _cancelAllLightingTweens();

    const targetCount = preset.lights.length;

    // 1. 补齐灯光数量
    while (Array.from(lightingState.stageLights.keys()).length < targetCount) {
        const idx = Array.from(lightingState.stageLights.keys()).length;
        const pl = preset.lights[idx];
        addStageLight(pl.type, pl.state as Partial<import('./lighting').StageLightState>);
    }

    // 2. 删除多余灯光
    while (Array.from(lightingState.stageLights.keys()).length > targetCount) {
        const ids = Array.from(lightingState.stageLights.keys());
        removeStageLight(ids[ids.length - 1]);
    }

    // 3. 平滑过渡每盏灯的参数
    // 动画期间抑制自动保存（tween 每帧触发 setStageLightState，避免大量写盘）
    lightingState.skipLightAutoSave = true;
    // 追踪活跃 tween 数量，全部完成后恢复自动保存
    let pendingTweens = 0;
    const onTweenDone = () => {
        pendingTweens--;
        if (pendingTweens <= 0) {
            lightingState.skipLightAutoSave = false;
            if (lightingState.triggerAutoSave) {
                lightingState.triggerAutoSave();
            }
        }
    };
    const ids = Array.from(lightingState.stageLights.keys());
    for (let i = 0; i < ids.length; i++) {
        const entry = lightingState.stageLights.get(ids[i]);
        if (!entry) {
            continue;
        }
        const pl = preset.lights[i];

        // 切换类型（需要重建，跳过 tween）
        if (pl.type !== entry.state.type) {
            setStageLightState(
                { type: pl.type, ...pl.state } as Partial<import('./lighting').StageLightState>,
                ids[i]
            );
            continue;
        }

        // 位置过渡（orbit 参数）
        if (
            pl.state.orbitAzimuth !== undefined ||
            pl.state.orbitElevation !== undefined ||
            pl.state.orbitDistance !== undefined
        ) {
            const fromAz = entry.state.orbitAzimuth;
            const fromEl = entry.state.orbitElevation;
            const fromDist = entry.state.orbitDistance;
            const toAz = (pl.state.orbitAzimuth as number) ?? fromAz;
            const toEl = (pl.state.orbitElevation as number) ?? fromEl;
            const toDist = (pl.state.orbitDistance as number) ?? fromDist;
            pendingTweens++;
            _tweenValue(
                0,
                1,
                500,
                (t) => {
                    setStageLightState(
                        {
                            orbitAzimuth: fromAz + (toAz - fromAz) * t,
                            orbitElevation: fromEl + (toEl - fromEl) * t,
                            orbitDistance: fromDist + (toDist - fromDist) * t,
                        },
                        ids[i]
                    );
                },
                onTweenDone
            );
        }

        // 强度过渡
        if (pl.state.intensity !== undefined) {
            const from = entry.state.intensity;
            const to = pl.state.intensity as number;
            pendingTweens++;
            _tweenValue(
                from,
                to,
                300,
                (v) => {
                    setStageLightState({ intensity: v }, ids[i]);
                },
                onTweenDone
            );
        }

        // 颜色过渡
        if (pl.state.color !== undefined) {
            const from = new Color3(
                entry.state.color[0],
                entry.state.color[1],
                entry.state.color[2]
            );
            const tc = pl.state.color as [number, number, number];
            const to = col3FromTriple(tc);
            pendingTweens++;
            _tweenColor3(
                from,
                to,
                300,
                (c) => {
                    setStageLightState({ color: [c.r, c.g, c.b] }, ids[i]);
                },
                onTweenDone
            );
        }

        // 直接设置的参数（无 tween）
        const directKeys = [
            'angle',
            'exponent',
            'range',
            'shadowEnabled',
            'shadowType',
            'shadowResolution',
            'shadowBias',
            'enabled',
        ] as const;
        const directUpdates: Record<string, unknown> = {};
        let hasDirect = false;
        for (const key of directKeys) {
            if (pl.state[key] !== undefined) {
                directUpdates[key] = pl.state[key];
                hasDirect = true;
            }
        }
        if (hasDirect) {
            setStageLightState(
                directUpdates as Partial<import('./lighting').StageLightState>,
                ids[i]
            );
        }
    }

    // 无 tween 时立即恢复（所有灯走了类型切换 / 直接赋值路径）
    if (pendingTweens <= 0) {
        lightingState.skipLightAutoSave = false;
        if (lightingState.triggerAutoSave) {
            lightingState.triggerAutoSave();
        }
    }
}
