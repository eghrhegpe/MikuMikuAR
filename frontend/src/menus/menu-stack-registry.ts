// [doc:architecture] Menu stack registry — shared menu stack pointers.
// Extracted from @/core/utils as part of ADR-191 de-barreling.
// Lives in menus/ because it holds SlideMenu references.

import type { SlideMenu } from './menu';
import type { LibraryModel, PopupLevel, BrowseOutcome } from '../core/types';

export const stackRegistry: {
    modelStack: SlideMenu | null;
    sceneStackGetter: (() => SlideMenu | null) | null;
    buildLevel:
        | ((
              dir: string,
              label: string,
              filter?: (m: LibraryModel) => boolean,
              targetStack?: SlideMenu,
              extraFolders?: { label: string; path: string }[],
              outcome?: BrowseOutcome
          ) => PopupLevel)
        | null;
} = {
    modelStack: null,
    sceneStackGetter: null,
    buildLevel: null,
};
