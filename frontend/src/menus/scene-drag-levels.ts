import type { PopupLevel } from '../core/config';
import { t } from '../core/i18n/t';
import { buildLevel } from './env-level-helpers';
import { buildSnapSettings } from './resource-detail-helpers';
import { getSceneMenu } from './scene-menu-state';

export function buildDragModeLevel(): PopupLevel {
    return buildLevel(t('scene.dragMode'), (c) => {
        buildSnapSettings(c, () => getSceneMenu()?.updateControls());
    });
}
