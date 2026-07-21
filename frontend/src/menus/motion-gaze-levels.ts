// [doc:architecture] Motion Perception Levels — 感知表现独立弹窗层级（ADR-093 schema 驱动）
// [doc:adr-071] 感知层统一入口：眼部跟随 / 头部跟随 / 呼吸 / 眨眼
// 与程序化动作解耦，独立文件责任分明
// 开关合并至 folder headerToggle（参考 env-menu 模式）

import { cardContainer, focusedModelId } from '../core/config';
import type { PopupLevel } from '../core/config';
import {
    getPerceptionState,
    setPerceptionState,
    activatePerception,
    pinPerception,
    unpinPerception,
    enableAllPerception,
    disableAllPerception,
    getPinnedModelIds,
    getPerceptionPerfTier,
    getPerceptionPerfManualTier,
    setPerceptionPerfTier,
    isAllPerceptionEnabled,
} from '../scene/motion/perception';
import { triggerAutoSave } from '../core/utils';
import { getMotionMenu } from './motion-popup';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { addPresetChip } from '../core/ui-helpers';
import { getModuleConflicts } from '../scene/motion/motion-modules/registry';

function refreshMotionMenu(): void {
    getMotionMenu()?.reRender();
}

function withActivate(_v: unknown): void {
    activatePerception();
    triggerAutoSave();
    refreshMotionMenu();
}

function withSaveOnly(_v: unknown): void {
    triggerAutoSave();
    refreshMotionMenu();
}

