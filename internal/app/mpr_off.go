//go:build !mpr

package app

// coopCoepEnabled indicates whether COOP/COEP headers should be injected
// to enable SharedArrayBuffer for multi-threaded WASM physics (MPR).
// Default: false (SPR single-threaded). Enable via: go build -tags mpr
const coopCoepEnabled = false
