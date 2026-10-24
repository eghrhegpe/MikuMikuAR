package app

import (
	"encoding/json"
	"fmt"
)

// ======== Render Presets ========

// SaveRenderPreset saves or updates a named render preset.
// params is a JSON string of the RenderState fields.
func (a *App) SaveRenderPreset(name string, params string) error {
	// [audit:fix 2026-09] 坏 JSON 不再静默存空 map（同名更新时会覆盖既有 Params，数据丢失）。
	// 先校验通过再写配置；"null" 视为空对象。
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(params), &parsed); err != nil {
		return fmt.Errorf("invalid render preset params JSON: %w", err)
	}
	if parsed == nil {
		parsed = map[string]interface{}{}
	}
	return a.updateConfig(func(cfg *Config) {
		// Update or append
		for i, p := range cfg.RenderPresets {
			if p.Name == name {
				cfg.RenderPresets[i].Params = parsed
				return
			}
		}
		cfg.RenderPresets = append(cfg.RenderPresets, RenderPreset{Name: name, Params: parsed})
	}, false)
}

// DeleteRenderPreset removes a named render preset.
func (a *App) DeleteRenderPreset(name string) error {
	return a.updateConfig(func(cfg *Config) {
		var kept []RenderPreset
		for _, p := range cfg.RenderPresets {
			if p.Name != name {
				kept = append(kept, p)
			}
		}
		cfg.RenderPresets = kept
	}, false)
}

// GetRenderPresets returns all user-defined render presets.
func (a *App) GetRenderPresets() []RenderPreset {
	cfg, err := a.GetConfig()
	if err != nil {
		return nil
	}
	return cfg.RenderPresets
}