const gazeSchema: MenuNode[] = [
    // ── [doc:adr-164] 全员感知开关 ──
    {
        id: 'perception:enableAll',
        kind: 'toggle',
        label: 'motion.perceptionEnableAll',
        control: {
            bind: 'perception.allEnabled',
            get: () => isAllPerceptionEnabled(),
            set: (v: unknown) => {
                const enabled = Boolean(v);
                if (enabled) {
                    enableAllPerception();
                } else {
                    disableAllPerception();
                }
                return enabled;
            },
            onChange: () => {
                triggerAutoSave();
                refreshMotionMenu();
            },
        },
    },
    // ── [doc:adr-164] 当前性能档位显示 ──
    {
        id: 'perception:tierDisplay',
        kind: 'custom',
        renderCustom: (c) => {
            const wrap = document.createElement('div');
            wrap.style.cssText = 'padding:6px 14px;font-size:12px;color:var(--text-secondary);';
            const updateTier = () => {
                const tier = getPerceptionPerfTier();
                const tierKey: Record<string, string> = {
                    high: 'motion.perceptionTierHigh',
                    medium: 'motion.perceptionTierMedium',
                    low: 'motion.perceptionTierLow',
                };
                const icon = tier === 'low' ? '⚠️ ' : '';
                wrap.textContent = `${icon}${t('motion.perceptionTier')}: ${t(tierKey[tier] ?? tierKey.high)}`;
            };
            updateTier();
            // 注册自更新，tier 变化（包括自动降级）时刷新文本，不重建 DOM
            const menu = getMotionMenu();
            if (menu) {
                menu.registerControl(updateTier);
            }
            c.appendChild(wrap);
        },
    },
    // ── [doc:adr-164] 手动性能档位覆盖 ──
    {
        id: 'perception:tierOverride',
        kind: 'custom',
        renderCustom: (c) => {
            const wrap = document.createElement('div');
            wrap.style.cssText = 'padding:4px 14px;';
            const label = document.createElement('label');
            label.style.cssText = 'font-size:12px;color:var(--text-secondary);margin-right:8px;';
            label.textContent = t('motion.perceptionTier');
            const select = document.createElement('select');
            select.style.cssText =
                'font-size:12px;padding:2px 6px;border-radius:4px;border:1px solid var(--border);background:var(--bg);color:var(--text);';
            const options = [
                { value: 'auto', label: 'motion.perceptionTierAuto' },
                { value: 'high', label: 'motion.perceptionTierHigh' },
                { value: 'medium', label: 'motion.perceptionTierMedium' },
                { value: 'low', label: 'motion.perceptionTierLow' },
            ];
            for (const opt of options) {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = t(opt.label);
                select.appendChild(o);
            }
            // 读取当前手动设置（getPerceptionPerfManualTier 暴露存储态）
            select.value = getPerceptionPerfManualTier();
            select.onchange = () => {
                setPerceptionPerfTier(select.value as 'auto' | 'high' | 'medium' | 'low');
                triggerAutoSave();
                refreshMotionMenu();
            };
            wrap.appendChild(label);
            wrap.appendChild(select);
            c.appendChild(wrap);
        },
    },
    // ── 头部跟随：开关在 header，参数在 folder 内 ──
    {
        id: 'perception:headFollow',
        kind: 'folder',
        label: 'motion.headFollow',
        icon: 'lucide:mouse-pointer-2',
        headerToggle: { bind: 'perception.headTrackingEnabled', onChange: withActivate },
        children: [
            {
                id: 'perception:headYawRange',
                kind: 'slider',
                label: 'perception.headYawRange',
                conflictHint: 'perception.gaze.head',
                control: {
                    bind: 'perception.headGazeMaxYaw',
                    min: 0,
                    max: 90,
                    step: 1,
                    onChange: withActivate,
                },
            },
            {
                id: 'perception:headPitchRange',
                kind: 'slider',
                label: 'perception.headPitchRange',
                control: {
                    bind: 'perception.headGazeMaxPitch',
                    min: 0,
                    max: 90,
                    step: 1,
                    onChange: withActivate,
                },
            },
        ],
    },
    // ── 眼部跟随 ──
    {
        id: 'perception:eyeFollow',
        kind: 'folder',
        label: 'motion.eyeFollow',
        icon: 'lucide:eye',
        headerToggle: { bind: 'perception.eyeTrackingEnabled', onChange: withActivate },
        children: [
            {
                id: 'perception:eyeYawRange',
                kind: 'slider',
                label: 'perception.eyeYawRange',
                control: {
                    bind: 'perception.eyeGazeMaxYaw',
                    min: 0,
                    max: 15,
                    step: 0.5,
                    onChange: withActivate,
                },
            },
            {
                id: 'perception:eyePitchRange',
                kind: 'slider',
                label: 'perception.eyePitchRange',
                control: {
                    bind: 'perception.eyeGazeMaxPitch',
                    min: 0,
                    max: 15,
                    step: 0.5,
                    onChange: withActivate,
                },
            },
            {
                id: 'perception:eyeSmooth',
                kind: 'slider',
                label: 'perception.eyeSmooth',
                control: {
                    bind: 'perception.eyeGazeSmooth',
                    min: 0,
                    max: 1,
                    step: 0.05,
                    onChange: withActivate,
                },
            },
        ],
    },
    // ── 呼吸 ──
    {
        id: 'perception:breath',
        kind: 'folder',
        label: 'motion.perceptionBreath',
        icon: 'lucide:wind',
        headerToggle: { bind: 'perception.breathEnabled', onChange: withSaveOnly },
        children: [
            {
                id: 'perception:breathFreq',
                kind: 'slider',
                label: 'perception.breathFreq',
                control: {
                    bind: 'perception.breathFrequency',
                    min: 0.1,
                    max: 1.0,
                    step: 0.05,
                    onChange: withActivate,
                },
            },
            {
                id: 'perception:breathAmp',
                kind: 'slider',
                label: 'perception.breathAmp',
                conflictHint: 'perception.breath',
                control: {
                    bind: 'perception.breathAmplitude',
                    min: 0,
                    max: 0.05,
                    step: 0.005,
                    onChange: withActivate,
                },
            },
        ],
    },
    // ── 眨眼 ──
    {
        id: 'perception:blink',
        kind: 'folder',
        label: 'motion.perceptionBlink',
        icon: 'lucide:eye',
        headerToggle: { bind: 'perception.blinkEnabled', onChange: withSaveOnly },
        children: [
            {
                id: 'perception:blinkFreq',
                kind: 'slider',
                label: 'perception.blinkFreq',
                control: {
                    bind: 'perception.blinkFrequency',
                    min: 0.05,
                    max: 0.5,
                    step: 0.05,
                    onChange: withActivate,
                },
            },
            {
                id: 'perception:blinkAmp',
                kind: 'slider',
                label: 'perception.blinkAmp',
                control: {
                    bind: 'perception.blinkAmplitude',
                    min: 0,
                    max: 1,
                    step: 0.05,
                    onChange: withActivate,
                },
            },
        ],
    },
    // ── 微表情 + 情绪（合并为一个 folder） ──
    {
        id: 'perception:microExpr',
        kind: 'folder',
        label: 'motion.microExpression',
        icon: 'lucide:smile',
        headerToggle: { bind: 'perception.microExpressionEnabled', onChange: withActivate },
        children: [
            {
                id: 'perception:emotion',
                kind: 'custom',
                renderCustom: (c) => {
                    const group = document.createElement('div');
                    group.className = 'preset-group';
                    const emotions = [
                        { value: 'neutral', label: 'motion.emotionNeutral' },
                        { value: 'happy', label: 'motion.emotionHappy' },
                        { value: 'sad', label: 'motion.emotionSad' },
                        { value: 'surprised', label: 'motion.emotionSurprised' },
                        { value: 'angry', label: 'motion.emotionAngry' },
                    ];
                    const current = getPerceptionState().emotion;
                    for (const e of emotions) {
                        addPresetChip(group, t(e.label), current === e.value, () => {
                            activatePerception();
                            setPerceptionState({
                                emotion: e.value as
                                    'neutral' | 'happy' | 'sad' | 'surprised' | 'angry',
                            });
                            triggerAutoSave();
                            refreshMotionMenu();
                        });
                    }
                    c.appendChild(group);
                },
            },
        ],
    },
    // ── 重心微动（[doc:adr-079] Phase 2，从 idle 躯干微晃迁入） ──
    {
        id: 'perception:balanceSway',
        kind: 'folder',
        label: 'motion.balanceSway',
        icon: 'lucide:move-3d',
        headerToggle: { bind: 'perception.balanceSwayEnabled', onChange: withActivate },
        children: [
            {
                id: 'perception:balanceSwayPeriod',
                kind: 'slider',
                label: 'motion.balanceSwayPeriod',
                control: {
                    bind: 'perception.balanceSwayPeriod',
                    min: 0.5,
                    max: 5.0,
                    step: 0.1,
                    onChange: withActivate,
                },
            },
            {
                id: 'perception:balanceSwayAmplitude',
                kind: 'slider',
                label: 'motion.balanceSwayAmplitude',
                conflictHint: 'perception.balance.center',
                control: {
                    bind: 'perception.balanceSwayAmplitude',
                    min: 0,
                    max: 2.0,
                    step: 0.05,
                    onChange: withActivate,
                },
            },
        ],
    },
    // ── Pin / Unpin 当前模型（[doc:adr-162] Phase 3；[doc:adr-166] 加 unpin 按钮） ──
    {
        id: 'perception:pinModel',
        kind: 'custom',
        renderCustom: (c) => {
            const wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;gap:8px;';
            const pinBtn = document.createElement('button');
            pinBtn.className = 'action-button';
            pinBtn.textContent = t('motion.pinModel');
            pinBtn.onclick = () => {
                if (focusedModelId) {
                    pinPerception(focusedModelId);
                    triggerAutoSave();
                    refreshMotionMenu();
                }
            };
            wrap.appendChild(pinBtn);
            const pinned = focusedModelId ? getPinnedModelIds().includes(focusedModelId) : false;
            if (pinned) {
                const unpinBtn = document.createElement('button');
                unpinBtn.className = 'action-button';
                unpinBtn.textContent = t('motion.unpinModel');
                unpinBtn.onclick = () => {
                    if (focusedModelId) {
                        unpinPerception(focusedModelId);
                        triggerAutoSave();
                        refreshMotionMenu();
                    }
                };
                wrap.appendChild(unpinBtn);
            }
            c.appendChild(wrap);
        },
    },
    // ── Lip-sync（已有 headerToggle 模式） ──
    {
        id: 'perception:lipsync',
        kind: 'folder',
        label: 'motion.lipSync',
        icon: 'lucide:mic',
        headerToggle: { bind: 'perception.lipSyncEnabled', onChange: withActivate },
        children: [
            {
                id: 'perception:lipSyncSens',
                kind: 'slider',
                label: 'motion.lipSyncSensitivity',
                control: {
                    bind: 'perception.lipSyncSensitivity',
                    min: 0,
                    max: 1,
                    step: 0.01,
                    onChange: withSaveOnly,
                },
            },
            {
                id: 'perception:lipSyncInt',
                kind: 'slider',
                label: 'motion.lipSyncIntensity',
                control: {
                    bind: 'perception.lipSyncIntensity',
                    min: 0,
                    max: 1,
                    step: 0.01,
                    onChange: withSaveOnly,
                },
            },
            {
                id: 'perception:lipSyncMulti',
                kind: 'toggle',
                label: 'motion.lipSyncMultiMorph',
                control: { bind: 'perception.lipSyncMultiMorphEnabled', onChange: withSaveOnly },
            },
        ],
    },
];

