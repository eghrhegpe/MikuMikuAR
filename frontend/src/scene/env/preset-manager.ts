// preset-manager.ts — 统一预设系统接口（ADR-130 Phase 2.7）
//
// 收敛各子系统零散的预设 CRUD 模式，提供统一的 List/Save/Load/Delete/Import/Export 接口。
// 各子系统（env / lighting / ground / water / model / motion）各自实现 PresetManager，
// 调用方通过同一接口操作，无需关心存储细节。
//
// 使用方式：
//   import { envPresetManager } from './preset-manager';
//   const presets = envPresetManager.list();
//   envPresetManager.save('my-preset', snapshot);
//   envPresetManager.export('my-preset'); // → JSON string

import type { CategorizedEnvPreset } from './env-lighting';
import {
    exportCategorizedEnvPreset,
    importCategorizedEnvPreset,
    snapshotEnvPresetByCategory,
    ENV_PRESET_FIELDS,
    type EnvPresetCategory,
} from './env-lighting';
import { envState } from '@/core/config';
import type { EnvState } from '@/core/types';

// ===================================================================
// 接口定义
// ===================================================================

/** 预设元数据（统一格式，各子系统共用）。 */
export interface PresetMeta {
    name: string;
    label: string;
    category: string;
    createdAt: string;
    tags?: string[];
}

/** 预设条目（列表项）。 */
export interface PresetEntry<T = unknown> {
    meta: PresetMeta;
    data: T;
}

/**
 * 统一预设管理器接口。
 * 各子系统实现此接口，提供预设的 CRUD + 导入/导出能力。
 */
export interface PresetManager<T> {
    /** 列出所有预设（含元数据）。 */
    list(): PresetEntry<T>[];
    /** 按名称保存预设。 */
    save(name: string, label: string, data: T): void;
    /** 按名称加载预设。 */
    load(name: string): T | null;
    /** 按名称删除预设。 */
    delete(name: string): boolean;
    /** 导出预设为 JSON 字符串。 */
    export(name: string): string | null;
    /** 从 JSON 字符串导入预设。 */
    import(json: string): T | null;
}

// ===================================================================
// 环境预设管理器（CategorizedEnvPreset）
// ===================================================================

/**
 * 内存存储的环境预设管理器。
 * 预设以 `CategorizedEnvPreset` 格式存储在内存 Map 中，
 * 持久化由调用方通过 `setEnvState` 写入 config。
 *
 * 覆盖：sky / ground / water / atmosphere 四类环境预设。
 */
class EnvPresetManagerImpl implements PresetManager<CategorizedEnvPreset> {
    private presets = new Map<string, CategorizedEnvPreset>();

    list(): PresetEntry<CategorizedEnvPreset>[] {
        const result: PresetEntry<CategorizedEnvPreset>[] = [];
        for (const [name, preset] of this.presets) {
            result.push({
                meta: {
                    name,
                    label: preset.label,
                    category: preset.category,
                    createdAt: '',
                },
                data: preset,
            });
        }
        return result;
    }

    save(name: string, label: string, data: CategorizedEnvPreset): void {
        this.presets.set(name, { ...data, label });
    }

    load(name: string): CategorizedEnvPreset | null {
        return this.presets.get(name) ?? null;
    }

    delete(name: string): boolean {
        return this.presets.delete(name);
    }

    export(name: string): string | null {
        const preset = this.presets.get(name);
        if (!preset) return null;
        return exportCategorizedEnvPreset(preset);
    }

    import(json: string): CategorizedEnvPreset | null {
        const preset = importCategorizedEnvPreset(json);
        if (!preset) return null;
        // 从导入数据自动生成名称
        const name = `imported-${preset.category}-${Date.now()}`;
        this.presets.set(name, preset);
        return preset;
    }

    // ======== 便捷方法 ========

    /** 从当前 envState 按分类创建快照并保存。 */
    snapshotFromCurrent(category: EnvPresetCategory, label: string): string {
        const name = `${category}-${Date.now()}`;
        const preset = snapshotEnvPresetByCategory(label, category, envState as EnvState);
        this.save(name, label, preset);
        return name;
    }

    /** 获取所有预设名称列表。 */
    getNames(): string[] {
        return Array.from(this.presets.keys());
    }
}

/** 环境预设管理器单例。 */
export const envPresetManager = new EnvPresetManagerImpl();