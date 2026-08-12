// [doc:architecture] Library path resolution helpers.
// Extracted from @/core/utils as part of ADR-191 de-barreling.
// [doc:adr-242] 依赖 core/state 的 libraryRoot/overridePaths，无 Babylon/UI 依赖，归属 core 层。

import { libraryRoot, overridePaths } from '@/core/state';
import { normPath, isUnderRoot, computeLibraryRef as _pureComputeLibraryRef } from '@/core/path';
import { logWarn } from '@/core/logger';

/** Backwards-compatible wrapper: reads libraryRoot and delegates to the pure path leaf. */
export function computeLibraryRef(filePath: string): string | null {
    return _pureComputeLibraryRef(filePath, libraryRoot);
}

export function resolveLibraryRef(libraryRef: string): string | null {
    if (!libraryRef) {
        return null;
    }
    // 先归一化（反斜杠→正斜杠、折叠 '.' 段）再做安全校验，双保险：
    // 1) "\\etc\\passwd"（反斜杠绝对路径）不归一化会绕过 startsWith('/') 拦截；
    // 2) 返回给调用方的路径统一正斜杠，避免混合分隔符传给文件系统。
    const refNorm = normPath(libraryRef);
    if (!refNorm || refNorm.startsWith('/') || refNorm.includes('..')) {
        logWarn('resolveLibraryRef', `suspicious libraryRef rejected: "${libraryRef}"`);
        return null;
    }
    const colonIdx = refNorm.indexOf(':');
    if (colonIdx > 0) {
        // External library refs (e.g. "MyLib:PMX/model.pmx") are no longer supported;
        // reject any ref containing a colon that isn't a drive letter.
        logWarn('resolveLibraryRef', `external library ref no longer supported: "${libraryRef}"`);
        return null;
    }
    if (libraryRoot) {
        const resolved = normPath(libraryRoot) + '/' + refNorm;
        if (!isUnderRoot(libraryRoot, resolved)) {
            logWarn('resolveLibraryRef', `path traversal blocked: "${resolved}"`);
            return null;
        }
        return resolved;
    }
    return null;
}

/** 资源类别到 OverridePaths 键名的映射（与 core/types.ts OverridePaths 键集一致） */
const CATEGORY_KEY: Record<string, string> = {
    pmx: 'pmx',
    vmd: 'vmd',
    audio: 'audio',
    prop: 'prop',
    stage: 'stage',
    environment: 'environment',
    md_dress: 'md_dress',
    setting: 'setting',
};

// Go 端 GetPath 使用的实际目录名（大小写敏感，与 internal/app/app.go defs 对齐）
export const CATEGORY_DIR: Record<string, string> = {
    pmx: 'PMX',
    vmd: 'VMD',
    audio: 'audio',
    prop: 'prop',
    stage: 'stage',
    environment: 'environment',
    md_dress: 'MD-dress',
    setting: 'setting',
};

/**
 * 统一的资源浏览目录解析。
 * 优先级：overridePaths[category] > libraryRoot/subdir
 * 返回值统一经 normPath 归一化（反斜杠→正斜杠、去尾部斜杠），
 * 消除 Windows 配置（filepath.Join 反斜杠 / 用户手填尾斜杠）带来的
 * 混合分隔符与双斜杠，保证 buildLevel 等下游直接用而无需自行 normPath。
 * @returns 解析后的目录路径，如果 libraryRoot 未设置则返回空字符串
 */
export function getBrowseDir(category: string): string {
    const key = CATEGORY_KEY[category] ?? category;
    const override = (overridePaths as Record<string, string>)[key];
    if (override) {
        return normPath(override);
    }
    if (!libraryRoot) {
        return '';
    }
    // 使用与实际目录名一致的子目录名（与 Go 端 GetPath 保持大小写一致）
    // 网页端扫描已将文件映射到虚拟子目录（web://selected-dir/PMX 等），无需特殊处理。
    const subdir = CATEGORY_DIR[category] ?? category;
    return normPath(libraryRoot) + '/' + subdir;
}

// [doc:adr-238] 注册浏览目录读取供 core/action-defs 经 ui-action-bridge 调用
import { registerUiAction } from '@/core/ui-action-bridge';
registerUiAction('getBrowseDir', (kind: string) => getBrowseDir(kind));
