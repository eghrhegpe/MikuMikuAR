package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ======== Scene Presets (numbered auto-saves) ========

// scenePresetDir returns the scenes/ subdirectory under settingDir.
// In portable mode (ResourceRoot set), presets live under <ResourceRoot>/setting/scenes/.
func (a *App) scenePresetDir() (string, error) {
	cfg, err := a.GetConfig()
	if err != nil {
		return "", err
	}
	base, err := settingDir(cfg)
	if err != nil {
		return "", err
	}
	presetDir := filepath.Join(base, "scenes")
	if err := os.MkdirAll(presetDir, 0755); err != nil {
		return "", err
	}
	return presetDir, nil
}

// modelPresetDir returns the models/ subdirectory under settingDir.
// In portable mode (ResourceRoot set), presets live under <ResourceRoot>/setting/models/.
func (a *App) modelPresetDir() (string, error) {
	cfg, err := a.GetConfig()
	if err != nil {
		return "", err
	}
	base, err := settingDir(cfg)
	if err != nil {
		return "", err
	}
	presetDir := filepath.Join(base, "models")
	if err := os.MkdirAll(presetDir, 0755); err != nil {
		return "", err
	}
	return presetDir, nil
}

// GetPresetScenesDir returns the absolute path of the scene presets directory.
func (a *App) GetPresetScenesDir() (string, error) {
	return a.scenePresetDir()
}

// GetPresetScenes lists numbered .mmascene files in the scene presets directory.
func (a *App) GetPresetScenes() []string {
	dir, err := a.scenePresetDir()
	if err != nil {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var scenes []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".mmascene") {
			scenes = append(scenes, e.Name())
		}
	}
	return scenes
}

// SaveScenePreset saves a scene JSON as an auto-numbered .mmascene in the presets directory.
// Returns the generated filename (e.g. "003.mmascene").
func (a *App) SaveScenePreset(jsonStr string) (string, error) {
	dir, err := a.scenePresetDir()
	if err != nil {
		return "", err
	}
	// Find the next available number
	next := 1
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".mmascene") {
			var n int
			if _, err := fmt.Sscanf(e.Name(), "%d.mmascene", &n); err == nil && n >= next {
				next = n + 1
			}
		}
	}
	filename := fmt.Sprintf("%03d.mmascene", next)
	path := filepath.Join(dir, filename)
	if err := os.WriteFile(path, []byte(jsonStr), 0644); err != nil {
		return "", err
	}
	return filename, nil
}

// DeletePresetScene deletes a named preset scene file.
func (a *App) DeletePresetScene(name string) error {
	clean := validatePresetName(name)
	if clean == "" {
		return fmt.Errorf("invalid preset name: %q", name)
	}
	dir, err := a.scenePresetDir()
	if err != nil {
		return err
	}
	return os.Remove(filepath.Join(dir, clean))
}
