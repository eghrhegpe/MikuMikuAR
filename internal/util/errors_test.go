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

type testCustomError struct {
	msg string
}

func (e *testCustomError) Error() string { return e.msg }

func TestErrorIsOfType_MatchingType(t *testing.T) {
	err := &testCustomError{msg: "custom"}
	wrapped := WrapError("op", err)
	if !ErrorIsOfType[*testCustomError](wrapped) {
		t.Error("ErrorIsOfType should find *testCustomError through wrapping")
	}
}

func TestErrorIsOfType_NotMatchingType(t *testing.T) {
	err := errors.New("plain")
	wrapped := WrapError("op", err)
	if ErrorIsOfType[*testCustomError](wrapped) {
		t.Error("ErrorIsOfType should return false for non-matching type")
	}
}

func TestErrorIsOfType_NilError(t *testing.T) {
	if ErrorIsOfType[*testCustomError](nil) {
		t.Error("ErrorIsOfType should return false for nil error")
	}
}
