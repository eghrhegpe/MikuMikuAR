// [doc:adr-189] 纹理路径 fallback 候选生成（纯函数，无依赖，便于单测）。
//
// 背景：PMX 声明的纹理路径可能与磁盘实际位置不一致（模型打包常见问题）：
//   - PMX 引用 "textures\xxx.png"，文件实际在 "textures/Normalmap/xxx.png"（深一层子目录）
//   - PMX 引用裸名 "xxx.png"，文件实际在 "tex/xxx.png"
// babylon-mmd 的 ReferenceFileResolver 按「声明路径」精确匹配 referenceFiles 的 relativePath，
// 匹配不上则纹理加载失败（材质显示不出）。collectTextureFiles 为每个文件注册多个候选路径
// 副本（共享同一 data），使声明路径能命中磁盘实际位置。
//
// 候选规则（对相对路径 rel，/ 分隔）：
//   1. 裸名：最后一段（如 textures/Normalmap/xxx.png → xxx.png）
//   2. 去首段路径：去掉第一段目录（→ Normalmap/xxx.png）
//   3. 首段+裸名：第一段目录 + 裸名（→ textures/xxx.png，命中「声明带首目录、文件深一层」）
// 已存在的原始路径本身不重复注册；同文件生成重复候选自动去重。

/** 生成给定相对路径的 fallback 候选列表（不含原始路径本身）。 */
export function textureFallbackCandidates(rel: string): string[] {
    const normalized = rel.replace(/\\/g, '/');
    if (!normalized || normalized.endsWith('/')) {
        // 空路径或以 / 结尾（目录而非文件）→ 无候选
        return [];
    }
    const segments = normalized.split('/').filter(Boolean);
    const base = segments.pop();
    if (!base) {
        return [];
    }
    const candidates: string[] = [base];
    if (segments.length >= 1) {
        // 首段+裸名：textures/xxx.png（从 textures/Normalmap/xxx.png）
        candidates.push(`${segments[0]}/${base}`);
    }
    if (segments.length > 1) {
        // 去首段路径：Normalmap/xxx.png
        candidates.push(segments.slice(1).join('/') + '/' + base);
    }
    return candidates;
}

/**
 * 按 PMX 声明路径反向注册别名（[fix:decl-alias]）。
 *
 * 背景：PMX 声明的纹理目录名可能与磁盘实际目录名异写（如声明 `tex\xxx.png`，
 * 磁盘实际 `Texture/xxx.png`）——fallback 候选路径无法枚举这种差异。此时以
 * PMX 声明为准：若磁盘文件中有同名（basename 一致）文件，注册「声明完整路径」
 * 别名（共享同一 data），使 babylon-mmd 按声明路径 resolve 时能命中。
 *
 * @param files 磁盘扫描出的纹理文件（含既有 fallback 候选）
 * @param declaredPaths PMX 声明的纹理路径清单（parsePmxTexturePaths 返回）
 * @returns 追加声明别名后的完整列表（无匹配时不新增）
 */
export function registerDeclaredAliases(
    files: ReadonlyArray<{ readonly relativePath: string; readonly data: ArrayBuffer }>,
    declaredPaths: readonly string[]
): Array<{ relativePath: string; data: ArrayBuffer }> {
    if (declaredPaths.length === 0 || files.length === 0) {
        return files as Array<{ relativePath: string; data: ArrayBuffer }>;
    }
    // basename（大小写不敏感，与 resolver/audit 的 toUpperCase 归一一致）→ 磁盘文件
    // （首个匹配；同 basename 多文件时以第一个为准）
    const byBasename = new Map<string, (typeof files)[number]>();
    for (const f of files) {
        const base = f.relativePath.replace(/\\/g, '/').split('/').pop() ?? '';
        if (base && !byBasename.has(base.toUpperCase())) {
            byBasename.set(base.toUpperCase(), f);
        }
    }
    const extra: Array<{ relativePath: string; data: ArrayBuffer }> = [];
    const seen = new Set(files.map((f) => f.relativePath.replace(/\\/g, '/')));
    for (const decl of declaredPaths) {
        const norm = decl.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
        if (!norm || seen.has(norm)) {
            continue; // 已有同路径（磁盘真实路径或既有候选）
        }
        const base = norm.split('/').pop() ?? '';
        const src = byBasename.get(base.toUpperCase());
        if (!src) {
            continue; // 磁盘无同名文件 → 真缺失，不注册
        }
        seen.add(norm);
        extra.push({ relativePath: norm, data: src.data }); // 共享 data
    }
    return extra.length > 0 ? [...files, ...extra] : (files as Array<{ relativePath: string; data: ArrayBuffer }>);
}

/**
 * 批量展开 fallback 候选条目（共享 data 引用），并对「候选 vs 真实路径」冲突去重。
 *
 * [fix:p2-candidate-collision] hasCandidate 预置所有真实路径：候选与磁盘真实文件同名
 * （如根目录 face.png 与 tex/face.png 并存）时不生成重复条目，避免 referenceFiles
 * 出现同 relativePath 双条目导致 babylon-mmd resolver 按 key 覆盖时错配贴图。
 */
export function expandFallbackCandidates<T extends { readonly relativePath: string; readonly data: ArrayBuffer }>(
    files: readonly T[]
): T[] {
    if (files.length === 0) {
        return [];
    }
    const hasCandidate = new Set(files.map((f) => f.relativePath.replace(/\\/g, '/')));
    const fallbacks: T[] = [];
    for (const tf of files) {
        const rel = tf.relativePath.replace(/\\/g, '/');
        for (const cand of textureFallbackCandidates(rel)) {
            if (cand === rel || hasCandidate.has(cand)) {
                continue;
            }
            hasCandidate.add(cand);
            fallbacks.push({ ...tf, relativePath: cand } as T); // 共享 data 引用
        }
    }
    return [...files, ...fallbacks];
}
