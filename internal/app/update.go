package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// githubRepo is the owner/name used for update checks.
// Replace with your distribution repo if it differs from the source repo.
const githubRepo = "eghrhegpe/MikuMikuAR"

// UpdateCheckResult holds the outcome of a version check.
type UpdateCheckResult struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Available bool   `json:"available"`
	URL       string `json:"url"`
	CheckedAt int64  `json:"checkedAt"`
	// Error carries network/parse failures. A non-empty Error means the check
	// could not be completed; the UI degrades gracefully rather than treating
	// this as a hard failure.
	Error string `json:"error,omitempty"`
}

// CheckForUpdate queries the GitHub latest release and reports whether a newer
// version is available. Network/parse failures are reported via Error (and the
// returned result is non-nil) so callers never need to branch on a hard error.
func (a *App) CheckForUpdate() (*UpdateCheckResult, error) {
	res := &UpdateCheckResult{
		Current:   a.appVersion,
		CheckedAt: time.Now().Unix(),
	}
	latest, url, err := latestGitHubRelease(githubRepo)
	if err != nil {
		res.Error = err.Error()
		return res, nil
	}
	res.Latest = latest
	res.URL = url
	res.Available = isNewer(latest, a.appVersion)
	return res, nil
}

// latestGitHubRelease fetches tag_name + html_url of the latest published release.
func latestGitHubRelease(repo string) (tag, url string, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://api.github.com/repos/"+repo+"/releases/latest", nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "MikuMikuAR-update-check")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("github api status %d", resp.StatusCode)
	}

	var data struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", "", err
	}
	if data.TagName == "" {
		return "", "", fmt.Errorf("empty tag_name in response")
	}
	return data.TagName, data.HTMLURL, nil
}

// isNewer reports whether the remote tag is a newer semantic version than current.
// Both may carry a leading "v"/"V". Development versions (e.g. "dev", non-numeric)
// are treated as not newer to avoid false positives.
func isNewer(latest, current string) bool {
	lv := normalizeVersion(latest)
	cv := normalizeVersion(current)
	if lv == "" || cv == "" {
		return false
	}
	return compareVersion(lv, cv) > 0
}

func normalizeVersion(v string) string {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "v")
	v = strings.TrimPrefix(v, "V")
	return v
}

// compareVersion compares two "major[.minor[.patch]]" strings numerically.
// Returns >0 if a>b, <0 if a<b, 0 if equal. Missing segments are treated as 0.
func compareVersion(a, b string) int {
	as := splitVersion(a)
	bs := splitVersion(b)
	for i := 0; i < 3; i++ {
		if as[i] != bs[i] {
			return as[i] - bs[i]
		}
	}
	return 0
}

func splitVersion(v string) [3]int {
	parts := strings.SplitN(v, ".", 3)
	var out [3]int
	for i := 0; i < 3; i++ {
		if i < len(parts) {
			if n, err := strconv.Atoi(strings.TrimSpace(parts[i])); err == nil {
				out[i] = n
			}
		}
	}
	return out
}
