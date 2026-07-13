package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestCoopCoepMiddlewareOff verifies that with the flag unset the middleware
// is a pass-through — no COOP/COEP headers, default app behavior unchanged.
// [doc:adr-099]
func TestCoopCoepMiddlewareOff(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mw := CoopCoepMiddleware(next)

	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if got := rec.Header().Get("Cross-Origin-Opener-Policy"); got != "" {
		t.Errorf("flag off: expected no COOP header, got %q", got)
	}
	if got := rec.Header().Get("Cross-Origin-Embedder-Policy"); got != "" {
		t.Errorf("flag off: expected no COEP header, got %q", got)
	}
}

// TestCoopCoepMiddlewareOn verifies that with VITE_MMD_WASM_MT set the
// middleware injects both cross-origin-isolation headers (grants SharedArrayBuffer).
// [doc:adr-099]
func TestCoopCoepMiddlewareOn(t *testing.T) {
	t.Setenv("VITE_MMD_WASM_MT", "1")
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mw := CoopCoepMiddleware(next)

	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if got := rec.Header().Get("Cross-Origin-Opener-Policy"); got != "same-origin" {
		t.Errorf("flag on: expected COOP=same-origin, got %q", got)
	}
	if got := rec.Header().Get("Cross-Origin-Embedder-Policy"); got != "require-corp" {
		t.Errorf("flag on: expected COEP=require-corp, got %q", got)
	}
}
