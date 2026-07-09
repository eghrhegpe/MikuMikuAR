package app

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/nwaples/rardecode/v2"
	"mikumikuar/internal/util"
)

// ======== Download Directory Watching (ADR-008) ========

// lowerExt returns the lowercase file extension (including the dot).
func lowerExt(path string) string {
	return strings.ToLower(filepath.Ext(path))
}

// watchExts lists the file extensions that trigger watch notifications.
var watchExts = map[string]bool{
	".zip": true,
	".rar": true,
	".pmx": true,
	".vmd": true,
}

// magicSigs contains the first bytes used to validate file types.
var magicSigs = [][]byte{
	{0x50, 0x4B, 0x03, 0x04},                   // ZIP (PK\x03\x04)
	{0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00}, // RAR (Rar!\x1A\x07\x00)
}

// checkMagicNumber reads the first bytes of a file and checks against known signatures.
// Returns true if the file header matches a known archive format.
func checkMagicNumber(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	header := make([]byte, 8)
	n, err := f.Read(header)
	if err != nil || n < 4 {
		return false
	}
	for _, sig := range magicSigs {
		if len(header) >= len(sig) {
			match := true
			for i, b := range sig {
				if header[i] != b {
					match = false
					break
				}
			}
			if match {
				return true
			}
		}
	}
	return false
}

// ImportLocalFile imports a local file into the model library.
// - .pmx/.zip: 复制原档到 PMX/（zip 由 ScanModelDir 的 expandZipEntries 展开条目）
// - .rar: 解压全部内容到 PMX/<rarBase>/（ScanModelDir 直接扫到解压后的 .pmx）
// - .vmd: 复制到 VMD/，.vpd: 复制到 pose/
// 导入后 ScanModelDir 能扫到。不加载到 3D 场景——加载是用户从库中选择的独立动作。
func (a *App) ImportLocalFile(path string) (*ExtractResult, error) {
	const op = "ImportLocalFile"
	return util.SafeCall(func() (*ExtractResult, error) {
		ext := lowerExt(path)
		var catKey string
		switch ext {
		case ".pmx", ".zip":
			catKey = "pmx"
		case ".rar":
			return a.importRarToLibrary(path)
		case ".vmd":
			catKey = "vmd"
		case ".vpd":
			catKey = "pose"
		default:
			return nil, fmt.Errorf("不支持的文件格式: %s", ext)
		}

		cfg, err := a.GetConfig()
		if err != nil {
			return nil, util.WrapErrorf(op, "读取配置失败", err)
		}
		// GetPath 解析 OverridePaths（如 PMX/），与 ScanModelDir 扫描路径一致
		destDir := a.GetPath(cfg, catKey)
		if err := os.MkdirAll(destDir, 0o755); err != nil {
			return nil, util.WrapErrorf(op, "创建目录失败", err)
		}

		fileName := filepath.Base(path)
		destPath := filepath.Join(destDir, fileName)

		// 同名去重：已存在且大小相同则跳过复制
		if info, err := os.Stat(destPath); err == nil {
			srcInfo, _ := os.Stat(path)
			if srcInfo != nil && info.Size() == srcInfo.Size() {
				a.safeLogInfo("ImportLocalFile: 已存在（跳过）%s", destPath)
				return &ExtractResult{FilePath: filepath.ToSlash(destPath), Dir: filepath.ToSlash(destDir)}, nil
			}
		}

		if err := copyFileToLocal(path, destPath); err != nil {
			return nil, util.WrapErrorf(op, "复制文件失败", err)
		}
		a.safeLogInfo("ImportLocalFile: %s → %s", path, destPath)
		return &ExtractResult{FilePath: filepath.ToSlash(destPath), Dir: filepath.ToSlash(destDir)}, nil
	})
}

