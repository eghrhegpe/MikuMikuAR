package main

import (
	"os"
	"testing"
)

// TestE2eDebugBrowserArgs 守护 audit 修复：MMCAR_DEBUG_PORT 坏值不得原样透传给
// Chromium。合法范围 0..65535（strconv.Atoi 成功且 0<=n<=65535）；其余（未设置/空串/
// 非数字/超范围/负数）一律返回 nil，与 doc comment「未设置时返回 nil」语义一致。
func TestE2eDebugBrowserArgs(t *testing.T) {
	t.Run("unset", func(t *testing.T) {
		// 模拟「未设置」：先删掉环境变量，测试结束恢复原值
		old, had := os.LookupEnv("MMCAR_DEBUG_PORT")
		os.Unsetenv("MMCAR_DEBUG_PORT")
		t.Cleanup(func() {
			if had {
				t.Setenv("MMCAR_DEBUG_PORT", old)
			}
		})
		if got := e2eDebugBrowserArgs(); got != nil {
			t.Fatalf("unset: got %v, want nil", got)
		}
	})

	tests := []struct {
		name string
		env  string
		want []string
	}{
		{"empty", "", nil},
		{"valid 9222", "9222", []string{"--remote-debugging-port=9222"}},
		{"zero in range", "0", []string{"--remote-debugging-port=0"}},
		{"out-of-range 99999", "99999", nil},
		{"non-numeric abc", "abc", nil},
		{"negative -1", "-1", nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("MMCAR_DEBUG_PORT", tc.env)
			got := e2eDebugBrowserArgs()
			if len(got) != len(tc.want) {
				t.Fatalf("MMCAR_DEBUG_PORT=%q: got %d args %v, want %d (%v)", tc.env, len(got), got, len(tc.want), tc.want)
			}
			for i, s := range tc.want {
				if got[i] != s {
					t.Fatalf("MMCAR_DEBUG_PORT=%q: arg %d = %q, want %q", tc.env, i, got[i], s)
				}
			}
		})
	}
}
