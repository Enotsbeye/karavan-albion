//go:build !windows

package main

import "fmt"

func startCapture() error {
	return fmt.Errorf("перехват работает только в Windows")
}
