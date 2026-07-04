//go:build !android

package app

import (
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

// desktopFileAccessor is a thin wrapper over the os package.
// Zero behavior difference — exists only so call sites use the same
// FileAccessor interface on all platforms.
type desktopFileAccessor struct{}

func newFileAccessor() FileAccessor { return &desktopFileAccessor{} }

func (d *desktopFileAccessor) Stat(path string) (os.FileInfo, error) {
	return os.Stat(path)
}

func (d *desktopFileAccessor) Open(path string) (io.ReadCloser, error) {
	return os.Open(path)
}

func (d *desktopFileAccessor) ReadDir(path string) ([]os.DirEntry, error) {
	return os.ReadDir(path)
}

func (d *desktopFileAccessor) WalkDir(root string, fn fs.WalkDirFunc) error {
	return filepath.WalkDir(root, fn)
}

func (d *desktopFileAccessor) Abs(path string) (string, error) {
	return filepath.Abs(path)
}

func init() {
	fileAccessor = newFileAccessor()
}
