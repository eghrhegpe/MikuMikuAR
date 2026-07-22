// [doc:architecture] Env Level Helpers — 环境功能层级公共辅助函数
// 从 env-feature-levels.ts 拆分，被 env-menu.ts 和各种 env-*-levels.ts 共享
// 循环依赖策略：依赖 env-menu-state.ts（纯状态模块）而非 env-menu.ts

import { cardContainer, getBrowseDir } from '../core/config';
import type { PopupLevel } from '../core/config';
import { closeAllOverlays, stackRegistry } from '../core/utils';
import { setEnvTextureBindingTarget } from './env-menu-state';
import { getEnvMenu } from './env-menu-state';

/** 通用的环境功能层级构建器：包裹 cardContainer + renderMenu 模板 */
export function _buildLevel(
    label: string,
    buildSchema: (c: HTMLElement) => (() => void) | void,
    buildExtraSegments?: Array<(c: HTMLElement) => (() => void) | void>
): PopupLevel {
    const segments: Array<(c: HTMLElement) => (() => void) | void> = buildExtraSegments
        ? [buildSchema, ...buildExtraSegments]
        : [buildSchema];
    return {
        label,
        dir: '',
        items: [],
        renderCustom: (container) => {
            const disposes: (() => void)[] = [];
            for (const seg of segments) {
                const d = cardContainer(container, seg);
                if (typeof d === 'function') {
                    disposes.push(d);
                }
            }
            if (disposes.length > 0) {
                return () => {
                    for (const d of disposes) {
                        d();
                    }
                };
            }
        },
    };
}

/** 打开环境贴图选择器 */
export function _openTexturePicker(
    target: import('./env-menu-state').EnvTextureBindingTarget,
    label: string,
    browseDir?: string,
    noCloseOverlay?: boolean,
    pushMenu?: import('./menu').SlideMenu | null
): void {
    if (!noCloseOverlay) {
        closeAllOverlays();
    }
    const menu = pushMenu ?? getEnvMenu();
    if (!menu) {
        return;
    }
    if (!stackRegistry.buildLevel) {
        if (import.meta.env.DEV) {
            console.warn(
                '[env-level-helpers] buildLevel not yet registered, ignoring texture picker call'
            );
        }
        return;
    }
    setEnvTextureBindingTarget(target);
    const level = stackRegistry.buildLevel(
        browseDir ?? getBrowseDir('environment'),
        label,
        (m) => ['png', 'jpg', 'jpeg', 'hdr', 'dds'].includes(m.format),
        menu
    );
    menu.push(level);
}
