package app

import (
	"net"
	"testing"
)

// [audit:fix 2026-10] TestValidateDirectPlazaURL covers the direct-mode URL
// gate added for the plaza 直连模式 SSRF 缺口 (round74 P2).
func TestValidateDirectPlazaURL(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr bool
	}{
		// 放行：真实站点 + 用户显式目标（typosquat 域名的同站判定是 JS 桥的活，
		// 不在本函数拦截范围——用户显式点了该 URL）。
		{"public apex allowed", "https://aplaybox.com/ok", false},
		{"typosquat apex allowed (explicit user target)", "https://evilaplaybox.com/", false},
		{"public ip literal allowed", "https://8.8.8.8", false},
		{"public ip with port allowed", "https://8.8.8.8:8443", false},
		// 拒：scheme
		{"http rejected", "http://aplaybox.com/x", true},
		{"file rejected", "file:///tmp/x", true},
		// 拒：SSRF 地址
		{"loopback ip rejected", "https://127.0.0.1:9999", true},
		{"ipv6 loopback rejected", "https://[::1]", true},
		{"private ip rejected", "https://192.168.1.5", true},
		{"localhost rejected", "https://localhost", true},
		{"local mDNS rejected", "https://foo.local", true},
		// 拒：不可解析
		{"unparseable rejected", "https://[bad", true},
		{"garbage rejected", "not a url", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateDirectPlazaURL(tc.url)
			if (err != nil) != tc.wantErr {
				t.Errorf("validateDirectPlazaURL(%q) error = %v, wantErr %v", tc.url, err, tc.wantErr)
			}
		})
	}
}

// [audit:fix 2026-10] TestIsBlockedIP_DirectPlazaRelevant adds the two exact
// addresses used by the direct-mode gate tests that TestIsBlockedIP
// (proxy_test.go) does not cover: a public IP (8.8.8.8) must stay allowed,
// and 192.168.1.5 (the /24 shape of the task's private example) must stay
// blocked.
func TestIsBlockedIP_DirectPlazaRelevant(t *testing.T) {
	if !isBlockedIP(net.ParseIP("192.168.1.5")) {
		t.Error("isBlockedIP(192.168.1.5) = false, want true (RFC1918 private)")
	}
	if isBlockedIP(net.ParseIP("8.8.8.8")) {
		t.Error("isBlockedIP(8.8.8.8) = true, want false (public address)")
	}
}
