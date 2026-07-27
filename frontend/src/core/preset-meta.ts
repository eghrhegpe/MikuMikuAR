// preset-meta.ts — 预设元数据跨系统归一（ADR-130 Phase 2.7 收敛）
//
// 背景：4 个预设系统（env / render / scene / model）经 ADR-176 的 backend 代理
// 统一走 `resolveBackend()`，存储也共 `presets` IDB store（键前缀 env:/render:/scene:/model:），
// 但「读出来」的形状不统一——env/scene/model 仅回名字 `string[]`，render 回
// `RenderPreset{name,params}[]`，且四类均无 createdAt/tags/label 信封。
//
// 本模块提供**读侧归一**：把四系统的 list 结果统一为 `PresetMeta[]`，供未来的跨类
// 浏览 / 排序 / 标签筛选 / 搜索复用。写侧信封化（{meta,data}）保持各系统独立写路径，
// 待确有跨类需求时再做，避免为抽象而抽象（见 ADR-130 修订说明）。

import {
  ListEnvPresets,
  GetRenderPresets,
  GetPresetScenes,
  GetModelPresets,
} from '@/core/wails-bindings';
import type { EnvPresetEntry, ModelPresetEntry } from '@/core/wails-bindings';

export type PresetCategory = 'env' | 'render' | 'scene' | 'model';

export interface PresetMeta {
  /** 稳定主键：`${category}:${name}` */
  id: string;
  category: PresetCategory;
  name: string;
  /** 展示名；无显式 label 时回退 name */
  label: string;
  /** epoch ms；旧预设无此字段时为 undefined */
  createdAt?: number;
  tags?: string[];
  version?: number;
}

/** 由单条记录构造 `PresetMeta`。`extra` 仅承载 envelope 字段，不触碰各系统原生 payload。 */
export function toPresetMeta(
  category: PresetCategory,
  name: string,
  extra?: Partial<Omit<PresetMeta, 'id' | 'category' | 'name'>>,
): PresetMeta {
  return {
    id: `${category}:${name}`,
    category,
    name,
    label: extra?.label ?? name,
    createdAt: extra?.createdAt,
    tags: extra?.tags,
    version: extra?.version,
  };
}

/**
 * 跨系统枚举预设，归一为 `PresetMeta[]`。
 * - 不传 `category`：聚合全部四类。
 * - 传 `category`：仅查询该类（短路其余 list 调用）。
 * - 对 Go nullable 返回做 `?? []` 守卫，避免 NPE。
 */
export async function listPresets(category?: PresetCategory): Promise<PresetMeta[]> {
  const cats: PresetCategory[] = category ? [category] : ['env', 'render', 'scene', 'model'];
  const out: PresetMeta[] = [];

  for (const c of cats) {
    switch (c) {
      case 'env': {
        // env 预设后端已自带 label/category/createdAt 信封，直接归一。
        const entries = (await ListEnvPresets()) ?? [];
        for (const e of entries) {
          out.push(toPresetMeta('env', e.name, { label: e.label, createdAt: e.createdAt }));
        }
        break;
      }
      case 'render': {
        const presets = (await GetRenderPresets()) ?? [];
        for (const p of presets) out.push(toPresetMeta('render', p.name));
        break;
      }
      case 'scene': {
        const names = (await GetPresetScenes()) ?? [];
        for (const n of names) out.push(toPresetMeta('scene', n));
        break;
      }
      case 'model': {
        // model 预设后端给 updatedAt（无 createdAt），复用为时间字段。
        const entries = (await GetModelPresets()) ?? [];
        for (const m of entries) {
          out.push(toPresetMeta('model', m.name, { createdAt: m.updatedAt }));
        }
        break;
      }
    }
  }

  return out;
}
