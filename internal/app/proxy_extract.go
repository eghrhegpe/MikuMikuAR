package app

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// PlazaItem represents a single extracted item from a plaza page (ADR-079).
type PlazaItem struct {
	Title       string `json:"title"`
	Thumbnail   string `json:"thumbnail,omitempty"`
	DownloadURL string `json:"downloadUrl,omitempty"`
	Author      string `json:"author,omitempty"`
	URL         string `json:"url"`
}

// PlazaExtractResult is the return type for ExtractPlazaPage.
type PlazaExtractResult struct {
	Items []PlazaItem `json:"items"`
	Title string      `json:"title"`
	URL   string      `json:"url"`
}

// extractionRule defines how to extract PlazaItems from a page's HTML.
type extractionRule struct {
	// siteHost matches the target host (e.g. "pixiv.net", "www.aplaybox.com")
	siteHost string
	// titleRe extracts the page title from <title> or og:title
	titleRe *regexp.Regexp
	// itemRe matches individual item blocks (e.g. artwork cards)
	itemRe *regexp.Regexp
	// thumbRe extracts thumbnail URLs from item blocks
	thumbRe *regexp.Regexp
	// linkRe extracts detail/download links from item blocks
	linkRe *regexp.Regexp
	// authorRe extracts author names
	authorRe *regexp.Regexp
}

var extractionRules = []extractionRule{
	{
		siteHost: "pixiv.net",
		titleRe:  regexp.MustCompile(`(?i)<title>([^<]+)</title>`),
		itemRe:   regexp.MustCompile(`(?i)data-tags="[^"]*"[^>]*>`),
		thumbRe:  regexp.MustCompile(`(?i)<img[^>]+src="([^"]*cdn[^"]*\.(?:jpg|png|gif)[^"]*)"`),
		linkRe:   regexp.MustCompile(`(?i)<a[^>]+href="(/artworks/\d+)"`),
		authorRe: regexp.MustCompile(`(?i)data-user-name="([^"]+)"`),
	},
	{
		siteHost: "www.aplaybox.com",
		titleRe:  regexp.MustCompile(`(?i)<title>([^<]+)</title>`),
		itemRe:   regexp.MustCompile(`(?i)<div[^>]+class="[^"]*work-item[^"]*"[^>]*>`),
		thumbRe:  regexp.MustCompile(`(?i)<img[^>]+src="([^"]+\.(?:jpg|png|webp)[^"]*)"`),
		linkRe:   regexp.MustCompile(`(?i)<a[^>]+href="([^"]*(?:detail|view)[^"]*)"`),
	},
	{
		siteHost: "booth.pm",
		titleRe:  regexp.MustCompile(`(?i)<title>([^<]+)</title>`),
		itemRe:   regexp.MustCompile(`(?i)<div[^>]+class="[^"]*js-carousel-item[^"]*"[^>]*>`),
		thumbRe:  regexp.MustCompile(`(?i)<img[^>]+src="([^"]+\.(?:jpg|png|webp)[^"]*)"`),
		linkRe:   regexp.MustCompile(`(?i)<a[^>]+href="([^"]+/items/\d+)"`),
	},
	{
		siteHost: "github.com",
		titleRe:  regexp.MustCompile(`(?i)<title>([^<]+)</title>`),
		itemRe:   regexp.MustCompile(`(?i)<a[^>]+class="[^"]*js-navigation-open[^"]*"[^>]*>`),
		linkRe:   regexp.MustCompile(`(?i)href="([^"]+)"`),
		thumbRe:  regexp.MustCompile(`(?i)<img[^>]+src="([^"]+\.(?:jpg|png|svg)[^"]*)"`),
	},
}

// ExtractPlazaPage fetches a URL through the proxy's cookie jar and extracts
// structured data using site-specific rules. Returns nil items (not error) when
// no rules match — the caller should fall back to iframe mode.
func (a *App) ExtractPlazaPage(pageURL string) (*PlazaExtractResult, error) {
	if pageURL == "" {
		return nil, fmt.Errorf("empty URL")
	}

	parsed, err := url.Parse(pageURL)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}

	rule := findRule(parsed.Host)
	if rule == nil {
		return &PlazaExtractResult{URL: pageURL}, nil
	}

	// Fetch page with cookies from jar
	req, err := http.NewRequest("GET", pageURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "+
			"(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
	req.Header.Set("Accept-Encoding", "gzip")

	a.httpSrvMu.Lock()
	sess, hasSession := proxySessions[proxyServerKey]
	a.httpSrvMu.Unlock()
	if hasSession && sess.jar != nil {
		if cookies := sess.jar.Cookies(parsed); len(cookies) > 0 {
			req.Header.Set("Cookie", cookiesToString(cookies))
		}
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	html := string(body)

	result := &PlazaExtractResult{URL: pageURL}
	extractItems(html, rule, parsed, result)
	return result, nil
}

// extractItems applies a rule's regex patterns to HTML and populates the result.
// Exported for testing.
func extractItems(html string, rule *extractionRule, base *url.URL, result *PlazaExtractResult) {
	// Extract title
	if rule.titleRe != nil {
		if m := rule.titleRe.FindStringSubmatch(html); len(m) > 1 {
			result.Title = strings.TrimSpace(m[1])
		}
	}

	// Extract items
	if rule.itemRe == nil {
		return
	}
	blocks := rule.itemRe.FindAllStringIndex(html, -1)
	seen := map[string]bool{}
	for _, loc := range blocks {
		end := loc[1]
		windowEnd := end + 2048
		if windowEnd > len(html) {
			windowEnd = len(html)
		}
		window := html[loc[0]:windowEnd]

		item := PlazaItem{URL: result.URL}

		if rule.linkRe != nil {
			if m := rule.linkRe.FindStringSubmatch(window); len(m) > 1 {
				href := m[1]
				if !strings.HasPrefix(href, "http") {
					href = base.Scheme + "://" + base.Host + href
				}
				item.URL = href
			}
		}

		if rule.thumbRe != nil {
			if m := rule.thumbRe.FindStringSubmatch(window); len(m) > 1 {
				src := m[1]
				if !strings.HasPrefix(src, "http") {
					src = base.Scheme + "://" + base.Host + src
				}
				item.Thumbnail = src
			}
		}

		if rule.authorRe != nil {
			if m := rule.authorRe.FindStringSubmatch(window); len(m) > 1 {
				item.Author = strings.TrimSpace(m[1])
			}
		}

		if item.URL != "" && !seen[item.URL] {
			seen[item.URL] = true
			result.Items = append(result.Items, item)
		}
	}
}

func findRule(host string) *extractionRule {
	// Strip port number (e.g. "127.0.0.1:8080" → "127.0.0.1")
	if idx := strings.LastIndex(host, ":"); idx != -1 {
		host = host[:idx]
	}
	for i := range extractionRules {
		if strings.HasSuffix(host, extractionRules[i].siteHost) {
			return &extractionRules[i]
		}
	}
	return nil
}