// importRarToLibrary 解压 rar 全部内容到 PMX/<rarBase>/ 目录。
// rar 无法像 zip 那样延迟展开，直接解压后 ScanModelDir 扫描解压目录即可。
func (a *App) importRarToLibrary(rarPath string) (*ExtractResult, error) {
	const op = "ImportLocalFile.rar"
	cfg, err := a.GetConfig()
	if err != nil {
		return nil, util.WrapErrorf(op, "读取配置失败", err)
	}
	pmxDir := a.GetPath(cfg, "pmx")

	// 以 rar 文件名（去扩展名）作为子目录名，隔离不同模型的文件
	rarBase := strings.TrimSuffix(filepath.Base(rarPath), lowerExt(rarPath))
	destDir := filepath.Join(pmxDir, rarBase)

	// 已存在则跳过（避免重复解压）
	if info, err := os.Stat(destDir); err == nil && info.IsDir() {
		// 检查目录下是否有 .pmx，有则认为已解压过
		a.safeLogInfo("ImportLocalFile.rar: 已存在（跳过）%s", destDir)
		return &ExtractResult{FilePath: filepath.ToSlash(destDir), Dir: filepath.ToSlash(destDir)}, nil
	}

	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return nil, util.WrapErrorf(op, "创建目录失败", err)
	}

	rr, err := rardecode.OpenReader(rarPath)
	if err != nil {
		os.RemoveAll(destDir) // 解压失败清理空目录
		return nil, util.WrapErrorf(op, "打开 rar 失败", err)
	}
	defer rr.Close()

	var firstPMX string
	extractedCount := 0
	for {
		hdr, err := rr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			os.RemoveAll(destDir)
			return nil, util.WrapErrorf(op, "读取 rar 条目失败", err)
		}
		if hdr.IsDir {
			continue
		}

		// Zip slip 防护：拒绝逃逸 destDir 的路径
		entryName := hdr.Name
		// 反斜杠统一为正斜杠（rar 内可能用 \ 分隔）
		entryName = strings.ReplaceAll(entryName, "\\", "/")
		// 清理 .. 等危险路径
		cleanPath := filepath.Clean(filepath.ToSlash(entryName))
		if strings.HasPrefix(cleanPath, "../") || cleanPath == ".." {
			a.safeLogWarning("ImportLocalFile.rar: zip slip blocked: %s", entryName)
			continue
		}
		targetAbs := filepath.Join(destDir, cleanPath)
		destAbs, err := filepath.Abs(targetAbs)
		if err != nil {
			continue
		}
		destPrefix, err := filepath.Abs(destDir)
		if err != nil {
			continue
		}
		destPrefixSlash := filepath.ToSlash(destPrefix) + "/"
		if !strings.HasPrefix(filepath.ToSlash(destAbs), destPrefixSlash) {
			a.safeLogWarning("ImportLocalFile.rar: zip slip blocked: %s", entryName)
			continue
		}

		if err := os.MkdirAll(filepath.Dir(targetAbs), 0o755); err != nil {
			continue
		}

		out, err := os.Create(targetAbs)
		if err != nil {
			continue
		}
		if _, err := io.Copy(out, rr); err != nil {
			out.Close()
			continue
		}
		out.Close()
		extractedCount++

		// 记录第一个 .pmx 文件路径（作为返回值）
		if firstPMX == "" && strings.HasSuffix(strings.ToLower(cleanPath), ".pmx") {
			firstPMX = filepath.ToSlash(targetAbs)
		}
	}

	if firstPMX == "" {
		a.safeLogWarning("ImportLocalFile.rar: 未找到 .pmx 文件 (%s)", rarPath)
	}
	a.safeLogInfo("ImportLocalFile.rar: %s → %s (%d files)", rarPath, destDir, extractedCount)
	return &ExtractResult{FilePath: firstPMX, Dir: filepath.ToSlash(destDir)}, nil
}

// copyFileToLocal copies a file from src to dst, creating parent dirs as needed.
func copyFileToLocal(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return nil
}

