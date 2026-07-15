package app

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	stdruntime "runtime"
	"strings"

	"mikumikuar/internal/dialogs"
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
	if isAndroid {
		return fmt.Errorf("Blender 不可在 Android 上启动")
	}
	cfg, err := a.GetConfig()
	if err != nil {
		return err
	}
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

// OpenInMMD launches MikuMikuDance and opens the specified model file.
func (a *App) OpenInMMD(modelPath string) error {
	if isAndroid {
		return fmt.Errorf("MikuMikuDance 不可在 Android 上启动")
	}
	cfg, err := a.GetConfig()
	if err != nil {
		return err
	}
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
// On Android, only returns config-persisted entries (no .exe scanning).
func (a *App) ScanSoftwareDir() ([]SoftwareEntry, error) {
	dir, err := softwareDir()
	if err != nil {
		return nil, err
	}

	// Android: skip .exe directory scan, only return config entries
	if isAndroid {
		scanned := make(map[string]SoftwareEntry)
		cfg, err := a.GetConfig()
		if err != nil {
			return nil, err
		}
		for _, sw := range cfg.CustomSoftware {
			sw.Managed = true
			scanned[sw.Path] = sw
		}
		result := make([]SoftwareEntry, 0, len(scanned))
		for _, sw := range scanned {
			result = append(result, sw)
		}
		return result, nil
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
	cfg, err := a.GetConfig()
	if err != nil {
		return nil, err
	}
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

	result := make([]SoftwareEntry, 0, len(scanned))
	for _, sw := range scanned {
		result = append(result, sw)
	}
	return result, nil
}

// LaunchSoftware starts an executable by path with optional command-line arguments.
// The args string is split into arguments and passed to the executable.
func (a *App) LaunchSoftware(path string, args string) error {
	if isAndroid {
		return fmt.Errorf("Android 不支持直接启动外部可执行文件")
	}
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
	if isAndroid {
		return fmt.Errorf("Android 不支持直接启动外部可执行文件")
	}
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

// OpenScreenshotDir opens the screenshot save directory in the system file manager.
// If no directory has been set, it returns an error prompting the user to take a screenshot first.
func (a *App) OpenScreenshotDir() error {
	cfg, err := a.GetConfig()
	if err != nil {
		return fmt.Errorf("读取配置失败")
	}
	dir := cfg.UIState.ScreenshotDir
	if dir == "" {
		return fmt.Errorf("尚未设置截图保存目录，请先截图一次")
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("创建截图目录失败")
	}
	var cmd *exec.Cmd
	switch stdruntime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", dir)
	case "darwin":
		cmd = exec.Command("open", dir)
	case "android":
		return fmt.Errorf("截图目录: %s", dir)
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

// ======== Env Presets (user-saved .env files) ========

// envPresetsDir returns the env-presets/ subdirectory under settingDir.
// In portable mode (ResourceRoot set), presets live under <ResourceRoot>/setting/env-presets/.
func (a *App) envPresetsDir() (string, error) {
	cfg, err := a.GetConfig()
	if err != nil {
		return "", err
	}
	base, err := settingDir(cfg)
	if err != nil {
		return "", err
	}
	presetDir := filepath.Join(base, "env-presets")
	if err := os.MkdirAll(presetDir, 0755); err != nil {
		return "", err
	}
	return presetDir, nil
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
// auto-numbered to avoid name collisions. Returns the generated name without
// extension (e.g. "001", "002"). Mirrors SaveScenePreset's behaviour.
func (a *App) SaveEnvPresetAuto(jsonStr string) (string, error) {
	return util.SafeCall(func() (string, error) {
		dir, err := a.envPresetsDir()
		if err != nil {
			return "", err
		}
		// Find the next available number
		next := 1
		entries, _ := os.ReadDir(dir)
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".env") {
				var n int
				if _, err := fmt.Sscanf(e.Name(), "%d.env", &n); err == nil && n >= next {
					next = n + 1
				}
			}
		}
		filename := fmt.Sprintf("%03d.env", next)
		path := filepath.Join(dir, filename)
		if err := os.WriteFile(path, []byte(jsonStr), 0644); err != nil {
			return "", err
		}
		return filename, nil
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
			// Read first 1KB to extract label (best-effort)
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
		clean := validatePresetName(name)
		if clean == "" {
			return fmt.Errorf("invalid preset name: %q", name)
		}
		dir, err := a.envPresetsDir()
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
	path, err := dialogs.SelectSceneOpen(a.wailsApp, a.getLastDir("scene"))
	if err != nil || path == "" {
		return path, err
	}
	a.setLastDir("scene", filepath.Dir(path))
	return path, nil
}

// SaveLastScene stores the current scene state for auto-recovery on next launch.
func (a *App) SaveLastScene(jsonStr string) error {
	dir, err := configDir()
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "last_scene.json")
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.WriteString(jsonStr); err != nil {
		return err
	}
	return f.Sync()
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

// ======== Scene Bundle (zip packaging) ========

// BundleScene packages a scene JSON + all referenced asset files into a zip.
// sceneJSON: the rewritten SceneFile JSON (libraryRef pointing to assets/ inside the bundle).
// assetPaths: deduplicated absolute paths of files to include.
// Each asset is stored at "assets/<relativeFromRoot>" preserving directory structure.
func (a *App) BundleScene(targetPath string, sceneJSON string, assetPaths []string) error {
	f, err := os.Create(targetPath)
	if err != nil {
		return fmt.Errorf("create bundle file: %w", err)
	}
	defer f.Close()

	zw := zip.NewWriter(f)
	defer zw.Close()

	// Write scene.json
	sw, err := zw.Create("scene.json")
	if err != nil {
		return fmt.Errorf("create scene.json in zip: %w", err)
	}
	if _, err := sw.Write([]byte(sceneJSON)); err != nil {
		return fmt.Errorf("write scene.json: %w", err)
	}

	// Determine the best library root for computing relative paths.
	// We try all category paths (respecting overrides) and pick the longest
	// matching prefix, so models in override directories keep their structure.
	cfg, err := a.GetConfig()
	if err != nil {
		return err
	}
	libRoot := a.findBestLibRoot(cfg, assetPaths)

	// Expand asset paths: a PMX references textures/material maps by relative
	// paths that are NOT listed in the scene file. Walk each asset's parent
	// directory (recursively, bounded to the model folder) and include sibling
	// files with known texture/material extensions so the imported model keeps
	// its textures. See AR review #2.
	allPaths := expandBundleAssets(assetPaths)

	// Write each asset file
	for _, absPath := range allPaths {
		rel := _bundleRelPath(absPath, libRoot)
		_ = _copyFileToZip(zw, absPath, "assets/"+rel)
	}

	return nil
}

// _bundleTextureExts are file extensions (lower-case, with leading dot) that a
// PMX/model may reference as textures or material maps. When bundling we include
// sibling files with these extensions so the imported model keeps its appearance.
// Other unrelated files in the model folder are skipped to avoid bloating the bundle.
var _bundleTextureExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".bmp": true,
	".tga": true, ".dds": true, ".webp": true, ".svg": true,
	".tif": true, ".tiff": true, ".spa": true, ".sph": true,
	".toon": true,
}

// expandBundleAssets returns the input paths plus sibling texture/material files
// found by recursively walking each path's parent directory (the model folder).
// Results are de-duplicated. Walks are bounded to the model folder so we never
// scan the entire library.
func expandBundleAssets(assetPaths []string) []string {
	seen := make(map[string]bool)
	out := make([]string, 0, len(assetPaths))
	add := func(p string) {
		norm := filepath.ToSlash(p)
		if seen[norm] {
			return
		}
		seen[norm] = true
		out = append(out, p)
	}
	for _, p := range assetPaths {
		add(p)
		dir := filepath.Dir(p)
		_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil // 跳过无法访问的目录
			}
			if d.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(path))
			if _bundleTextureExts[ext] {
				add(path)
			}
			return nil
		})
	}
	return out
}

