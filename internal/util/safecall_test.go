package util

import (
	"errors"
	"strings"
	"testing"
)

func TestSafeCall_NoPanic_ReturnsValue(t *testing.T) {
	result, err := SafeCall(func() (string, error) {
		return "hello", nil
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result != "hello" {
		t.Errorf("expected 'hello', got %q", result)
	}
}

func TestSafeCall_NoPanic_ReturnsError(t *testing.T) {
	wantErr := errors.New("something went wrong")
	_, err := SafeCall(func() (string, error) {
		return "", wantErr
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !errors.Is(err, wantErr) {
		t.Errorf("expected error %v, got %v", wantErr, err)
	}
}

func TestSafeCall_PanicString_RecoveredAsError(t *testing.T) {
	_, err := SafeCall(func() (string, error) {
		panic("boom")
	})
	if err == nil {
		t.Fatal("expected error from panic, got nil")
	}
	if !strings.Contains(err.Error(), "boom") {
		t.Errorf("error should contain panic message 'boom', got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "panic recovered") {
		t.Errorf("error should indicate panic recovery, got %q", err.Error())
	}
}

func TestSafeCall_PanicError_RecoveredAsError(t *testing.T) {
	wantErr := errors.New("critical failure")
	_, err := SafeCall(func() (string, error) {
		panic(wantErr)
	})
	if err == nil {
		t.Fatal("expected error from panic, got nil")
	}
	if !errors.Is(err, wantErr) {
		t.Errorf("expected underlying error %v, got %v", wantErr, err)
	}
}

func TestSafeCall_PanicNil_RecoveredAsError(t *testing.T) {
	_, err := SafeCall(func() (string, error) {
		panic(nil)
	})
	if err == nil {
		t.Fatal("expected error from panic(nil), got nil")
	}
}

func TestSafeCall_IntReturnType(t *testing.T) {
	result, err := SafeCall(func() (int, error) {
		return 42, nil
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result != 42 {
		t.Errorf("expected 42, got %d", result)
	}
}

func TestSafeCall_VoidReturn(t *testing.T) {
	err := SafeCallVoid(func() error {
		return nil
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestSafeCallVoid_Panic_Recovered(t *testing.T) {
	err := SafeCallVoid(func() error {
		panic("void panic")
	})
	if err == nil {
		t.Fatal("expected error from panic, got nil")
	}
	if !strings.Contains(err.Error(), "void panic") {
		t.Errorf("error should contain 'void panic', got %q", err.Error())
	}
}

func TestSafeCallVoid_NormalError(t *testing.T) {
	wantErr := errors.New("normal error")
	err := SafeCallVoid(func() error {
		return wantErr
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !errors.Is(err, wantErr) {
		t.Errorf("expected %v, got %v", wantErr, err)
	}
}
