package app

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	stdruntime "runtime"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"

	"mikumikuar/internal/util"
)

// ======== Blender Integration ========

// defaultBlenderCandidates lists common Windows install paths for Blender.
var defaultBlenderCandidates = []string{
	"C:/Program Files/Blender Foundation/Blender 4.3/blender.exe",
	"C:/Program Files/Blender Foundation/Blender 4.2/blender.exe",
	"C:/Program Files/Blender Foundation/Blender 4.1/blender.exe",
	"C:/Program Files/Blender Foundation/Blender 4.0/blender.exe",
	"C:/Program Files/Blender Foundation/Blender 3.6/blender.exe",
	"C:/Program Files/Blender Foundation/Blender/blender.exe",
}

// detectBlender attempts to find Blender on the system.
func detectBlender() string {
	return detectBlenderAt(exec.LookPath, defaultBlenderCandidates)
}

// detectBlenderAt is the testable pure version: tries lookPath then stats candidates.
func detectBlenderAt(lookPath func(name string) (string, error), candidates []string) string {
	if p, err := lookPath("blender"); err == nil {
		return p
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

// OpenInBlender launches Blender and opens the specified model file.
func (a *App) OpenInBlender(modelPath string) error {
	cfg, _ := a.GetConfig()
	blenderPath := cfg.BlenderPath
	if blenderPath == "" {
		blenderPath = detectBlender()
	}
	if blenderPath == "" {
		return fmt.Errorf("未找到 Blender，请在设置中配置路径")
	}

	cmd := exec.Command(blenderPath, modelPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动 Blender 失败")
	}

	a.safeLogInfo("Blender started for %s", modelPath)
	return nil
}

// ======== MikuMikuDance Integration ========

// defaultMMDCandidates lists common Windows install paths for MikuMikuDance.
var defaultMMDCandidates = []string{
	"C:/Program Files/MikuMikuDance/mmd.exe",
	"C:/Program Files/MikuMikuDance/MikuMikuDance.exe",
	"C:/Program Files (x86)/MikuMikuDance/mmd.exe",
	"C:/Program Files (x86)/MikuMikuDance/MikuMikuDance.exe",
}

// detectMMD attempts to find MMD on the system.
func detectMMD() string {
	return detectMMDAt(exec.LookPath, os.Stat, defaultMMDCandidates)
}

// detectMMDAt is the testable pure version: tries lookPath then stats candidates.
func detectMMDAt(lookPath func(name string) (string, error), stat func(name string) (os.FileInfo, error), candidates []string) string {
	if p, err := lookPath("mmd"); err == nil {
		return p
	}
	for _, c := range candidates {
		if _, err := stat(c); err == nil {
			return c
		}
	}
	return ""
}

// SetMMDPath saves the MMD executable path to config.
// If path is empty, automatically detects MMD from common install locations.
func (a *App) SetMMDPath(path string) error {
	return a.updateConfig(func(cfg *Config) { cfg.MMDPath = path }, false)
}

// AutoDetectMMD searches for MMD in common install paths and saves the result.
// Returns the detected path, or an error if not found.
func (a *App) AutoDetectMMD() (string, error) {
	path := detectMMD()
	if path == "" {
		return "", fmt.Errorf("未找到 MikuMikuDance")
	}
	if err := a.SetMMDPath(path); err != nil {
		return "", err
	}
	return path, nil
}

// OpenInMMD launches MikuMikuDance and opens the specified model file.
func (a *App) OpenInMMD(modelPath string) error {
	cfg, _ := a.GetConfig()
	mmdPath := cfg.MMDPath
	if mmdPath == "" {
		mmdPath = detectMMD()
	}
	if mmdPath == "" {
		return fmt.Errorf("未找到 MikuMikuDance，请在设置中配置路径")
	}

	cmd := exec.Command(mmdPath, modelPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动 MMD 失败")
	}

	a.safeLogInfo("MMD started for %s", modelPath)
	return nil
}

// ======== Software Management ========

// detectSoftwareKind infers the software type from filename.
func detectSoftwareKind(name string) string {
	lower := strings.ToLower(name)
	if strings.Contains(lower, "blender") {
		return "blender"
	}
	if strings.Contains(lower, "mmd") || strings.Contains(lower, "mikumikudance") {
		return "mmd"
	}
	if strings.Contains(lower, "pmxeditor") || strings.Contains(lower, "pmx_editor") || strings.Contains(lower, "pmx-editor") {
		return "pmxeditor"
	}
	return "other"
}

// ScanSoftwareDir scans the software/ directory for .exe files, merges with user-added
// custom software from config, and returns the combined list (deduplicated by path).
func (a *App) ScanSoftwareDir() ([]SoftwareEntry, error) {
	dir, err := softwareDir()
	if err != nil {
		return nil, err
	}

	// Scan software/ directory
	scanned := make(map[string]SoftwareEntry)
	entries, err := os.ReadDir(dir)
	if err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			name := entry.Name()
			if !strings.HasSuffix(strings.ToLower(name), ".exe") {
				continue
			}
			ext := filepath.Ext(name)
			displayName := strings.TrimSuffix(name, ext)
			fullPath := filepath.Join(dir, name)
			kind := detectSoftwareKind(displayName)
			scanned[fullPath] = SoftwareEntry{
				Name:    displayName,
				Path:    fullPath,
				Kind:    kind,
				Args:    "",
				Managed: false,
				Icon:    "",
			}
		}
	}

	// Merge custom software from config (custom takes precedence)
	cfg, _ := a.GetConfig()
	if cfg != nil {
		for _, sw := range cfg.CustomSoftware {
			if _, ok := scanned[sw.Path]; ok {
				// Custom overrides scanned entry for all fields
				sw.Managed = true
				scanned[sw.Path] = sw
			} else {
				sw.Managed = true
				scanned[sw.Path] = sw
			}
		}
	}

	result := make([]SoftwareEntry, 0, len(scanned))
	for _, sw := range scanned {
		result = append(result, sw)
	}
	return result, nil
}

