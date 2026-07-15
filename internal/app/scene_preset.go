package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ======== Common Preset Helpers ========

// presetDir returns subDir under settingDir, creating it if needed.
// This avoids duplicating the GetConfig→settingDir→MkdirAll pattern across
// scene, model, and env preset systems.
func (a *App) presetDir(subDir string) (string, error) {
	cfg, err := a.GetConfig()
	if err != nil {
		return "", err
	}
	base, err := settingDir(cfg)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, subDir)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

// autoNumberedSave writes jsonStr to the next available NNN.ext file in dir.
// Returns the generated filename (e.g. "003.mmascene").
func autoNumberedSave(dir, ext, jsonStr string) (string, error) {
	next := 1
	entries, _ := os.ReadDir(dir)
	pattern := "%d." + ext
	format := "%03d." + ext
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), "."+ext) {
			var n int
			if _, err := fmt.Sscanf(e.Name(), pattern, &n); err == nil && n >= next {
				next = n + 1
			}
		}
	}
	filename := fmt.Sprintf(format, next)
	path := filepath.Join(dir, filename)
	if err := os.WriteFile(path, []byte(jsonStr), 0644); err != nil {
		return "", err
	}
	return filename, nil
}

// deletePresetFile removes a preset file named name.ext from dir after
// validating the name. Returns an error if the name is invalid.
func deletePresetFile(dir, name, ext string) error {
	clean := validatePresetName(name)
	if clean == "" {
		return fmt.Errorf("invalid preset name: %q", name)
	}
	return os.Remove(filepath.Join(dir, clean+"."+ext))
}

// ======== Scene Presets (numbered auto-saves) ========

// scenePresetDir returns the scenes/ subdirectory under settingDir.
func (a *App) scenePresetDir() (string, error) {
	return a.presetDir("scenes")
}

// modelPresetDir returns the models/ subdirectory under settingDir.
func (a *App) modelPresetDir() (string, error) {
	return a.presetDir("models")
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
	return autoNumberedSave(dir, "mmascene", jsonStr)
}

// DeletePresetScene deletes a named preset scene file.
func (a *App) DeletePresetScene(name string) error {
	dir, err := a.scenePresetDir()
	if err != nil {
		return err
	}
	return deletePresetFile(dir, name, "mmascene")
}
