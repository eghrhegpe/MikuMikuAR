package app

import (
	"encoding/json"
)

// ======== Render Presets ========

// SaveRenderPreset saves or updates a named render preset.
// params is a JSON string of the RenderState fields.
func (a *App) SaveRenderPreset(name string, params string) error {
	return a.updateConfig(func(cfg *Config) {
		// Parse the params JSON into a generic map
		var parsed map[string]interface{}
		if err := json.Unmarshal([]byte(params), &parsed); err != nil {
			parsed = make(map[string]interface{})
		}
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
	if err != nil || cfg == nil {
		return nil
	}
	return cfg.RenderPresets
}
