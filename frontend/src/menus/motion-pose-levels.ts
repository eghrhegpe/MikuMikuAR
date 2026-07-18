// [doc:architecture] Pose Studio Levels — 姿态工作室/拍照模式 UI
// 职责: 独立 Pose Studio 面板，聚合构图辅助 + DOF + T-pose/A-pose + 多角度截图 + 水印
// 路由: motion-popup.ts → motionOnFolderEnter → 'motion:poseStudio'

import {
    setStatus,
    PopupLevel,
    cardContainer,
    modelRegistry,
    focusedModelId,
    dom,
    uiState,
    setUIState,
    mmdRuntime,
    isPlaying,
    setIsPlaying,
} from '../core/config';
import { addToggleRow, addSliderRow, addEmptyRow } from '../core/ui-helpers';
import { waitForFrame, logWarn } from '../core/utils';
import { getMotionMenu } from './motion-popup';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { setRenderState, getRenderState } from '../scene/render/renderer';
import { getGuideMode, setGuideMode } from '../scene/pose/composition-guide';
import { generatePoseVmd } from '../motion-algos/pose-preset';
import { loadVMDMotion, stopVMD } from '../scene/scene';
import { getAllPresets, applyCameraPreset, CameraAnglePreset } from '../scene/pose/camera-angle';
import { getWatermarkConfig, setWatermarkConfig, applyWatermark } from '../scene/pose/watermark';
import { screenshotCurrent } from './scene-menu';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

// ======== 根级入口 ========

let _batchRunning = false; // [doc:audit] 并发锁，防止多次点击触发批量截图竞态

