// 零依赖叶：纯路径工具。
// 禁止从本文件 import 任何应用层模块（dom/state/fileservice/status-bar/i18n/feedback/menus/logger）。
// 下沉自 @/core/utils（god barrel）；根因与纪律见 ADR-191 —— 纯模块从桶导入会拖起整套应用层，
// 致 vitest fork worker 留 pending 微任务、测试 EXIT=124（「一改就炸」）。

const _normPathCache = new Map<string, string>();
const NORM_PATH_CACHE_MAX = 5000;

/**
 * 标准化路径：反斜杠 → 正斜杠，去掉尾部斜杠。
 * 注意：Android SAF URI（content://...）原样返回，不做转换。
 * 结果缓存，避免 buildLevel 遍历千级模型时重复正则替换。
 * 缓存键使用小写化路径，确保大小写不敏感系统（Windows/macOS）上同一文件只缓存一次。
 */
export function normPath(p: string): string {
    const cacheKey = p.toLowerCase();
    const cached = _normPathCache.get(cacheKey);
    if (cached !== undefined) {
        return cached;
    }

    let result: string;
    if (p.startsWith('content://')) {
        result = p.replace(/\/+$/, '');
    } else {
        result = p.replace(/\\/g, '/').replace(/\/+$/, '');
        result = result
            .replace(/\/\.\//g, '/')
            .replace(/^\.\//, '')
            .replace(/\/\.$/, '');
    }

    if (_normPathCache.size >= NORM_PATH_CACHE_MAX) {
        _normPathCache.clear();
    }
    _normPathCache.set(cacheKey, result);
    return result;
}

/**
 * 跨平台取路径末段文件名。
 * 基于 `normPath`（反斜杠→正斜杠、去尾斜杠、折叠 `.`、content:// 透传），
 * 避免各模块重复手搓 `p.replace(/\\/g, '/').split('/').pop()`。
 */
export function getBaseName(p: string): string {
    const norm = normPath(p);
    const segs = norm.split('/').filter(Boolean);
    return segs.length ? segs[segs.length - 1] : norm;
}

/**
 * 跨平台取父目录路径。根目录（无 `/`）返回空字符串。
 * 基于 `normPath`，是 `p.replace(/\\/g, '/').replace(/\/[^/]*$/, '')` 的归一化替代。
 */
export function getDirPath(p: string): string {
    const norm = normPath(p);
    const idx = norm.lastIndexOf('/');
    return idx >= 0 ? norm.substring(0, idx) : '';
}

/**
 * [doc:adr-090][doc:adr-095] 路径归属判定（唯一实现，基于 normPath）。
 * 判定 child 是否位于 base 之下：精确相等（忽略大小写），或前缀相等且紧随字符为 '/'。
 * 禁止裸字符串前缀（如 ".../PMX" 误命中 ".../PMXSub" → 伪文件夹）。
 * 含 `..` 的路径直接拒绝（目录边界判定场景，越界到 base 之外属非法输入；
 * 与 resolveLibraryRef 的 `..` 字符串层拦截形成对称防护）。
 */
export function isUnderRoot(base: string, child: string): boolean {
    const b = normPath(base).toLowerCase();
    const c = normPath(child).toLowerCase();
    // 拒绝 '..' 逃逸段：含 '..' 的路径不是已解析绝对路径，跨目录误判且会渲染成 '..' 文件夹。
    // 修复 P2 场景1（如 C:/text-model/PMX/../VMD 不应判为在 PMX 之下）
    if (c === '..' || c.startsWith('../') || c.endsWith('/..') || c.includes('/../')) {
        return false;
    }
    return c === b || c.startsWith(b + '/');
}

/**
 * 判断给定 kind/type 是否为「舞台类」（缩略图使用横屏 16:9 宽高比）。
 * 写侧（thumbnail-capture.ts，基于 inst.kind）与读侧（library-core.ts / library-actions.ts，
 * 基于 m.type）共用此谓词，消除宽高比缓存键的双重定义导致的潜在不一致。
 * 涵盖：stage（舞台）、scene（场景）、prop（道具）。
 */
export function isStageLike(kind: string): boolean {
    return kind === 'stage' || kind === 'scene' || kind === 'prop';
}
