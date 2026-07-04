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
}

// platformPathMgr is the active platform implementation.
// Initialized by init() via build-tagged newPlatformPathMgr().
var platformPathMgr PathManager

func init() {
	platformPathMgr = newPlatformPathMgr()
}