function buildPoseStudioSchema(): MenuNode[] {
    const modelId = focusedModelId;
    if (!modelId || !modelRegistry.get(modelId)?.mmdModel) {
        return [
            {
                id: 'pose:empty',
                kind: 'custom',
                renderCustom: (c) => {
                    addEmptyRow(c, t('motion.poseStudio.noModel'));
                },
            },
        ];
    }

    const menu = getMotionMenu();
    const renderState = getRenderState();
    const wmConfig = getWatermarkConfig();

    return [
        // 卡片 1：构图辅助线
        {
            id: 'pose:composition',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const title = document.createElement('div');
                    title.className = 'card-title';
                    title.textContent = t('motion.poseStudio.composition');
                    inner.appendChild(title);

                    const modes: Array<{
                        key: 'off' | 'ruleOfThirds' | 'goldenRatio' | 'diagonal';
                        label: string;
                    }> = [
                        { key: 'off', label: t('motion.poseStudio.off') },
                        { key: 'ruleOfThirds', label: t('motion.poseStudio.ruleOfThirds') },
                        { key: 'goldenRatio', label: t('motion.poseStudio.goldenRatio') },
                        { key: 'diagonal', label: t('motion.poseStudio.diagonal') },
                    ];

                    const currentMode = getGuideMode();
                    const btnGroup = document.createElement('div');
                    btnGroup.style.cssText =
                        'display:flex;flex-wrap:wrap;gap:4px;padding:4px 14px 8px;';
                    for (const m of modes) {
                        const btn = document.createElement('button');
                        btn.className = 'preset-chip';
                        btn.textContent = m.label;
                        // 选中态走 .active class（与灯光列表等场景统一，样式由 app.css .preset-chip.active 控制）
                        btn.classList.toggle('active', m.key === currentMode);
                        btn.addEventListener('click', () => {
                            setGuideMode(m.key);
                            menu?.reRender();
                        });
                        btnGroup.appendChild(btn);
                    }
                    inner.appendChild(btnGroup);
                });
            },
        },
        // 卡片 2：姿态预设
        {
            id: 'pose:presets',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const title = document.createElement('div');
                    title.className = 'card-title';
                    title.textContent = t('motion.poseStudio.posePreset');
                    inner.appendChild(title);

                    const btnGroup = document.createElement('div');
                    btnGroup.className = 'btn-group';

                    const poseTypes: Array<{ key: 'tpose' | 'apose' | 'rest'; label: string }> = [
                        { key: 'tpose', label: t('motion.poseStudio.tPose') },
                        { key: 'apose', label: t('motion.poseStudio.aPose') },
                        { key: 'rest', label: t('motion.poseStudio.rest') },
                    ];

                    for (const pt of poseTypes) {
                        const btn = document.createElement('button');
                        btn.className = 'preset-chip';
                        btn.textContent = pt.label;
                        btn.addEventListener('click', async () => {
                            if (pt.key === 'rest') {
                                stopVMD(modelId);
                                setStatus(t('motion.poseStudio.restApplied'), true);
                                return;
                            }
                            const vmdData = generatePoseVmd(pt.key);
                            stopVMD(modelId);
                            try {
                                await loadVMDMotion(
                                    vmdData,
                                    pt.key === 'tpose' ? 'T-Pose' : 'A-Pose',
                                    modelId
                                );
                                if (mmdRuntime && isPlaying) {
                                    mmdRuntime.pauseAnimation();
                                    setIsPlaying(false);
                                }
                                setStatus(
                                    t('motion.poseStudio.poseApplied', { pose: pt.label }),
                                    true
                                );
                            } catch (err) {
                                logWarn('pose', 'apply preset failed:', err);
                                setStatus(t('motion.poseStudio.poseFailed'), false);
                            }
                        });
                        btnGroup.appendChild(btn);
                    }
                    inner.appendChild(btnGroup);
                });
            },
        },
        // 卡片 3：景深控制
        {
            id: 'pose:dof',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const title = document.createElement('div');
                    title.className = 'card-title';
                    title.textContent = t('motion.poseStudio.depthOfField');
                    inner.appendChild(title);

                    addSliderRow(
                        inner,
                        t('motion.poseStudio.dofAmount'),
                        renderState.dofAperture,
                        0,
                        1,
                        0.05,
                        (v) => {
                            setRenderState({ dofEnabled: v > 0, dofAperture: v });
                        },
                        undefined,
                        undefined,
                        { bind: () => getRenderState().dofAperture }
                    );
                });
            },
        },
        // 卡片 4：相机角度预设 + 截图
        {
            id: 'pose:camera',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const title = document.createElement('div');
                    title.className = 'card-title';
                    title.textContent = t('motion.poseStudio.cameraPresets');
                    inner.appendChild(title);

                    const presets = getAllPresets();
                    const btnGroup = document.createElement('div');
                    btnGroup.style.cssText =
                        'display:flex;flex-wrap:wrap;gap:4px;padding:4px 14px;';
                    for (const preset of presets) {
                        const btn = document.createElement('button');
                        btn.className = 'preset-chip';
                        btn.textContent = preset.name;
                        btn.title = preset.description;
                        btn.addEventListener('click', () => {
                            applyCameraPreset(preset);
                            setStatus(
                                t('motion.poseStudio.cameraApplied', { name: preset.name }),
                                true
                            );
                            menu?.reRender();
                        });
                        btnGroup.appendChild(btn);
                    }
                    inner.appendChild(btnGroup);

                    const batchRow = document.createElement('div');
                    batchRow.style.cssText = 'display:flex;gap:6px;padding:8px 14px;';

                    const singleBtn = document.createElement('button');
                    singleBtn.className = 'preset-chip';
                    singleBtn.textContent = '📷 ' + t('motion.poseStudio.screenshot');
                    singleBtn.addEventListener('click', () => {
                        screenshotCurrent();
                    });
                    batchRow.appendChild(singleBtn);

                    const batchBtn = document.createElement('button');
                    batchBtn.className = 'preset-chip';
                    batchBtn.textContent = '📸 ' + t('motion.poseStudio.batchExport');
                    batchBtn.addEventListener('click', async () => {
                        await _batchScreenshot(presets, modelId);
                    });
                    batchRow.appendChild(batchBtn);

                    inner.appendChild(batchRow);

                    const progressEl = document.createElement('div');
                    progressEl.id = 'pose-batch-progress';
                    progressEl.style.cssText =
                        'font-size:11px;color:var(--text-dim);padding:0 14px 8px;display:none;';
                    inner.appendChild(progressEl);
                });
            },
        },
        // 卡片 5：水印配置
        {
            id: 'pose:watermark',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const title = document.createElement('div');
                    title.className = 'card-title';
                    title.textContent = t('motion.poseStudio.watermark');
                    inner.appendChild(title);

                    addToggleRow(
                        inner,
                        t('motion.poseStudio.watermarkToggle'),
                        wmConfig.enabled,
                        (v) => {
                            setWatermarkConfig({ enabled: v });
                            menu?.reRender();
                        }
                    );

                    if (wmConfig.enabled) {
                        addSliderRow(
                            inner,
                            t('motion.poseStudio.watermarkOpacity'),
                            wmConfig.opacity,
                            0,
                            1,
                            0.1,
                            (v) => {
                                setWatermarkConfig({ opacity: v });
                            }
                        );
                    }
                });
            },
        },
    ];
}

