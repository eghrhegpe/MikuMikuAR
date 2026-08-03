import { registerAction } from '../action-registry';
import { triggerAutoSave } from '../config';
import { feedbackInfo } from '../feedback';
import { showInfoToast } from '../toast';
import { showConfirm } from '../dialog';
import { isPlaying, setIsPlaying } from '../playback-state';
import { mmdRuntime } from '../scene-state';
import { t } from '../i18n/t';
import { loadManager } from '../load-manager';
// [doc:adr-238] 跨层实现经 scene-action-bridge / ui-action-bridge 调用
import { getSceneAction } from '../scene-action-bridge';
import { getUiAction } from '../ui-action-bridge';

/** [doc:adr-238] 按名称模糊搜索场景内已加载模型（经桥，entity resolve 消费） */
function findSceneModelByName(name: string): Promise<unknown> {
    return getSceneAction('findSceneModelByName')?.(name) ?? Promise.resolve(null);
}

/** [doc:adr-238] 菜单栈访问统一经 getUiAction('getMotionMenu')，不再直接 import menus */
function _getMotionMenu(): { push?: (l: unknown) => void; getLevel?: (i: number) => unknown } | null {
    return (getUiAction('getMotionMenu')?.() ?? null) as ReturnType<typeof _getMotionMenu>;
}

/** [doc:adr-238] 菜单浏览层级构建经 ui-action-bridge（library-core 注册），不再直接 import menus */
function _buildLevel(
    dir: string,
    label: string,
    filter?: (m: { format?: string }) => boolean,
    targetStack?: unknown,
    extraFolders?: { label: string; path: string }[],
    outcome?: Record<string, unknown>
): unknown {
    return getUiAction('buildBrowseLevel')?.({
        dir,
        label,
        filter,
        targetStack,
        extraFolders,
        outcome,
    });
}

