package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"mikumikuar/internal/dialogs"
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
	return a.selectFile("preset", dialogs.SelectPresetSave)
}

// SelectPresetOpenFile opens a file dialog to pick a model preset file.
func (a *App) SelectPresetOpenFile() (string, error) {
	return a.selectFile("preset", dialogs.SelectPresetOpen)
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
		// Read only first 1KB to extract header fields (presetName, autoApply, model info)
		path := filepath.Join(dir, e.Name())
		if f, err := os.Open(path); err == nil {
			buf := make([]byte, 1024)
			n, _ := f.Read(buf)
			f.Close()
			if n > 0 {
				var hdr struct {
					PresetName string `json:"presetName"`
					AutoApply  bool   `json:"autoApply"`
					Model      struct {
						Name       string `json:"name"`
						LibraryRef string `json:"libraryRef"`
					} `json:"model"`
				}
				if err := json.Unmarshal(buf[:n], &hdr); err == nil {
					entry.PresetName = hdr.PresetName
					entry.AutoApply = hdr.AutoApply
					entry.ModelName = hdr.Model.Name
					entry.ModelRef = hdr.Model.LibraryRef
				}
			}
		}
		result = append(result, entry)
	}
	return result
}

// validatePresetName checks and sanitizes a preset name.
// Returns the trimmed name if valid, or empty string if invalid.
// Forbids: empty names, path traversal (..), and filesystem-unsafe chars.
func validatePresetName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" || strings.Contains(name, "..") || strings.ContainsAny(name, "/\\:*?\"<>|") {
		return ""
	}
	return name
}

// SaveModelPresetToLibAuto saves a model preset JSON as an auto-numbered .mcupreset.json in the model presets directory.
// Returns the generated filename (e.g. "003.mcupreset.json").
func (a *App) SaveModelPresetToLibAuto(jsonStr string) (string, error) {
	dir, err := a.modelPresetDir()
	if err != nil {
		return "", err
	}
	return autoNumberedSave(dir, "mcupreset.json", jsonStr)
}

// SaveModelPresetToLib saves a model preset JSON to the library with the given name.
func (a *App) SaveModelPresetToLib(name string, jsonStr string) error {
	clean := validatePresetName(name)
	if clean == "" {
		return fmt.Errorf("invalid preset name: %q", name)
	}
	dir, err := a.modelPresetDir()
	if err != nil {
		return err
	}
	path := filepath.Join(dir, clean+".mcupreset.json")
	return os.WriteFile(path, []byte(jsonStr), 0644)
}

// LoadModelPresetFromLib reads a model preset JSON from the library by name.
func (a *App) LoadModelPresetFromLib(name string) (string, error) {
	clean := validatePresetName(name)
	if clean == "" {
		return "", fmt.Errorf("invalid preset name: %q", name)
	}
	dir, err := a.modelPresetDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, clean+".mcupreset.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// DeleteModelPreset removes a named model preset from the library.
func (a *App) DeleteModelPreset(name string) error {
	dir, err := a.modelPresetDir()
	if err != nil {
		return err
	}
	return deletePresetFile(dir, name, "mcupreset.json")
}

// RenameModelPreset renames a model preset in the library.
func (a *App) RenameModelPreset(oldName, newName string) error {
	cleanOld := validatePresetName(oldName)
	cleanNew := validatePresetName(newName)
	if cleanOld == "" || cleanNew == "" {
		return fmt.Errorf("invalid preset name")
	}
	dir, err := a.modelPresetDir()
	if err != nil {
		return err
	}
	oldPath := filepath.Join(dir, cleanOld+".mcupreset.json")
	newPath := filepath.Join(dir, cleanNew+".mcupreset.json")
	return os.Rename(oldPath, newPath)
}

// writeConfig persists only the config JSON (no rescan). Use for settings changes
// that don't affect the model index (e.g. Blender path).
// Uses tmp+rename for atomicity: prevents corrupted config on crash/power loss.
// Caller must hold configMu (Lock). Invalidates the in-memory config cache.
func (a *App) writeConfig(cfg *Config) error {
	a.cachedCfg = nil
	data, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	// 写入 bootstrap config（内部存储，供 getConfigUnsafe 定位 setting/ 目录）
	if bootDir, bErr := configDir(); bErr == nil {
		bootPath := filepath.Join(bootDir, "config.json")
		if wErr := os.WriteFile(bootPath+".tmp", data, 0644); wErr == nil {
			os.Rename(bootPath+".tmp", bootPath)
		}
	}
	// 写入完整 config（setting/ 目录，与 bootstrap 内容一致）
	dir, err := settingDir(cfg)
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "config.json")
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	// 写入后缓存，防止后续 GetConfig 因 bootstrap 不存在而读到空配置
	a.cachedCfg = cfg
	return nil
}

// writeConfigAndRescan persists the config, runs a full scan with current settings,
// and writes index.json.
func (a *App) writeConfigAndRescan(cfg *Config) error {
	if err := a.writeConfig(cfg); err != nil {
		return err
	}
	// Scan and write index — pass cfg directly, don't go through ScanModelDir
	// which would re-acquire configMu.RLock() and deadlock (we already hold the write lock).
	models, err := a.scanAllCategories(cfg)
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
	idxPath := filepath.Join(dir, "index.json")
	idxTmpPath := idxPath + ".tmp"
	if err := os.WriteFile(idxTmpPath, idxData, 0644); err != nil {
		return err
	}
	return os.Rename(idxTmpPath, idxPath)
}

// GetLibraryIndex reads the last scanned index from disk.
func (a *App) GetLibraryIndex() ([]ModelEntry, error) {
	// Try setting/ subdirectory first
	cfg, err := a.GetConfig()
	if err != nil {
		return nil, err
	}
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