// LaunchSoftware starts an executable by path with optional command-line arguments.
// The args string is split into arguments and passed to the executable.
func (a *App) LaunchSoftware(path string, args string) error {
	var cmd *exec.Cmd
	if args == "" {
		cmd = exec.Command(path)
	} else {
		segments := strings.Fields(args)
		cmd = exec.Command(path, segments...)
	}
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动软件失败")
	}
	a.safeLogInfo("Launched software: %s", path)
	return nil
}

// OpenWithSoftware opens a model file with the specified software, replacing {model}
// in the args template with the model path.
// Each {model} token is replaced individually so paths with spaces stay as a single argv.
func (a *App) OpenWithSoftware(modelPath string, softwarePath string, args string) error {
	var cmd *exec.Cmd
	if args == "" {
		cmd = exec.Command(softwarePath)
	} else {
		segments := strings.Fields(args)
		for i, seg := range segments {
			segments[i] = strings.ReplaceAll(seg, "{model}", modelPath)
		}
		cmd = exec.Command(softwarePath, segments...)
	}
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动软件失败")
	}
	a.safeLogInfo("Opened %s with %s", modelPath, softwarePath)
	return nil
}

// AddCustomSoftware adds a user-defined software entry to the config.
func (a *App) AddCustomSoftware(path string, name string, args string) error {
	kind := detectSoftwareKind(name)
	return a.updateConfig(func(cfg *Config) {
		// Remove existing entry with same path
		var kept []SoftwareEntry
		for _, sw := range cfg.CustomSoftware {
			if sw.Path != path {
				kept = append(kept, sw)
			}
		}
		kept = append(kept, SoftwareEntry{
			Name:    name,
			Path:    path,
			Kind:    kind,
			Args:    args,
			Managed: true,
			Icon:    "",
		})
		cfg.CustomSoftware = kept
	}, false)
}

// RemoveCustomSoftware removes a user-defined software entry from the config by path.
func (a *App) RemoveCustomSoftware(path string) error {
	return a.updateConfig(func(cfg *Config) {
		var kept []SoftwareEntry
		for _, sw := range cfg.CustomSoftware {
			if sw.Path != path {
				kept = append(kept, sw)
			}
		}
		cfg.CustomSoftware = kept
	}, false)
}

// UpdateCustomSoftware updates name and args for an existing custom software entry.
func (a *App) UpdateCustomSoftware(path string, name string, args string) error {
	kind := detectSoftwareKind(name)
	return a.updateConfig(func(cfg *Config) {
		for i, sw := range cfg.CustomSoftware {
			if sw.Path == path {
				cfg.CustomSoftware[i].Name = name
				cfg.CustomSoftware[i].Kind = kind
				cfg.CustomSoftware[i].Args = args
				return
			}
		}
	}, false)
}

