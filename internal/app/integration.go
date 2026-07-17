package app

import (
	"os"
	"os/exec"
	"path/filepath"
	stdruntime "runtime"
	"strings"

	"mikumikuar/internal/i18nerr"
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
		return i18nerr.New("software.androidNotSupported", "Blender 不可在 Android 上启动", map[string]string{"name": "Blender"})
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
		return i18nerr.New("software.notFound", "未找到 Blender，请在设置中配置路径", map[string]string{"name": "Blender"})
	}

	cmd := exec.Command(blenderPath, modelPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return i18nerr.New("software.launchFailed", "启动 Blender 失败", map[string]string{"name": "Blender"})
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
		return i18nerr.New("software.androidNotSupported", "MikuMikuDance 不可在 Android 上启动", map[string]string{"name": "MikuMikuDance"})
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
		return i18nerr.New("software.notFound", "未找到 MikuMikuDance，请在设置中配置路径", map[string]string{"name": "MikuMikuDance"})
	}

	cmd := exec.Command(mmdPath, modelPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return i18nerr.New("software.launchFailed", "启动 MMD 失败", map[string]string{"name": "MikuMikuDance"})
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
		return i18nerr.New("software.androidNotSupported", "Android 不支持直接启动外部可执行文件")
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
		return i18nerr.New("software.launchFailed", "启动软件失败")
	}
	a.safeLogInfo("Launched software: %s", path)
	return nil
}

// OpenWithSoftware opens a model file with the specified software, replacing {model}
// in the args template with the model path.
// Each {model} token is replaced individually so paths with spaces stay as a single argv.
func (a *App) OpenWithSoftware(modelPath string, softwarePath string, args string) error {
	if isAndroid {
		return i18nerr.New("software.androidNotSupported", "Android 不支持直接启动外部可执行文件")
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
		return i18nerr.New("software.launchFailed", "启动软件失败")
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
		return i18nerr.New("config.readFailed", "读取配置失败")
	}
	dir := cfg.UIState.ScreenshotDir
	if dir == "" {
		return i18nerr.New("screenshot.dirNotSet", "尚未设置截图保存目录，请先截图一次")
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return i18nerr.New("screenshot.dirCreateFailed", "创建截图目录失败")
	}
	var cmd *exec.Cmd
	switch stdruntime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", dir)
	case "darwin":
		cmd = exec.Command("open", dir)
	case "android":
		return i18nerr.New("screenshot.androidNotSupported", "Android 不支持打开截图目录")
	default:
		cmd = exec.Command("xdg-open", dir)
	}
	return cmd.Start()
}