// findBestLibRoot finds the longest directory path that is a prefix of most
// asset paths among all category paths (respecting OverridePaths).
// Returns empty string if no root contains any of the paths.
func (a *App) findBestLibRoot(cfg *Config, assetPaths []string) string {
	candidates := []string{}
	cats := []string{"pmx", "vmd", "audio", "stage", "prop", "environment", "md_dress", "setting"}
	for _, cat := range cats {
		candidates = append(candidates, a.GetPath(cfg, cat))
	}
	bestRoot := ""
	bestCount := 0
	for _, root := range candidates {
		if root == "" {
			continue
		}
		count := 0
		rootNorm := filepath.ToSlash(root) + "/"
		for _, p := range assetPaths {
			if strings.HasPrefix(filepath.ToSlash(p), rootNorm) {
				count++
			}
		}
		if count > bestCount || (count == bestCount && len(root) > len(bestRoot)) {
			bestRoot = root
			bestCount = count
		}
	}
	return bestRoot
}

// _bundleRelPath computes the relative path for a bundle asset.
func _bundleRelPath(absPath string, libRoot string) string {
	normalised := filepath.ToSlash(absPath)
	if libRoot != "" {
		libNorm := filepath.ToSlash(libRoot)
		if strings.HasPrefix(normalised, libNorm+"/") {
			return normalised[len(libNorm)+1:]
		}
	}
	return filepath.Base(absPath)
}

// _copyFileToZip copies a file into a zip archive at the given entry path.
func _copyFileToZip(zw *zip.Writer, srcPath string, entryPath string) error {
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	info, err := src.Stat()
	if err != nil {
		return err
	}

	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	header.Name = entryPath
	header.Method = zip.Deflate

	w, err := zw.CreateHeader(header)
	if err != nil {
		return err
	}
	_, err = io.Copy(w, src)
	return err
}

// SelectBundleSaveFile opens a save dialog for scene bundle files.
func (a *App) SelectBundleSaveFile() (string, error) {
	path, err := dialogs.SelectBundleSave(a.wailsApp, a.getLastDir("scene"))
	if err != nil || path == "" {
		return path, err
	}
	a.setLastDir("scene", filepath.Dir(path))
	return path, nil
}
