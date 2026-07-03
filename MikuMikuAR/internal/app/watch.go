package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
)

// ======== Download Directory Watching (ADR-008) ========

// watchExts lists the file extensions that trigger watch notifications.
var watchExts = map[string]bool{
	".zip": true,
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
// For .zip files, it finds the first .pmx inside and extracts via ImportZip.
// For .pmx/.vmd files, it returns the path directly as an ExtractResult.
func (a *App) ImportLocalFile(path string) (*ExtractResult, error) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".zip":
		return a.ImportZip(path)
	case ".pmx", ".vmd":
		return &ExtractResult{FilePath: path, Dir: filepath.Dir(path)}, nil
	default:
		return nil, fmt.Errorf("不支持的文件格式: %s", ext)
	}
}

// StartWatchDir starts fsnotify-based watching on the specified directory.
// If already watching a directory, it stops the previous watcher first.
// Only files with .zip/.pmx/.vmd extensions trigger notifications,
// filtered through Magic Number detection to skip incomplete downloads.
func (a *App) StartWatchDir(dir string) error {
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
func (a *App) SetDownloadWatchDir(dir string) error {
	// Stop current watcher first
	_ = a.StopWatchDir()

	// Persist to config
	err := a.updateConfig(func(cfg *Config) {
		cfg.DownloadWatchDir = dir
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

// SetDownloadAutoImport persists the auto-import preference to config.
func (a *App) SetDownloadAutoImport(auto bool) error {
	return a.updateConfig(func(cfg *Config) {
		cfg.DownloadAutoImport = auto
	}, false)
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
			ext := strings.ToLower(filepath.Ext(event.Name))
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
	ext := strings.ToLower(filepath.Ext(filePath))
	fileType := "zip"
	if ext == ".pmx" {
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
// Called during app startup.
func (a *App) restoreWatcher() {
	cfg, err := a.GetConfig()
	if err != nil || cfg == nil || cfg.DownloadWatchDir == "" {
		return
	}
	if err := a.StartWatchDir(cfg.DownloadWatchDir); err != nil {
		a.safeLogError("restoreWatcher: 恢复监听失败 %s: %v", cfg.DownloadWatchDir, err)
	}
}
