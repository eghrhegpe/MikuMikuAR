//go:build mpr

package app

// coopCoepEnabled indicates whether COOP/COEP headers should be injected
// to enable SharedArrayBuffer for multi-threaded WASM physics (MPR).
// Set via build tag: go build -tags mpr
const coopCoepEnabled = true
