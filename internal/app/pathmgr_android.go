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

// DownloadsDir 返回系统下载目录（shared 模式下经 MANAGE_EXTERNAL_STORAGE 可访问）。
// [doc:adr-195] 原返回 ""（旧 watchDir 时代"下载监听不支持"），现改为请求系统下载文件夹：
// 安卓复用 shared 模式（无需 SAF），与读 /sdcard/MMD 同一套 os.ReadDir 权限。
// 注意：private 模式下不可达，调用方需先切 shared 或提示用户。
func (a *androidPathMgr) DownloadsDir() string {
	return "/sdcard/Download"
}