export function registerMotionActions(): void {
    registerAction({
        id: 'motion:lipsync:toggle',
        label: 'ai.actions.motion.lipsync.toggle',
        domain: 'motion',
        icon: 'lucide:languages',
        params: [],
        destructive: false,
        execute: async () => {
            getSceneAction('setLipSyncEnabled')?.(!getSceneAction('getLipSyncState')?.().enabled);
        },
    });

    registerAction({
        id: 'motion:clear-all',
        label: 'ai.actions.motion.clearAll',
        domain: 'motion',
        icon: 'lucide:eraser',
        params: [],
        destructive: true,
        execute: async () => {
            if (!(await showConfirm(t('motion.clearAllConfirm')))) {
                return;
            }
            const snap = getSceneAction('pushUndoSnapshot')?.();
            getSceneAction('clearAllSceneMotions')?.();
            if (isPlaying && mmdRuntime) {
                mmdRuntime.pauseAnimation();
                setIsPlaying(false);
            }
            getSceneAction('updatePlaybackUI')?.();
            getUiAction('refreshMotionRoot')?.();
            triggerAutoSave();
            feedbackInfo('motion.motionCleared', undefined);
            getSceneAction('offerSceneUndoAndRefresh')?.('motion.motionCleared', snap, () => {
                getUiAction('refreshMotionRoot')?.();
            });
        },
    });

    registerAction({
        id: 'motion:retarget:mixamo',
        label: 'ai.actions.motion.retarget.mixamo',
        domain: 'motion',
        icon: 'lucide:upload',
        params: [],
        destructive: false,
        uiOnly: true,
        execute: async () => {
            getUiAction('importExternalAnimation')?.('mixamo');
        },
    });

    registerAction({
        id: 'motion:retarget:vrm',
        label: 'ai.actions.motion.retarget.vrm',
        domain: 'motion',
        icon: 'lucide:upload',
        params: [],
        destructive: false,
        uiOnly: true,
        execute: async () => {
            getUiAction('importExternalAnimation')?.('vrm');
        },
    });

    registerAction({
        id: 'motion:retarget:custom',
        label: 'ai.actions.motion.retarget.custom',
        domain: 'motion',
        icon: 'lucide:upload',
        params: [],
        destructive: false,
        uiOnly: true,
        execute: async () => {
            getUiAction('importExternalAnimation')?.('custom');
        },
    });

    registerAction({
        id: 'motion:model:pause',
        label: 'ai.actions.motion.model.pause',
        domain: 'motion',
        icon: 'lucide:play',
        params: [{ name: 'modelId', type: 'entity', resolve: findSceneModelByName }],
        destructive: false,
        execute: async (p) => {
            await getUiAction('handleModelAction')?.('pause', p.modelId as string);
        },
    });

    registerAction({
        id: 'motion:model:reset',
        label: 'ai.actions.motion.model.reset',
        domain: 'motion',
        icon: 'lucide:refresh-cw',
        params: [{ name: 'modelId', type: 'entity', resolve: findSceneModelByName }],
        destructive: true,
        execute: async (p) => {
            await getUiAction('handleModelAction')?.('reset', p.modelId as string);
        },
    });

    registerAction({
        id: 'motion:model:pose',
        label: 'ai.actions.motion.model.pose',
        domain: 'motion',
        icon: 'lucide:palette',
        params: [{ name: 'modelId', type: 'entity', resolve: findSceneModelByName }],
        destructive: false,
        execute: async (p) => {
            await getUiAction('handleModelAction')?.('pose', p.modelId as string);
        },
    });

    registerAction({
        id: 'motion:model:loop',
        label: 'ai.actions.motion.model.loop',
        domain: 'motion',
        icon: 'lucide:repeat',
        params: [{ name: 'modelId', type: 'entity', resolve: findSceneModelByName }],
        destructive: false,
        execute: async (p) => {
            await getUiAction('handleModelAction')?.('loop', p.modelId as string);
        },
    });

    registerAction({
        id: 'motion:procmotion:set-mode',
        label: 'ai.actions.motion.procmotion.setMode',
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
            getSceneAction('setProcMotionMode')?.(p.mode as string);
            getSceneAction('regenerateProcMotion')?.();
        },
    });

    // ── 模型格式分支（文件选择回调） ──

    registerAction({
        id: 'motion:load-camera-vmd',
        label: 'ai.actions.motion.loadCameraVmd',
        domain: 'motion',
        icon: 'lucide:video',
        params: [{ name: 'path', type: 'string' }],
        destructive: false,
        uiOnly: true,
        execute: async (p) => {
            await loadManager.load({ kind: 'camera-vmd', path: p.path as string });
        },
    });

    registerAction({
        id: 'motion:add-scene-vmd',
        label: 'ai.actions.motion.addSceneVmd',
        domain: 'motion',
        icon: 'lucide:film',
        params: [
            { name: 'path', type: 'string' },
            { name: 'name', type: 'string' },
        ],
        destructive: false,
        uiOnly: true,
        execute: async (p) => {
            getSceneAction('addSceneMotion')?.({
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
        label: 'ai.actions.motion.loadAudio',
        domain: 'motion',
        icon: 'lucide:music',
        params: [{ name: 'path', type: 'string' }],
        destructive: false,
        uiOnly: true,
        execute: async (p) => {
            loadManager.load({ kind: 'audio', path: p.path as string });
            showInfoToast(t('motion.musicLoaded', { name: getSceneAction('getAudioName')?.() ?? '' }));
        },
    });

    registerAction({
        id: 'motion:load-vpd',
        label: 'ai.actions.motion.loadVpd',
        domain: 'motion',
        icon: 'lucide:figma',
        params: [{ name: 'path', type: 'string' }],
        destructive: false,
        uiOnly: true,
        execute: async (p) => {
            getSceneAction('loadVPDPose')?.(p.path as string);
        },
    });

    // ── 导航分支 ──

    registerAction({
        id: 'motion:open-binding',
        label: 'ai.actions.motion.openBinding',
        domain: 'motion',
        icon: 'lucide:link',
        params: [{ name: 'modelId', type: 'entity', resolve: findSceneModelByName }],
        destructive: false,
        uiOnly: true,
        execute: async (p) => {
            getUiAction('resetFocusedLayerId')?.();
            const id = p.modelId as string;
            const lvl = getUiAction('buildActionBindingLevel')?.(id) as {
                itemBuilder?: (() => unknown[]) | undefined;
            } | undefined;
            if (lvl) {
                lvl.itemBuilder = () => (getUiAction('buildActionBindingLevel')?.(id) as { items?: unknown[] })?.items ?? [];
            }
            (getUiAction('getMotionMenu')?.() as { push?: (l: unknown) => void } | undefined)?.push(lvl);
        },
    });

    registerAction({
        id: 'motion:browse-music',
        label: 'ai.actions.motion.browseMusic',
        domain: 'motion',
        icon: 'lucide:library',
        params: [],
        destructive: false,
        uiOnly: true,
        execute: async () => {
            const level = _buildLevel!(
                getUiAction('getBrowseDir')?.('audio') ?? '',
                t('motion.musicLibrary'),
                (m) => m.format === 'audio',
                _getMotionMenu() ?? undefined
            );
            _getMotionMenu()?.push(level);
        },
    });

    registerAction({
        id: 'motion:browse-scene-motions',
        label: 'ai.actions.motion.browseSceneMotions',
        domain: 'motion',
        icon: 'lucide:folder-open',
        params: [],
        destructive: false,
        uiOnly: true,
        execute: async () => {
            getUiAction('resetFocusedLayerId')?.();
            const level = _buildLevel!(
                getUiAction('getBrowseDir')?.('vmd') ?? '',
                t('motion.browseMotionLibrary'),
                (m) => m.format === 'vmd',
                _getMotionMenu() ?? undefined,
                undefined,
                {
                    mode: 'stay',
                    onVmdPick: (path: string, name: string) => {
                        const vmdName = name.replace(/\.vmd$/i, '');
                        getSceneAction('addSceneMotion')?.({ vmdPath: path, vmdName, vmdLayers: [], source: 'vmd' });
                        const menu = _getMotionMenu();
                        if (menu) {
                            const root = menu?.getLevel?.(0) as { items?: unknown[] } | undefined;
                            if (root) {
                                root.items = (getUiAction('buildMotionRootItems')?.() ?? []);
                            }
                        }
                    },
                    onVmdReplace: (path: string, name: string) => {
                        const vmdName = name.replace(/\.vmd$/i, '');
                        getSceneAction('replaceDefaultMotion')?.({
                            vmdPath: path,
                            vmdName,
                            vmdLayers: [],
                            source: 'vmd',
                        });
                        const menu = _getMotionMenu();
                        if (menu) {
                            const root = menu?.getLevel?.(0) as { items?: unknown[] } | undefined;
                            if (root) {
                                root.items = (getUiAction('buildMotionRootItems')?.() ?? []);
                            }
                        }
                    },
                }
            );
            _getMotionMenu()?.push(level);
        },
    });

    registerAction({
        id: 'motion:open-detail',
        label: 'ai.actions.motion.openDetail',
        domain: 'motion',
        icon: 'lucide:info',
        params: [{ name: 'sceneMotionId', type: 'string', optional: true }],
        destructive: false,
        uiOnly: true,
        execute: async (p) => {
            const sceneMotionId = p.sceneMotionId as string | undefined;
            const lvl = getUiAction('buildMotionDetailLevel')?.(sceneMotionId) as {
                itemBuilder?: (() => unknown[]) | undefined;
            } | undefined;
            if (lvl) {
                lvl.itemBuilder = () => [];
            }
            (getUiAction('getMotionMenu')?.() as { push?: (l: unknown) => void } | undefined)?.push(lvl);
        },
    });
}
