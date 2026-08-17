/**
 * env/_shared/ground-bump.ts
 * 地面法线扭曲强度的纯函数（无状态、无 Babylon 依赖）。
 *
 * [doc:adr-271] 从 env-ground.ts 下移。原因：env-terrain.ts 与 env-ground-spec.ts
 * 都需要它，而 env-ground.ts 又 import 这两个模块，形成
 * `env-ground ⇄ env-terrain` / `env-ground ⇄ env-ground-spec` 的双向依赖（size=3 SCC）。
 * 该函数只读传入的 EnvState，不碰任何模块局部状态，是真正的叶子。
 * env-ground.ts 转发此符号保持外部导入路径不变。
 */
import type { EnvState } from '@/core/config';

/** ADR-114 Phase 2: 法线扭曲映射到 bumpTexture.level 增强（distort=1 时额外 +2.0）；低质量模式自动关闭 */
export function _effectiveBumpLevel(state: EnvState): number {
    // 低质量模式自动关闭法线扭曲
    if (state.reflectionQuality === 'low' || state.reflectionQuality === 'off') {
        return state.groundNormalStrength;
    }
    return state.groundNormalStrength + state.groundReflectionDistort * 2.0;
}
