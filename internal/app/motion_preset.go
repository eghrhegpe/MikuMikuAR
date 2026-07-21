package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"mikumikuar/internal/dialogs"
)

// ======== Motion Preset CRUD ========
// [doc:adr-145] 多模块协同预设持久化
// 文件后缀 .mcpreset.json，存储在 settingDir/motion/ 下

// SaveMotionPreset writes a JSON motion preset file to the given path.
func (a *App) SaveMotionPreset(jsonStr string, path string) error {
	return os.WriteFile(path, []byte(jsonStr), 0644)
}

// LoadMotionPreset reads a JSON motion preset file from the given path.
func (a *App) LoadMotionPreset(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SelectMotionPresetSaveFile opens a save dialog for motion preset files.
func (a *App) SelectMotionPresetSaveFile() (string, error) {
	return a.selectFile("motion-preset", dialogs.SelectMotionPresetSave)
}

// SelectMotionPresetOpenFile opens a file dialog to pick a motion preset file.
func (a *App) SelectMotionPresetOpenFile() (string, error) {
	return a.selectFile("motion-preset", dialogs.SelectMotionPresetOpen)
}

// MotionPresetEntry is a listing entry for a motion preset in the library.
type MotionPresetEntry struct {
	Name       string `json:"name"`
	PresetName string `json:"presetName"`
	ModelName  string `json:"modelName"`
	ModelRef   string `json:"modelRef"`
	UpdatedAt  int64  `json:"updatedAt"`
}

// motionPresetDir returns the motion/ subdirectory under settingDir.
func (a *App) motionPresetDir() (string, error) {
	return a.presetDir("motion")
}

// GetMotionPresets lists all .mcpreset.json files in the motion presets directory.
func (a *App) GetMotionPresets() []MotionPresetEntry {
	dir, err := a.motionPresetDir()
	if err != nil {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var result []MotionPresetEntry
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".mcpreset.json") {
			continue
		}
		name := strings.TrimSuffix(e.Name(), ".mcpreset.json")
		info, err := e.Info()
		if err != nil {
			continue
		}
		entry := MotionPresetEntry{
			Name:      name,
			UpdatedAt: info.ModTime().Unix(),
		}
		// Read only first 1KB to extract header fields (presetName, model info)
		path := filepath.Join(dir, e.Name())
		if f, err := os.Open(path); err == nil {
			buf := make([]byte, 1024)
			n, _ := f.Read(buf)
			f.Close()
			if n > 0 {
				var hdr struct {
					PresetName string `json:"presetName"`
					Preset     struct {
						Name string `json:"name"`
					} `json:"preset"`
				}
				if err := json.Unmarshal(buf[:n], &hdr); err == nil {
					entry.PresetName = hdr.PresetName
					if entry.PresetName == "" {
						entry.PresetName = hdr.Preset.Name
					}
				}
			}
		}
		result = append(result, entry)
	}
	return result
}

// SaveMotionPresetToLibAuto saves a motion preset JSON as an auto-numbered .mcpreset.json in the motion presets directory.
// Returns the generated filename (e.g. "003.mcpreset.json").
func (a *App) SaveMotionPresetToLibAuto(jsonStr string) (string, error) {
	dir, err := a.motionPresetDir()
	if err != nil {
		return "", err
	}
	return autoNumberedSave(dir, "mcpreset.json", jsonStr)
}

// SaveMotionPresetToLib saves a motion preset JSON to the library with the given name.
func (a *App) SaveMotionPresetToLib(name string, jsonStr string) error {
	clean := validatePresetName(name)
	if clean == "" {
		return fmt.Errorf("invalid preset name: %q", name)
	}
	dir, err := a.motionPresetDir()
	if err != nil {
		return err
	}
	path := filepath.Join(dir, clean+".mcpreset.json")
	return os.WriteFile(path, []byte(jsonStr), 0644)
}

// LoadMotionPresetFromLib reads a motion preset JSON from the library by name.
func (a *App) LoadMotionPresetFromLib(name string) (string, error) {
	clean := validatePresetName(name)
	if clean == "" {
		return "", fmt.Errorf("invalid preset name: %q", name)
	}
	dir, err := a.motionPresetDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, clean+".mcpreset.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// DeleteMotionPreset removes a named motion preset from the library.
func (a *App) DeleteMotionPreset(name string) error {
	dir, err := a.motionPresetDir()
	if err != nil {
		return err
	}
	return deletePresetFile(dir, name, "mcpreset.json")
}

// RenameMotionPreset renames a motion preset in the library.
func (a *App) RenameMotionPreset(oldName, newName string) error {
	cleanOld := validatePresetName(oldName)
	cleanNew := validatePresetName(newName)
	if cleanOld == "" || cleanNew == "" {
		return fmt.Errorf("invalid preset name")
	}
	dir, err := a.motionPresetDir()
	if err != nil {
		return err
	}
	oldPath := filepath.Join(dir, cleanOld+".mcpreset.json")
	newPath := filepath.Join(dir, cleanNew+".mcpreset.json")
	return os.Rename(oldPath, newPath)
}
