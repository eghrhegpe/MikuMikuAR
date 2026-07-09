//go:build !android

package app

import (
	"os"
	"path/filepath"
	stdruntime "runtime"
)

type desktopPathMgr struct{}

func newPlatformPathMgr() PathManager { return &desktopPathMgr{} }

func (d *desktopPathMgr) AppDataRoot() (string, error) {
	return userConfigDir()
}

func (d *desktopPathMgr) CacheRoot() (string, error) {
	return os.UserCacheDir()
}

func (d *desktopPathMgr) ResourceRoot() string {
	switch stdruntime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Documents", "MMD")
	default:
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "MMD")
	}
}

func (d *desktopPathMgr) PrivateResourceRoot() string {
	return d.ResourceRoot()
}

func (d *desktopPathMgr) SharedResourceRoot() string {
	return d.ResourceRoot()
}

// DownloadsDir returns the user's Downloads folder (~/Downloads).
// Empty string if the home directory cannot be resolved.
func (d *desktopPathMgr) DownloadsDir() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, "Downloads")
}
