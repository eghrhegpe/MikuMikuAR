package util

import (
	"errors"
	"os"
	"strings"
	"testing"
)

func TestWrapError_NilError(t *testing.T) {
	if err := WrapError("op", nil); err != nil {
		t.Errorf("WrapError with nil error should return nil, got %v", err)
	}
}

func TestWrapError_WrapsWithOpPrefix(t *testing.T) {
	inner := errors.New("inner failure")
	err := WrapError("LoadModel", inner)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.HasPrefix(err.Error(), "LoadModel: ") {
		t.Errorf("error should start with 'LoadModel: ', got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "inner failure") {
		t.Errorf("error should contain inner message, got %q", err.Error())
	}
}

func TestWrapError_PreservesErrorChain(t *testing.T) {
	inner := os.ErrNotExist
	err := WrapError("ReadFile", inner)
	if !errors.Is(err, os.ErrNotExist) {
		t.Error("errors.Is should find os.ErrNotExist through WrapError")
	}
}

func TestWrapErrorf_NilError(t *testing.T) {
	err := WrapErrorf("op", "message", nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err.Error() != "op: message" {
		t.Errorf("expected 'op: message', got %q", err.Error())
	}
}

func TestWrapErrorf_WithInnerError(t *testing.T) {
	inner := errors.New("inner failure")
	err := WrapErrorf("LoadModel", "load failed", inner)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.HasPrefix(err.Error(), "LoadModel: load failed: ") {
		t.Errorf("error should start with 'LoadModel: load failed: ', got %q", err.Error())
	}
	if !errors.Is(err, inner) {
		t.Error("errors.Is should find inner error through WrapErrorf")
	}
}
