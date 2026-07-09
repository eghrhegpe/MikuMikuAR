package app

// PathManager abstracts platform-specific path resolution.
// Desktop: os.UserConfigDir/os.UserCacheDir
// Android: /data/data/<pkg>/files (SAF later)
type PathManager interface {
	// AppDataRoot returns writable config root (e.g. %APPDATA%).
	// Does NOT include app name — caller appends "MikuMikuAR".
	AppDataRoot() (string, error)
	// CacheRoot returns writable cache root (e.g. %LOCALAPPDATA%).
	// Does NOT include app name — caller appends "MikuMikuAR".
	CacheRoot() (string, error)
	// ResourceRoot returns default user resource root (e.g. ~/MMD).
	ResourceRoot() string
	// PrivateResourceRoot returns the app-private resource directory.
	// On Android: /storage/emulated/0/Android/data/<pkg>/files/MMD
	// On desktop: same as ResourceRoot()
	PrivateResourceRoot() string
	// SharedResourceRoot returns the shared/public resource directory.
	// On Android: /sdcard/MMD (requires MANAGE_EXTERNAL_STORAGE)
	// On desktop: same as ResourceRoot()
	SharedResourceRoot() string
	// DownloadsDir returns the user's Downloads directory (e.g. ~/Downloads).
	// Empty string means unsupported (Android fsnotify 不可用).
	DownloadsDir() string
}

// platformPathMgr is the active platform implementation.
// Initialized by init() via build-tagged newPlatformPathMgr().
var platformPathMgr PathManager

func init() {
	platformPathMgr = newPlatformPathMgr()
}
