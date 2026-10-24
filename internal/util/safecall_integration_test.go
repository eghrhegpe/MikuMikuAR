package util

import (
	"errors"
	"testing"
)

// Simulated-panic coverage for SafeCall/SafeCallVoid: these tests panic
// intentionally (no real zip extraction involved) to pin the recovery and
// error-chain behavior. They complement safecall_test.go, which covers the
// full panic-value matrix (string/error/nil/int/void).

func TestSafeCall_SimulatedPanicRecovers(t *testing.T) {
	result, err := SafeCall(func() (int, error) {
		panic("simulated zip panic")
	})
	if err == nil {
		t.Error("expected error from panicking function, got nil")
	}
	if result != 0 {
		t.Errorf("expected zero value result, got %v", result)
	}
}

func TestSafeCall_PanicErrorPreservesChain(t *testing.T) {
	origErr := errors.New("original error")
	_, err := SafeCall(func() (string, error) {
		panic(origErr)
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, origErr) {
		t.Error("errors.Is should find original error through panic wrapper")
	}
}

func TestSafeCallVoid_RecoversFromPanic(t *testing.T) {
	err := SafeCallVoid(func() error {
		panic("something went wrong")
	})
	if err == nil {
		t.Error("expected error from panicking function, got nil")
	}
}
