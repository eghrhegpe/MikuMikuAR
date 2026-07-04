// [doc:architecture] Camera Levels — 相机参数弹窗层级
// 从 scene-menu.ts 迁移到 motion-popup.ts

import { setStatus, cardContainer } from '../core/config';
import type { PopupLevel } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import { addSliderRow, addToggleRow, addModeSlider } from '../core/ui-helpers';
import {
    switchCameraMode,
    getCameraMode,
    hasCameraVmd,
    clearCameraVmd,
    getOrbitParams,
    setOrbitParams,
    getFreeflyParams,
    setFreeflyParams,
    getConcertParams,
    setConcertParams,
    getConcertPaused,
    setConcertPaused,
    type CameraMode,
} from '../scene/camera/camera';
import { triggerAutoSave } from '../scene/scene';
import { SelectVMDMotion } from '../core/wails-bindings';
import { loadCameraVmdFromPath } from '../scene/scene';
import { getMotionMenu } from './motion-popup';

let cameraExpandedMode: CameraMode | null = null;

function refreshCameraLevel(): void {
    const menu = getMotionMenu();
    if (menu) {
        menu.reRender();
    }
}

export function buildCameraLevel(): PopupLevel {
    return {
        label: '相机模式',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const currentMode = getCameraMode();
            const vmdLoaded = hasCameraVmd();

            cardContainer(container, (c) => {
                const modeOptions: Array<{ value: string; label: string }> = [
                    { value: 'orbit', label: '轨道' },
                    { value: 'freefly', label: '自由飞行' },
                    { value: 'concert', label: '演唱会' },
                    { value: 'oneshot', label: '单拍' },
                ];
                if (vmdLoaded) {
                    modeOptions.push({ value: 'vmd', label: 'VMD 相机' });
                }

                addModeSlider(
                    c,
                    '相机模式',
                    modeOptions.map((o) => ({ value: o.value, label: o.label })),
                    currentMode,
                    (v) => {
                        if (v === currentMode) {
                            cameraExpandedMode = cameraExpandedMode ? null : currentMode;
                        } else {
                            switchCameraMode(v as CameraMode);
                            cameraExpandedMode = v === 'oneshot' ? null : v as CameraMode;
                        }
                        refreshCameraLevel();
                    },
                    'lucide:camera'
                );

                const paramsContainer = document.createElement('div');
                paramsContainer.className = 'cs-params';
                const modeToExpand = cameraExpandedMode ?? currentMode;
                if (modeToExpand !== 'oneshot' && modeToExpand !== 'vmd') {
                    if (modeToExpand === 'orbit') renderOrbitParams(paramsContainer);
                    else if (modeToExpand === 'freefly') renderFreeflyParams(paramsContainer);
                    else if (modeToExpand === 'concert') renderConcertParams(paramsContainer);
                    c.appendChild(paramsContainer);
                }

                if (vmdLoaded) {
                    const clearRow = document.createElement('div');
                    clearRow.className = 'slide-item';
                    clearRow.style.marginTop = '6px';
                    const clearIcon = document.createElement('span');
                    clearIcon.className = 'slide-icon';
                    const clearIconEl = createIconifyIcon('lucide:trash-2');
                    if (clearIconEl) {
                        clearIcon.appendChild(clearIconEl);
                    }
                    clearRow.appendChild(clearIcon);
                    const clearLabel = document.createElement('span');
                    clearLabel.className = 'slide-label';
                    clearLabel.textContent = '清除相机 VMD';
                    clearRow.appendChild(clearLabel);
                    clearRow.addEventListener('click', () => {
                        clearCameraVmd();
                        refreshCameraLevel();
                        setStatus('✓ 已清除相机 VMD', true);
                    });
                    c.appendChild(clearRow);
                }

                const loadRow = document.createElement('div');
                loadRow.className = 'slide-item';
                if (!vmdLoaded) {
                    loadRow.style.marginTop = '6px';
                }
                const loadIcon = document.createElement('span');
                loadIcon.className = 'slide-icon';
                const loadIconEl = createIconifyIcon('lucide:upload');
                if (loadIconEl) {
                    loadIcon.appendChild(loadIconEl);
                }
                loadRow.appendChild(loadIcon);
                const loadLabel = document.createElement('span');
                loadLabel.className = 'slide-label';
                loadLabel.textContent = '加载相机 VMD';
                loadRow.appendChild(loadLabel);
                loadRow.addEventListener('click', () => {
                    (async () => {
                        try {
                            const path = await SelectVMDMotion();
                            if (!path) {
                                return;
                            }
                            await loadCameraVmdFromPath(path);
                            refreshCameraLevel();
                        } catch (err) {
                            console.error('Load camera VMD failed:', err);
                            setStatus('✗ 相机 VMD 加载失败', false);
                        }
                    })();
                });
                c.appendChild(loadRow);
            });
        },
        reRenderCustom: (container) => {
            // 只更新 mode slider 的值
            const mode = getCameraMode();
            const labels: Record<string, string> = { orbit: '轨道', freefly: '自由飞行', concert: '演唱会', oneshot: '单拍', vmd: 'VMD 相机' };
            const firstCard = container.querySelector('.card-container');
            if (!firstCard) return;
            const modeSlider = firstCard.querySelector('.cs-row:first-child');
            if (!modeSlider) return;
            const valEl = modeSlider.querySelector('.cs-value');
            if (valEl) valEl.textContent = labels[mode] || mode;
            const modeOptions = hasCameraVmd() ? ['orbit', 'freefly', 'concert', 'oneshot', 'vmd'] : ['orbit', 'freefly', 'concert', 'oneshot'];
            const idx = modeOptions.indexOf(mode);
            if (idx >= 0) {
                const fill = modeSlider.querySelector('.cs-fill') as HTMLElement | null;
                const thumb = modeSlider.querySelector('.cs-thumb') as HTMLElement | null;
                const total = modeOptions.length;
                const pct = total > 1 ? (idx / (total - 1)) * 100 : 0;
                if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
                if (thumb) thumb.style.left = Math.max(0, Math.min(100, pct)) + '%';
            }
        },
    };
}

