package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type launcherConfig struct {
	NodePath string `json:"nodePath"`
	HostPath string `json:"hostPath"`
	ConfigPath string `json:"configPath"`
}

func main() {
	executable, err := os.Executable()
	if err != nil {
		fail("cannot locate launcher", err)
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(executable), "launcher.json"))
	if err != nil {
		fail("cannot read launcher.json", err)
	}
	var config launcherConfig
	if err := json.Unmarshal(raw, &config); err != nil {
		fail("launcher.json is invalid", err)
	}
	if !filepath.IsAbs(config.NodePath) || !filepath.IsAbs(config.HostPath) || !filepath.IsAbs(config.ConfigPath) {
		fail("launcher paths must be absolute", nil)
	}
	arguments := []string{config.HostPath, "--config", config.ConfigPath}
	arguments = append(arguments, os.Args[1:]...)
	command := exec.Command(config.NodePath, arguments...)
	stdin, err := command.StdinPipe()
	if err != nil {
		fail("cannot open child stdin", err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		fail("cannot open child stdout", err)
	}
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		fail("cannot start Node host", err)
	}
	inputClosed := make(chan struct{}, 1)
	go func() {
		_, _ = io.Copy(stdin, os.Stdin)
		_ = stdin.Close()
		inputClosed <- struct{}{}
	}()
	go func() { _, _ = io.Copy(os.Stdout, stdout) }()
	waitDone := make(chan error, 1)
	go func() { waitDone <- command.Wait() }()
	select {
	case err := <-waitDone:
		if err != nil {
			fail("Node host exited with an error", err)
		}
	case <-inputClosed:
		select {
		case err := <-waitDone:
			if err != nil {
				fail("Node host exited with an error", err)
			}
		case <-time.After(12 * time.Second):
			_ = command.Process.Kill()
			fail("Node host did not exit after browser stdio closed", nil)
		}
	}
}

func fail(message string, err error) {
	if err != nil {
		fmt.Fprintf(os.Stderr, "AzureDevOps++ launcher: %s: %v\n", message, err)
	} else {
		fmt.Fprintf(os.Stderr, "AzureDevOps++ launcher: %s\n", message)
	}
	os.Exit(1)
}
