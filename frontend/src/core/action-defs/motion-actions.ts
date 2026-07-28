import { registerAction } from '../action-registry';
import { setLipSyncEnabled, getLipSyncState } from '../../scene/motion/lipsync-bridge';
import {
    clearAllSceneMotions,
    addSceneMotion,
    replaceDefaultMotion,
} from '../../scene/motion/motion-intent';
import { pushUndoSnapshot, offerSceneUndoAndRefresh } from '../../scene/scene-serialize';
import { updatePlaybackUI } from '../../scene/motion/playback';
import { triggerAutoSave } from '../utils';
import { feedbackInfo, feedbackStatus } from '../feedback';
import { showInfoToast } from '../toast';
import { isPlaying, setIsPlaying, setAutoLoop } from '../playback-state';
import { mmdRuntime } from '../scene-state';
import { getMotionMenu, refreshMotionRoot } from '../../menus/motion-popup';
import { buildMotionRootItems, importExternalAnimation } from '../../menus/motion-root-ui';
import {
    handleModelAction,
    resetFocusedLayerId,
    buildActionBindingLevel,
} from '../../menus/motion-binding-ui';
import { buildMotionDetailLevel } from '../../menus/motion-detail-ui';
import { setProcMotionMode, regenerateProcMotion } from '../../scene/motion/proc-motion-bridge';
import type { ProcMotionMode } from '../../motion-algos/procedural-motion';
import { loadManager } from '../load-manager';
import { loadVPDPose } from '../../scene/scene';
import { getAudioName } from '../../outfit/audio';
import { t } from '../i18n/t';
import { logWarn } from '../logger';
import { stackRegistry, getBrowseDir } from '../config';