export function buildPoseStudioLevel(): PopupLevel {
    return {
        label: t('motion.poseStudio.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildPoseStudioSchema(), container);
        },
    };
}

// ======== 内部函数 ========

/** 批量截图：遍历所有预设角度，截图后保存 */
async function _batchScreenshot(presets: CameraAnglePreset[], modelId: string): Promise<void> {
    if (_batchRunning) return; // 并发锁
    _batchRunning = true;
    const progressEl = document.getElementById('pose-batch-progress');
    try {
        if (progressEl) {
            progressEl.style.display = 'block';
        }

        // 获取原相机状态
        const { getOrbitParams, setOrbitParams } = await import('../scene/camera/camera');
        const origParams = getOrbitParams();
        const { scene } = await import('../scene/scene');
        const cam = scene.activeCamera;
        const origAlpha = cam instanceof ArcRotateCamera ? cam.alpha : 0;
        let saved = 0;

        const inst = modelRegistry.get(modelId);
        const baseName = inst?.name ?? 'model';

        for (let i = 0; i < presets.length; i++) {
            const preset = presets[i];
            if (progressEl) {
                progressEl.textContent = `${t('motion.poseStudio.batchProgress')} ${i + 1}/${presets.length}: ${preset.name}`;
            }

            // 切换相机角度
            const beta = Math.PI / 2 - (preset.elevation * Math.PI) / 180;
            setOrbitParams({ beta, distance: preset.distance });
            if (cam instanceof ArcRotateCamera) {
                cam.alpha = (preset.azimuth * Math.PI) / 180;
            }

            // 等待渲染完成
            await waitForFrame();
            await waitForFrame();
            await waitForFrame();

            // 截图
            const fmt = uiState.screenshotFormat ?? 'image/png';
            const q = uiState.screenshotQuality ?? 0.9;
            let base64 = dom.canvas.toDataURL(fmt, q).replace(/^data:image\/\w+;base64,/, '');

            // 水印
            base64 = await applyWatermark(base64, fmt, q);

            // 保存
            const { SaveScreenshot, SelectDir } = await import('../core/wails-bindings');
            let dir = uiState.screenshotDir;
            if (!dir) {
                dir = await SelectDir();
                if (!dir) {
                    break;
                }
                uiState.screenshotDir = dir;
                setUIState({ screenshotDir: dir });
            }

            const ts = Date.now();
            const ext = fmt === 'image/jpeg' ? 'jpg' : fmt === 'image/webp' ? 'webp' : 'png';
            const filename = `${baseName}_${preset.name}_${ts}.${ext}`;
            try {
                await SaveScreenshot(dir, filename, base64);
                saved++;
            } catch (err) {
                logWarn('pose', `batch save failed: ${filename}`, err);
            }
        }

        // 恢复原相机角度
        setOrbitParams(origParams);
        if (cam instanceof ArcRotateCamera) {
            cam.alpha = origAlpha;
        }
        setStatus(t('motion.poseStudio.batchDone', { saved }), true);
    } finally {
        if (progressEl) {
            progressEl.style.display = 'none';
        }
        _batchRunning = false;
    }
}
