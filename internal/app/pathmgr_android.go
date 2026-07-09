//go:build android

package app

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

func (a *androidPathMgr) PrivateResourceRoot() string {
	return "/storage/emulated/0/Android/data/com.mikumikuar.app/files/MMD"
}

func (a *androidPathMgr) SharedResourceRoot() string {
	return "/sdcard/MMD"
}

// DownloadsDir returns "" on Android — fsnotify 不支持，下载监听走手动导入。
func (a *androidPathMgr) DownloadsDir() string {
	return ""
}