/** [doc:adr-163/adr-164/adr-166] 渲染指定模型的感知层骨骼冲突 banner */
export function updatePerceptionConflictBanner(el: HTMLElement, modelId: string | null): void {
    if (!modelId) {
        el.textContent = '';
        el.style.display = 'none';
        return;
    }
    const modules = [
        'perception.gaze.head',
        'perception.gaze.eye',
        'perception.breath',
        'perception.balance.center',
        'perception.balance.upper',
        'perception.balance.waist',
    ];
    const lines: string[] = [];
    for (const moduleId of modules) {
        const conflicts = getModuleConflicts(modelId, moduleId);
        if (conflicts.length > 0) {
            const detail = conflicts.map((c) => `${c.bone}←${c.byModule}`).join('、');
            lines.push(`⚠ ${moduleId}: ${detail}`);
        }
    }
    if (lines.length === 0) {
        el.textContent = '';
        el.style.display = 'none';
        return;
    }
    el.style.display = '';
    el.style.color = 'var(--warn, #e0a030)';
    el.style.whiteSpace = 'pre-line';
    el.textContent = `${t('motion.perceptionDegraded')} (${lines.length})\n` + lines.join('\n');
}

/**
 * [doc:adr-166 P2-3] 渲染「焦点 + 全部 pinned」模型的感知层冲突 banner。
 * 复用单模型 `updatePerceptionConflictBanner`（受测），对去重后的模型集逐个渲染子 banner。
 * 单模型场景（仅焦点、无 pinned）输出与旧版一致；多模型时每段加 modelId 前缀以区分归属。
 */
export function renderPerceptionConflictBanners(container: HTMLElement): void {
    const ids: string[] = [];
    if (focusedModelId) ids.push(focusedModelId);
    for (const pid of getPinnedModelIds()) {
        if (!ids.includes(pid)) ids.push(pid);
    }
    const multi = ids.length > 1;
    for (const id of ids) {
        const sub = document.createElement('div');
        updatePerceptionConflictBanner(sub, id);
        if (sub.style.display === 'none') continue; // 该模型无冲突则跳过
        if (multi) {
            const head = document.createElement('div');
            head.style.cssText = 'font-weight:600;opacity:0.75;margin-top:4px;';
            head.textContent = `▸ ${id}`;
            container.appendChild(head);
        }
        container.appendChild(sub);
    }
}

export function buildGazeTrackingLevel(): PopupLevel {
    return {
        label: t('motion.gazeTracking'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const banner = document.createElement('div');
                banner.style.cssText = 'padding:2px 14px 8px;font-size:11px;line-height:1.5;';
                renderPerceptionConflictBanners(banner);
                c.appendChild(banner);
                renderMenu(gazeSchema, c);
            });
        },
    };
}