// StartWatchDir starts fsnotify-based watching on the specified directory.
// If already watching a directory, it stops the previous watcher first.
// Only files with .zip/.pmx/.vmd extensions trigger notifications,
// filtered through Magic Number detection to skip incomplete downloads.
// On Android, file system watching is not supported — returns an error.
func (a *App) StartWatchDir(dir string) error {
	if isAndroid {
		return fmt.Errorf("Android 不支持文件系统监听，请手动导入文件")
	}
	a.watchMu.Lock()
	defer a.watchMu.Unlock()

	// Stop existing watcher
	if a.watcher != nil {
		a.watcher.Close()
		a.watcher = nil
		if a.watchTimer != nil {
			a.watchTimer.Stop()
			a.watchTimer = nil
		}
		a.watchPending = nil
	}

	// Verify directory exists
	info, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("监听目录不可访问")
	}
	if !info.IsDir() {
		return fmt.Errorf("路径不是目录: %s", dir)
	}

	// Create new watcher
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("创建文件监听器失败")
	}
	if err := w.Add(dir); err != nil {
		w.Close()
		return fmt.Errorf("添加监听目录失败")
	}

	a.watcher = w
	a.watchDir = dir
	a.watchPending = make(map[string]struct{})

	// Start the watch loop goroutine
	go a.watchLoop(w)

	a.safeLogInfo("StartWatchDir: 开始监听 %s", dir)
	return nil
}

// StopWatchDir stops the current directory watcher.
func (a *App) StopWatchDir() error {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()

	if a.watcher == nil {
		return nil // not watching
	}

	a.watcher.Close()
	a.watcher = nil
	a.watchDir = ""
	if a.watchTimer != nil {
		a.watchTimer.Stop()
		a.watchTimer = nil
	}
	a.watchPending = nil

	a.safeLogInfo("StopWatchDir: 已停止监听")
	return nil
}

// SetDownloadWatchDir persists the download watch directory to config
// and restarts the watcher (if dir is non-empty) or stops it (if dir is empty).
// Selecting a non-empty directory implicitly enables watching.
func (a *App) SetDownloadWatchDir(dir string) error {
	// Stop current watcher first
	_ = a.StopWatchDir()

	// Persist to config
	err := a.updateConfig(func(cfg *Config) {
		cfg.DownloadWatchDir = dir
		if dir != "" {
			cfg.DownloadWatchEnabled = true // 选目录即隐含启用
		}
		cfg.DownloadWatchInitialized = true
	}, false)
	if err != nil {
		return err
	}

	// Start if dir is non-empty
	if dir != "" {
		return a.StartWatchDir(dir)
	}
	return nil
}

// SetDownloadWatchEnabled toggles directory watching without clearing the
// configured directory. When enabling with no dir set, falls back to the
// user's Downloads folder (auto-created).
func (a *App) SetDownloadWatchEnabled(enabled bool) error {
	if err := a.updateConfig(func(cfg *Config) {
		cfg.DownloadWatchEnabled = enabled
		cfg.DownloadWatchInitialized = true
	}, false); err != nil {
		a.safeLogError("SetDownloadWatchEnabled: 写入失败 %v", err)
		return err
	}
	a.safeLogInfo("SetDownloadWatchEnabled: enabled=%v", enabled)
	if !enabled {
		return a.StopWatchDir()
	}
	cfg, err := a.GetConfig()
	if err != nil {
		return err
	}
	dir := cfg.DownloadWatchDir
	if dir == "" {
		dir = platformPathMgr.DownloadsDir()
		if dir == "" {
			return nil // Android 或无法解析 home：静默放弃
		}
		_ = os.MkdirAll(dir, 0o755)
		_ = a.updateConfig(func(c *Config) { c.DownloadWatchDir = dir }, false)
	}
	return a.StartWatchDir(dir)
}

// GetDownloadWatchEnabled returns whether download watching is enabled in config.
func (a *App) GetDownloadWatchEnabled() bool {
	cfg, err := a.GetConfig()
	if err != nil {
		return false
	}
	return cfg.DownloadWatchEnabled
}

// SetDownloadAutoImport persists the auto-import preference to config.
func (a *App) SetDownloadAutoImport(auto bool) error {
	if err := a.updateConfig(func(cfg *Config) {
		cfg.DownloadAutoImport = auto
	}, false); err != nil {
		a.safeLogError("SetDownloadAutoImport: 写入失败 %v", err)
		return err
	}
	a.safeLogInfo("SetDownloadAutoImport: auto=%v", auto)
	return nil
}

// GetDownloadAutoImport returns the current auto-import preference from config.
func (a *App) GetDownloadAutoImport() bool {
	cfg, err := a.GetConfig()
	if err != nil {
		return false
	}
	return cfg.DownloadAutoImport
}