// OpenSoftwareDir opens the software directory in the system file manager.
func (a *App) OpenSoftwareDir() error {
	dir, err := softwareDir()
	if err != nil {
		return err
	}
	// Ensure the directory exists
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("创建软件目录失败")
	}
	// Cross-platform: open file manager
	var cmd *exec.Cmd
	switch stdruntime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", dir)
	case "darwin":
		cmd = exec.Command("open", dir)
	default:
		cmd = exec.Command("xdg-open", dir)
	}
	return cmd.Start()
}

// SaveSceneFile writes a JSON scene file to the given path.
func (a *App) SaveSceneFile(jsonStr string, path string) error {
	return os.WriteFile(path, []byte(jsonStr), 0644)
}

// LoadSceneFile reads a JSON scene file from the given path.
func (a *App) LoadSceneFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SelectSceneSaveFile opens a save dialog for scene files.
func (a *App) SelectSceneSaveFile() (string, error) {
	if a.wailsApp == nil {
		return "", fmt.Errorf("application not initialized")
	}
	dialog := a.wailsApp.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Title:    "保存场景",
		Filename: "scene.mmascene",
		Filters: []application.FileFilter{
			{DisplayName: "MikuMikuAR Scene (*.mmascene)", Pattern: "*.mmascene"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(path), nil
}

// ======== Env Presets (user-saved .env files) ========

// envPresetsDir returns the directory for user-saved environment presets.
func envPresetsDir() (string, error) {
	return ensureDir("env-presets", false)
}

// sanitizePresetName allows only alphanumerics, dash, underscore, and CJK chars.
// Returns the cleaned name, or empty string if invalid.
func sanitizePresetName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	// Forbid path separators and dangerous chars
	if strings.ContainsAny(name, `/\:*?"<>|`) {
		return ""
	}
	return name
}

// EnvPresetEntry is a catalog item returned by ListEnvPresets.
type EnvPresetEntry struct {
	Name      string `json:"name"`
	Label     string `json:"label"`
	CreatedAt int64  `json:"createdAt"`
}

// SaveEnvPreset writes a .env JSON file under env-presets/<name>.env.
// The name is sanitized; the JSON content is the caller's responsibility.
func (a *App) SaveEnvPreset(name string, jsonStr string) error {
	return util.SafeCallVoid(func() error {
		clean := sanitizePresetName(name)
		if clean == "" {
			return fmt.Errorf("invalid preset name: %q", name)
		}
		dir, err := envPresetsDir()
		if err != nil {
			return err
		}
		path := filepath.Join(dir, clean+".env")
		return os.WriteFile(path, []byte(jsonStr), 0644)
	})
}

// LoadEnvPreset reads a .env JSON file by name.
func (a *App) LoadEnvPreset(name string) (string, error) {
	return util.SafeCall(func() (string, error) {
		clean := sanitizePresetName(name)
		if clean == "" {
			return "", fmt.Errorf("invalid preset name: %q", name)
		}
		dir, err := envPresetsDir()
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
		dir, err := envPresetsDir()
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
			// Read file to extract label (best-effort, ignore errors)
			label := nm
			if data, err := os.ReadFile(filepath.Join(dir, e.Name())); err == nil {
				// Naive label extraction: look for "label":"xxx"
				s := string(data)
				if idx := strings.Index(s, `"label"`); idx >= 0 {
					rest := s[idx+len(`"label"`):]
					rest = strings.TrimLeft(rest, " \t:")
					if strings.HasPrefix(rest, `"`) {
						rest = rest[1:]
						if end := strings.Index(rest, `"`); end >= 0 {
							label = rest[:end]
						}
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
		clean := sanitizePresetName(name)
		if clean == "" {
			return fmt.Errorf("invalid preset name: %q", name)
		}
		dir, err := envPresetsDir()
		if err != nil {
			return err
		}
		path := filepath.Join(dir, clean+".env")
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	})
}

// SelectSceneOpenFile opens a file dialog to pick a scene file.
func (a *App) SelectSceneOpenFile() (string, error) {
	return a.openFileDialog("加载场景", []application.FileFilter{
		{
			DisplayName: "MikuMikuAR Scene (*.mmascene)",
			Pattern:     "*.mmascene",
		},
		{
			DisplayName: "All Files (*.*)",
			Pattern:     "*.*",
		},
	})
}

// SaveLastScene stores the current scene state for auto-recovery on next launch.
func (a *App) SaveLastScene(jsonStr string) error {
	dir, err := configDir()
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "last_scene.json"), []byte(jsonStr), 0644)
}

// LoadLastScene reads the auto-saved scene state.
func (a *App) LoadLastScene() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(dir, "last_scene.json"))
	if err != nil {
		return "", err
	}
	return string(data), nil
}
