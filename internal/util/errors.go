package util

import (
	"fmt"
)

// WrapError adds an operation prefix to an error, preserving the error chain.
// Returns nil if err is nil.
func WrapError(op string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", op, err)
}

// WrapErrorf adds an operation prefix and a message to an error.
// Combines the two-step pattern: WrapError(op, fmt.Errorf("msg: %w", err))
// If err is nil, returns a new error with just the op and message.
func WrapErrorf(op, msg string, err error) error {
	if err == nil {
		return fmt.Errorf("%s: %s", op, msg)
	}
	return fmt.Errorf("%s: %s: %w", op, msg, err)
}