// GetDownloadWatchStatus returns the current watch state (directory being watched or empty string).
func (a *App) GetDownloadWatchStatus() string {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	return a.watchDir
}

// watchLoop processes fsnotify events with 800ms debounce.
// It filters for Create/Write events on files with known extensions,
// validates Magic Number, and emits watch:newfile events to the frontend.
func (a *App) watchLoop(w *fsnotify.Watcher) {
	for {
		select {
		case event, ok := <-w.Events:
			if !ok {
				return
			}
			// Only interested in Create and Write events
			if event.Op&(fsnotify.Create|fsnotify.Write) == 0 {
				continue
			}
			// Check extension
			ext := lowerExt(event.Name)
			if !watchExts[ext] {
				continue
			}
			// Validate Magic Number (skip incomplete/corrupt files)
			if !checkMagicNumber(event.Name) {
				continue
			}
			// Store pending file
			a.watchMu.Lock()
			a.watchPending[event.Name] = struct{}{}
			// Reset debounce timer
			if a.watchTimer != nil {
				a.watchTimer.Stop()
			}
			a.watchTimer = time.AfterFunc(800*time.Millisecond, func() {
				a.flushPending()
			})
			a.watchMu.Unlock()

		case err, ok := <-w.Errors:
			if !ok {
				return
			}
			a.safeLogError("watchLoop error: %v", err)
		}
	}
}

// flushPending processes all pending files accumulated during the debounce window.
func (a *App) flushPending() {
	a.watchMu.Lock()
	pending := a.watchPending
	a.watchPending = make(map[string]struct{})
	if a.watchTimer != nil {
		a.watchTimer.Stop()
		a.watchTimer = nil
	}
	a.watchMu.Unlock()

	for path := range pending {
		a.notifyNewFile(path)
	}
}

// notifyNewFile emits a watch:newfile event to the frontend with the detected file info.
func (a *App) notifyNewFile(filePath string) {
	name := filepath.Base(filePath)
	ext := lowerExt(filePath)
	fileType := "zip"
	if ext == ".rar" {
		fileType = "rar"
	} else if ext == ".pmx" {
		fileType = "model"
	} else if ext == ".vmd" {
		fileType = "motion"
	}

	payload := map[string]string{
		"path": filePath,
		"name": name,
		"type": fileType,
	}
	if a.wailsApp != nil {
		a.wailsApp.Event.Emit("watch:newfile", payload)
	}
}

// restoreWatcher resumes directory watching from saved config on startup.
// Applies the first-run default (Downloads/ + enabled) exactly once before restoring.
func (a *App) restoreWatcher() {
	if isAndroid {
		return
	}
	a.ensureDefaultWatchDir()
	cfg, err := a.GetConfig()
	if err != nil || !cfg.DownloadWatchEnabled || cfg.DownloadWatchDir == "" {
		return
	}
	if err := a.StartWatchDir(cfg.DownloadWatchDir); err != nil {
		a.safeLogError("restoreWatcher: 恢复监听失败 %s: %v", cfg.DownloadWatchDir, err)
	}
}

// ensureDefaultWatchDir applies the first-run default watch directory exactly once.
// Points DownloadWatchDir at the user's Downloads folder and enables watching,
// so the aplaybox external flow is 拉起即用 (ADR-003). Respects prior user config:
// once DownloadWatchInitialized is true, never re-default (user explicit disable sticks).
func (a *App) ensureDefaultWatchDir() {
	if isAndroid {
		return
	}
	cfg, err := a.GetConfig()
	if err != nil || cfg.DownloadWatchInitialized {
		return
	}
	dir := platformPathMgr.DownloadsDir()
	if dir != "" {
		_ = os.MkdirAll(dir, 0o755)
	}
	_ = a.updateConfig(func(c *Config) {
		if c.DownloadWatchDir == "" && dir != "" {
			c.DownloadWatchDir = dir
		}
		// 存量用户已有 dir → 保持启用；新用户 → 默认启用
		c.DownloadWatchEnabled = (c.DownloadWatchDir != "")
		c.DownloadWatchInitialized = true
	}, false)
}
