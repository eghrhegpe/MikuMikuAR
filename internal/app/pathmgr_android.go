//go:build android

package app

import (
	"os"
	"path/filepath"
)

type androidPathMgr struct{}

func newPlatformPathMgr() PathManager { return &androidPathMgr{} }

func (a *androidPathMgr) AppDataRoot() (string, error) {
	return "/data/data/com.mikumikuar.app/files", nil
}

func (a *androidPathMgr) CacheRoot() (string, error) {
	return "/data/data/com.mikumikuar.app/cache", nil
}

func (a *androidPathMgr) ResourceRoot() string {
	return "/storage/emulated/0/Android/data/com.mikumikuar.app/files/MMD"
}
