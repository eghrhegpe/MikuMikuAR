package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// SaveModelPreset writes a JSON model preset file to the given path.
func (a *App) SaveModelPreset(jsonStr string, path string) error {
	return os.WriteFile(path, []byte(jsonStr), 0644)
}

// LoadModelPreset reads a JSON model preset file from the given path.
func (a *App) LoadModelPreset(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SelectPresetSaveFile opens a save dialog for model preset files.
func (a *App) SelectPresetSaveFile() (string, error) {
	if a.wailsApp == nil {
		return "", fmt.Errorf("application not initialized")
	}
	dialog := a.wailsApp.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Title:    "保存模型预设",
		Filename: "preset.mcupreset.json",
		Filters: []application.FileFilter{
			{DisplayName: "MikuMikuAR Model Preset (*.mcupreset.json)", Pattern: "*.mcupreset.json"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(path), nil
}

// SelectPresetOpenFile opens a file dialog to pick a model preset file.
func (a *App) SelectPresetOpenFile() (string, error) {
	return a.openFileDialog("加载模型预设", []application.FileFilter{
		{
			DisplayName: "MikuMikuAR Model Preset (*.mcupreset.json)",
			Pattern:     "*.mcupreset.json",
		},
		{
			DisplayName: "All Files (*.*)",
			Pattern:     "*.*",
		},
	})
}

// ModelPresetEntry is a listing entry for a model preset in the library.
type ModelPresetEntry struct {
	Name       string `json:"name"`
	PresetName string `json:"presetName"`
	ModelName  string `json:"modelName"`
	ModelRef   string `json:"modelRef"`
	UpdatedAt  int64  `json:"updatedAt"`
	AutoApply  bool   `json:"autoApply"`
}

// GetModelPresets lists all .mcupreset.json files in the model presets directory.
func (a *App) GetModelPresets() []ModelPresetEntry {
	dir, err := a.modelPresetDir()
	if err != nil {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var result []ModelPresetEntry
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".mcupreset.json") {
			continue
		}
		name := strings.TrimSuffix(e.Name(), ".mcupreset.json")
		info, err := e.Info()
		if err != nil {
			continue
		}
		entry := ModelPresetEntry{
			Name:      name,
			UpdatedAt: info.ModTime().Unix(),
		}
		// Try to extract fields from JSON header
		path := filepath.Join(dir, e.Name())
		if data, err := os.ReadFile(path); err == nil {
			var hdr struct {
				PresetName string `json:"presetName"`
				AutoApply  bool   `json:"autoApply"`
				Model      struct {
					Name       string `json:"name"`
					LibraryRef string `json:"libraryRef"`
				} `json:"model"`
			}
			if err := json.Unmarshal(data, &hdr); err == nil {
				entry.PresetName = hdr.PresetName
				entry.AutoApply = hdr.AutoApply
				entry.ModelName = hdr.Model.Name
				entry.ModelRef = hdr.Model.LibraryRef
			}
		}
		result = append(result, entry)
	}
	return result
}

func validPresetName(name string) bool {
	if name == "" || strings.Contains(name, "..") || strings.ContainsAny(name, "/\\") {
		return false
	}
	return true
}

// SaveModelPresetToLib saves a model preset JSON to the library with the given name.
func (a *App) SaveModelPresetToLib(name string, jsonStr string) error {
	if !validPresetName(name) {
		return fmt.Errorf("invalid preset name: %q", name)
	}
	dir, err := a.modelPresetDir()
	if err != nil {
		return err
	}
	path := filepath.Join(dir, name+".mcupreset.json")
	return os.WriteFile(path, []byte(jsonStr), 0644)
}

// LoadModelPresetFromLib reads a model preset JSON from the library by name.
func (a *App) LoadModelPresetFromLib(name string) (string, error) {
	if !validPresetName(name) {
		return "", fmt.Errorf("invalid preset name: %q", name)
	}
	dir, err := a.modelPresetDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, name+".mcupreset.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// DeleteModelPreset removes a named model preset from the library.
func (a *App) DeleteModelPreset(name string) error {
	if !validPresetName(name) {
		return fmt.Errorf("invalid preset name: %q", name)
	}
	dir, err := a.modelPresetDir()
	if err != nil {
		return err
	}
	return os.Remove(filepath.Join(dir, name+".mcupreset.json"))
}

// RenameModelPreset renames a model preset in the library.
func (a *App) RenameModelPreset(oldName, newName string) error {
	if !validPresetName(oldName) || !validPresetName(newName) {
		return fmt.Errorf("invalid preset name")
	}
	dir, err := a.modelPresetDir()
	if err != nil {
		return err
	}
	oldPath := filepath.Join(dir, oldName+".mcupreset.json")
	newPath := filepath.Join(dir, newName+".mcupreset.json")
	return os.Rename(oldPath, newPath)
}

// writeConfig persists only the config JSON (no rescan). Use for settings changes
// that don't affect the model index (e.g. Blender path).
func (a *App) writeConfig(cfg *Config) error {
	dir, err := settingDir(cfg)
	if err != nil {
		return err
	}
	data, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "config.json"), data, 0644)
}

// writeConfigAndRescan persists the config, runs a full scan with current settings,
// and writes index.json.
func (a *App) writeConfigAndRescan(cfg *Config) error {
	if err := a.writeConfig(cfg); err != nil {
		return err
	}
	// Scan and write index
	models, err := a.ScanModelDir(cfg.LibraryRoot, cfg.ExternalPaths)
	if err != nil {
		return err
	}
	idxData, err := json.Marshal(models)
	if err != nil {
		return err
	}
	dir, err := settingDir(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "index.json"), idxData, 0644)
}

// GetLibraryIndex reads the last scanned index from disk.
func (a *App) GetLibraryIndex() ([]ModelEntry, error) {
	// Try setting/ subdirectory first
	cfg, _ := a.GetConfig()
	sd, sErr := settingDir(cfg)
	if sErr == nil {
		data, rErr := os.ReadFile(filepath.Join(sd, "index.json"))
		if rErr == nil {
			return a.parseLibraryIndex(data)
		}
	}
	// Fallback: AppData
	dir, err := configDir()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(dir, "index.json"))
	if err != nil {
		return nil, err
	}
	return a.parseLibraryIndex(data)
}

func (a *App) parseLibraryIndex(data []byte) ([]ModelEntry, error) {
	var models []ModelEntry
	if err := json.Unmarshal(data, &models); err != nil {
		return nil, err
	}
	valid := models[:0]
	for _, m := range models {
		if m.PMXPath != "" {
			valid = append(valid, m)
		}
	}
	if len(valid) != len(models) {
		a.safeLogInfo("GetLibraryIndex: filtered %d stale entries (empty file_path)", len(models)-len(valid))
	}
	return valid, nil
}