export function registerMotionActions(): void {
    registerAction({
        id: 'motion:lipsync:toggle',
        label: '切换口型同步',
        domain: 'motion',
        icon: 'lucide:languages',
        params: [],
        destructive: false,
        execute: async () => {
            setLipSyncEnabled(!getLipSyncState().enabled);
        },
    });

    registerAction({
        id: 'motion:clear-all',
        label: '清除全部动作',
        domain: 'motion',
        icon: 'lucide:eraser',
        params: [],
        destructive: true,
        execute: async () => {
            const snap = pushUndoSnapshot();
            clearAllSceneMotions();
            if (isPlaying && mmdRuntime) {
                mmdRuntime.pauseAnimation();
                setIsPlaying(false);
            }
            updatePlaybackUI();
            refreshMotionRoot();
            triggerAutoSave();
            feedbackInfo('motion.motionCleared', undefined);
            offerSceneUndoAndRefresh('motion.motionCleared', snap, () => {
                refreshMotionRoot();
            });
        },
    });

    registerAction({
        id: 'motion:retarget:mixamo',
        label: '导入 Mixamo 动画',
        domain: 'motion',
        icon: 'lucide:upload',
        params: [],
        destructive: false,
        execute: async () => {
            importExternalAnimation('mixamo');
        },
    });

    registerAction({
        id: 'motion:retarget:vrm',
        label: '导入 VRM 动画',
        domain: 'motion',
        icon: 'lucide:upload',
        params: [],
        destructive: false,
        execute: async () => {
            importExternalAnimation('vrm');
        },
    });

    registerAction({
        id: 'motion:retarget:custom',
        label: '导入自定义动画',
        domain: 'motion',
        icon: 'lucide:upload',
        params: [],
        destructive: false,
        execute: async () => {
            importExternalAnimation('custom');
        },
    });

    registerAction({
        id: 'motion:model:pause',
        label: '暂停/继续播放',
        domain: 'motion',
        icon: 'lucide:play',
        params: [{ name: 'modelId', type: 'entity' }],
        destructive: false,
        execute: async (p) => {
            await handleModelAction('pause', p.modelId as string);
        },
    });

    registerAction({
        id: 'motion:model:reset',
        label: '重置动画',
        domain: 'motion',
        icon: 'lucide:refresh-cw',
        params: [{ name: 'modelId', type: 'entity' }],
        destructive: true,
        execute: async (p) => {
            await handleModelAction('reset', p.modelId as string);
        },
    });

    registerAction({
        id: 'motion:model:pose',
        label: '打开展示库',
        domain: 'motion',
        icon: 'lucide:palette',
        params: [{ name: 'modelId', type: 'entity' }],
        destructive: false,
        execute: async (p) => {
            await handleModelAction('pose', p.modelId as string);
        },
    });

    registerAction({
        id: 'motion:model:loop',
        label: '切换循环播放',
        domain: 'motion',
        icon: 'lucide:repeat',
        params: [{ name: 'modelId', type: 'entity' }],
        destructive: false,
        execute: async (p) => {
            await handleModelAction('loop', p.modelId as string);
        },
    });

    registerAction({
        id: 'motion:procmotion:set-mode',
        label: '设置程序化动作模式',
        domain: 'motion',
        icon: 'lucide:bot',
        params: [
            {
                name: 'mode',
                type: 'enum',
                enum: ['idle', 'walking', 'running', 'dancing', 'breathing'] as const,
            },
        ],
        destructive: false,
        execute: async (p) => {
            setProcMotionMode(p.mode as ProcMotionMode);
            regenerateProcMotion();
        },
    });

    // ── 模型格式分支（文件选择回调） ──

    registerAction({
        id: 'motion:load-camera-vmd',
        label: '加载相机 VMD',
        domain: 'motion',
        icon: 'lucide:video',
        params: [{ name: 'path', type: 'string' }],
        destructive: false,
        execute: async (p) => {
            await loadManager.load({ kind: 'camera-vmd', path: p.path as string });
        },
    });

    registerAction({
        id: 'motion:add-scene-vmd',
        label: '添加场景 VMD',
        domain: 'motion',
        icon: 'lucide:film',
        params: [
            { name: 'path', type: 'string' },
            { name: 'name', type: 'string' },
        ],
        destructive: false,
        execute: async (p) => {
            addSceneMotion({
                vmdPath: p.path as string,
                vmdName:
                    (p.name as string) ||
                    (p.path as string)
                        .split(/[/\\]/)
                        .pop()
                        ?.replace(/\.\w+$/, '') ||
                    '',
                vmdLayers: [],
                source: 'vmd',
            });
        },
    });

    registerAction({
        id: 'motion:load-audio',
        label: '加载音频',
        domain: 'motion',
        icon: 'lucide:music',
        params: [{ name: 'path', type: 'string' }],
        destructive: false,
        execute: async (p) => {
            loadManager.load({ kind: 'audio', path: p.path as string });
            showInfoToast(t('motion.musicLoaded', { name: getAudioName() }));
        },
    });

    registerAction({
        id: 'motion:load-vpd',
        label: '加载 VPD 姿势',
        domain: 'motion',
        icon: 'lucide:figma',
        params: [{ name: 'path', type: 'string' }],
        destructive: false,
        execute: async (p) => {
            loadVPDPose(p.path as string);
        },
    });

    // ── 导航分支 ──

    registerAction({
        id: 'motion:open-binding',
        label: '打开动作绑定面板',
        domain: 'motion',
        icon: 'lucide:link',
        params: [{ name: 'modelId', type: 'entity' }],
        destructive: false,
        execute: async (p) => {
            resetFocusedLayerId();
            const id = p.modelId as string;
            const lvl = buildActionBindingLevel(id);
            lvl.itemBuilder = () => buildActionBindingLevel(id).items;
            getMotionMenu()?.push(lvl);
        },
    });

    registerAction({
        id: 'motion:browse-music',
        label: '浏览音频库',
        domain: 'motion',
        icon: 'lucide:library',
        params: [],
        destructive: false,
        execute: async () => {
            const level = stackRegistry.buildLevel!(
                getBrowseDir('audio'),
                t('motion.musicLibrary'),
                (m) => m.format === 'audio',
                getMotionMenu() ?? undefined
            );
            getMotionMenu()?.push(level);
        },
    });

    registerAction({
        id: 'motion:browse-scene-motions',
        label: '浏览场景动作库',
        domain: 'motion',
        icon: 'lucide:folder-open',
        params: [],
        destructive: false,
        execute: async () => {
            resetFocusedLayerId();
            const level = stackRegistry.buildLevel!(
                getBrowseDir('vmd'),
                t('motion.browseMotionLibrary'),
                (m) => m.format === 'vmd',
                getMotionMenu() ?? undefined,
                undefined,
                {
                    mode: 'stay',
                    onVmdPick: (path: string, name: string) => {
                        const vmdName = name.replace(/\.vmd$/i, '');
                        addSceneMotion({ vmdPath: path, vmdName, vmdLayers: [], source: 'vmd' });
                        const menu = getMotionMenu();
                        if (menu) {
                            const root = menu.getLevel(0);
                            if (root) root.items = buildMotionRootItems();
                        }
                    },
                    onVmdReplace: (path: string, name: string) => {
                        const vmdName = name.replace(/\.vmd$/i, '');
                        replaceDefaultMotion({
                            vmdPath: path,
                            vmdName,
                            vmdLayers: [],
                            source: 'vmd',
                        });
                        const menu = getMotionMenu();
                        if (menu) {
                            const root = menu.getLevel(0);
                            if (root) root.items = buildMotionRootItems();
                        }
                    },
                }
            );
            getMotionMenu()?.push(level);
        },
    });

    registerAction({
        id: 'motion:open-detail',
        label: '打开动作详情',
        domain: 'motion',
        icon: 'lucide:info',
        params: [{ name: 'sceneMotionId', type: 'string' }],
        destructive: false,
        execute: async (p) => {
            const sceneMotionId = p.sceneMotionId as string | undefined;
            const lvl = buildMotionDetailLevel(sceneMotionId);
            lvl.itemBuilder = () => [];
            getMotionMenu()?.push(lvl);
        },
    });
}
