package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// FetchPlazaConfig fetches the latest plaza config (creators.json + plaza_sites.json)
// from GitHub with three-way fallback (raw → jsdelivr → GitHub API),
// caches the results locally, and returns the raw JSON strings.
// If all remotes fail, falls back to the local cache.
func (a *App) FetchPlazaConfig() (creators string, sites string, err error) {
	cfg, err := fetchPlazaRemote()
	if err != nil {
		cr, e1 := readPlazaCache("creators.json")
		st, e2 := readPlazaCache("workshop_sites.json")
		if e1 == nil && e2 == nil {
			return string(cr), string(st), nil
		}
		return "", "", fmt.Errorf("remote fetch failed and no local cache: %w", err)
	}
	_ = writePlazaCache("creators.json", cfg.creators)
	_ = writePlazaCache("workshop_sites.json", cfg.sites)
	return string(cfg.creators), string(cfg.sites), nil
}

func (a *App) GetCachedPlazaConfig() (creators string, sites string) {
	cr, _ := readPlazaCache("creators.json")
	st, _ := readPlazaCache("workshop_sites.json")
	return string(cr), string(st)
}

// ── internal ──

const (
	plazaGitHubOwner  = "eghrhegpe"
	plazaGitHubRepo   = "MikuMikuAR"
	plazaGitHubBranch = "main"
)

type plazaRemoteResult struct {
	creators []byte
	sites    []byte
}

type plazaSource struct {
	name string
	url  string
}

func fetchPlazaRemote() (*plazaRemoteResult, error) {
	fetchURL := func(url string) ([]byte, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
		}
		return io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	}

	fetchGitHubAPI := func(url string) ([]byte, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/vnd.github.v3+json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
		}
		var result struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			return nil, err
		}
		clean := strings.Map(func(r rune) rune {
			if r == '\n' || r == '\r' || r == ' ' || r == '\t' {
				return -1
			}
			return r
		}, result.Content)
		return base64.StdEncoding.DecodeString(clean)
	}

	type remoteFile struct {
		name    string
		sources []plazaSource
		isAPI   func(url string) bool
	}

	raw := "https://raw.githubusercontent.com/" + plazaGitHubOwner + "/" + plazaGitHubRepo + "/" + plazaGitHubBranch
	jsd := "https://cdn.jsdelivr.net/gh/" + plazaGitHubOwner + "/" + plazaGitHubRepo + "@" + plazaGitHubBranch
	api := "https://api.github.com/repos/" + plazaGitHubOwner + "/" + plazaGitHubRepo + "/contents"

	files := []remoteFile{
		{
			name: "creators.json",
			sources: []plazaSource{
				{name: "raw", url: raw + "/creators.json"},
				{name: "jsd", url: jsd + "/creators.json"},
				{name: "api", url: api + "/creators.json"},
			},
			isAPI: func(url string) bool { return strings.Contains(url, "api.github.com") },
		},
		{
			name: "workshop_sites.json",
			sources: []plazaSource{
				{name: "raw", url: raw + "/workshop_sites.json"},
				{name: "jsd", url: jsd + "/workshop_sites.json"},
				{name: "api", url: api + "/workshop_sites.json"},
			},
			isAPI: func(url string) bool { return strings.Contains(url, "api.github.com") },
		},
	}

	result := &plazaRemoteResult{}
	for _, f := range files {
		var data []byte
		var lastErr error
		for _, s := range f.sources {
			var d []byte
			var err error
			if f.isAPI(s.url) {
				d, err = fetchGitHubAPI(s.url)
			} else {
				d, err = fetchURL(s.url)
			}
			if err == nil {
				data = d
				break
			}
			lastErr = err
		}
		if data == nil {
			return nil, fmt.Errorf("failed to fetch %s: %w", f.name, lastErr)
		}
		switch f.name {
		case "creators.json":
			result.creators = data
		case "workshop_sites.json":
			result.sites = data
		}
	}
	return result, nil
}

// ── cache ──

func plazaCacheDir() (string, error) {
	return ensureDir("plaza-cache", true)
}

func writePlazaCache(filename string, data []byte) error {
	dir, err := plazaCacheDir()
	if err != nil {
		return err
	}
	tmp := filepath.Join(dir, filename+".tmp")
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, filename))
}

func readPlazaCache(filename string) ([]byte, error) {
	dir, err := plazaCacheDir()
	if err != nil {
		return nil, err
	}
	return os.ReadFile(filepath.Join(dir, filename))
}
