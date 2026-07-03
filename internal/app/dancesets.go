package app

import (
	"fmt"
	"path/filepath"
	"strings"
)

// ======== Dance Sets ========

// GetDanceSets returns all dance sets.
func (a *App) GetDanceSets() []DanceSet {
	cfg, err := a.GetConfig()
	if err != nil || cfg == nil || cfg.DanceSets == nil {
		return nil
	}
	result := make([]DanceSet, 0, len(cfg.DanceSets))
	for _, ds := range cfg.DanceSets {
		result = append(result, ds)
	}
	return result
}

// SaveDanceSet saves or updates a dance set with the given id.
func (a *App) SaveDanceSet(id string, ds DanceSet) error {
	return a.updateConfig(func(cfg *Config) {
		if cfg.DanceSets == nil {
			cfg.DanceSets = make(map[string]DanceSet)
		}
		cfg.DanceSets[id] = ds
	}, false)
}

// DeleteDanceSet deletes a dance set by id.
func (a *App) DeleteDanceSet(id string) error {
	return a.updateConfig(func(cfg *Config) {
		if cfg.DanceSets != nil {
			delete(cfg.DanceSets, id)
		}
	}, false)
}

// ImportDanceSet creates a dance set from a VMD file and audio file.
// Returns the generated dance set id.
func (a *App) ImportDanceSet(vmdPath, audioPath, name string) (string, error) {
	if vmdPath == "" {
		return "", fmt.Errorf("VMD 文件路径不能为空")
	}
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(vmdPath), filepath.Ext(vmdPath))
	}
	id := sha256Hex(vmdPath + ":" + audioPath)[:16]
	ds := DanceSet{
		Name:        name,
		VmdPath:     vmdPath,
		AudioPath:   audioPath,
		AudioOffset: 0,
		Description: "",
		Thumbnail:   "",
		Source:      "",
	}
	err := a.SaveDanceSet(id, ds)
	if err != nil {
		return "", err
	}
	return id, nil
}
