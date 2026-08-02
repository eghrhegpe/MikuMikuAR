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