/** Build a parameter editing submenu for the given camera mode. */
export function buildCameraParamsLevel(mode: CameraMode): PopupLevel {
    return {
        label:
            mode === 'orbit'
                ? '轨道设置'
                : mode === 'freefly'
                  ? '自由飞行设置'
                  : mode === 'concert'
                    ? '演唱会设置'
                    : '相机设置',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                if (mode === 'orbit') {
                    renderOrbitParams(c);
                } else if (mode === 'freefly') {
                    renderFreeflyParams(c);
                } else if (mode === 'concert') {
                    renderConcertParams(c);
                }
            });
        },
    };
}

function renderOrbitParams(container: HTMLElement): void {
    const p = getOrbitParams();
    addSliderRow(
        container,
        '目标高度',
        p.targetHeight,
        0,
        30,
        0.5,
        (v) => {
            setOrbitParams({ targetHeight: v });
            triggerAutoSave();
        },
        'lucide:maximize'
    );
    addSliderRow(
        container,
        '距离',
        p.distance,
        2,
        50,
        0.5,
        (v) => {
            setOrbitParams({ distance: v });
            triggerAutoSave();
        },
        'lucide:zoom-in'
    );
    addSliderRow(
        container,
        '俯仰角',
        p.beta,
        0.1,
        Math.PI - 0.1,
        0.05,
        (v) => {
            setOrbitParams({ beta: v });
            triggerAutoSave();
        },
        'lucide:arrow-up-down'
    );
}

function renderFreeflyParams(container: HTMLElement): void {
    const p = getFreeflyParams();
    addSliderRow(
        container,
        '移动速度',
        p.speed,
        0.1,
        5,
        0.1,
        (v) => {
            setFreeflyParams({ speed: v });
            triggerAutoSave();
        },
        'lucide:move'
    );
    addSliderRow(
        container,
        '鼠标灵敏度',
        p.angularSensibility,
        500,
        5000,
        100,
        (v) => {
            setFreeflyParams({ angularSensibility: v });
            triggerAutoSave();
        },
        'lucide:mouse-pointer'
    );
}

function renderConcertParams(container: HTMLElement): void {
    const p = getConcertParams();
    addSliderRow(
        container,
        '轨道半径',
        p.radius,
        2,
        50,
        0.5,
        (v) => {
            setConcertParams({ radius: v });
            triggerAutoSave();
        },
        'lucide:circle'
    );
    addSliderRow(
        container,
        '目标高度',
        p.height,
        0,
        30,
        0.5,
        (v) => {
            setConcertParams({ height: v });
            triggerAutoSave();
        },
        'lucide:maximize'
    );
    addSliderRow(
        container,
        '旋转速度',
        p.speed,
        0,
        5,
        0.1,
        (v) => {
            setConcertParams({ speed: v });
            triggerAutoSave();
        },
        'lucide:rotate-cw'
    );
    addToggleRow(
        container,
        getConcertPaused() ? '已暂停' : '旋转中',
        !getConcertPaused(),
        (enabled) => {
            setConcertPaused(!enabled);
            triggerAutoSave();
        }
    );
}
