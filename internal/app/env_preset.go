package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"mikumikuar/internal/util"
)

// ======== Env Presets (user-saved .env files) ========

// envPresetsDir returns the env-presets/ subdirectory under settingDir.
func (a *App) envPresetsDir() (string, error) {
	return a.presetDir("env-presets")
}

// EnvPresetEntry is a catalog item returned by ListEnvPresets.
type EnvPresetEntry struct {
	Name      string `json:"name"`
	Label     string `json:"label"`
	CreatedAt int64  `json:"createdAt"`
}

// SaveEnvPreset writes a .env JSON file under env-presets/<name>.env.
func (a *App) SaveEnvPreset(name string, jsonStr string) error {
	return util.SafeCallVoid(func() error {
		clean := validatePresetName(name)
		if clean == "" {
			return fmt.Errorf("invalid preset name: %q", name)
		}
		dir, err := a.envPresetsDir()
		if err != nil {
			return err
		}
		path := filepath.Join(dir, clean+".env")
		return os.WriteFile(path, []byte(jsonStr), 0644)
	})
}

// SaveEnvPresetAuto writes a .env JSON file under env-presets/<NNN>.env,
// auto-numbered to avoid name collisions.
func (a *App) SaveEnvPresetAuto(jsonStr string) (string, error) {
	return util.SafeCall(func() (string, error) {
		dir, err := a.envPresetsDir()
		if err != nil {
			return "", err
		}
		return autoNumberedSave(dir, "env", jsonStr)
	})
}

// LoadEnvPreset reads a .env JSON file by name.
func (a *App) LoadEnvPreset(name string) (string, error) {
	return util.SafeCall(func() (string, error) {
		clean := validatePresetName(name)
		if clean == "" {
			return "", fmt.Errorf("invalid preset name: %q", name)
		}
		dir, err := a.envPresetsDir()
		if err != nil {
			return "", err
		}
		data, err := os.ReadFile(filepath.Join(dir, clean+".env"))
		if err != nil {
			return "", err
		}
		return string(data), nil
	})
}

// ListEnvPresets returns all user-saved env presets in the presets directory.
func (a *App) ListEnvPresets() ([]EnvPresetEntry, error) {
	return util.SafeCall(func() ([]EnvPresetEntry, error) {
		dir, err := a.envPresetsDir()
		if err != nil {
			return nil, err
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			if os.IsNotExist(err) {
				return []EnvPresetEntry{}, nil
			}
			return nil, err
		}
		result := make([]EnvPresetEntry, 0, len(entries))
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".env") {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			nm := strings.TrimSuffix(e.Name(), ".env")
			label := nm
			path := filepath.Join(dir, e.Name())
			if f, err := os.Open(path); err == nil {
				buf := make([]byte, 1024)
				n, _ := f.Read(buf)
				f.Close()
				if n > 0 {
					var hdr struct {
						Label string `json:"label"`
					}
					if err := json.Unmarshal(buf[:n], &hdr); err == nil && hdr.Label != "" {
						label = hdr.Label
					}
				}
			}
			result = append(result, EnvPresetEntry{
				Name:      nm,
				Label:     label,
				CreatedAt: info.ModTime().Unix(),
			})
		}
		return result, nil
	})
}

// DeleteEnvPreset removes a .env file by name.
func (a *App) DeleteEnvPreset(name string) error {
	return util.SafeCallVoid(func() error {
		dir, err := a.envPresetsDir()
		if err != nil {
			return err
		}
		return deletePresetFile(dir, name, "env")
	})
}