package main

import (
	"context"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

func hddWakeLog(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "journalctl", "-t", "hdd-power", "--no-pager",
		"--grep=(standby -> active/idle|active/idle -> standby)$",
		"--lines=8", "--reverse", "--quiet", "--output=short-iso").Output()
	if err != nil {
		exit, ok := err.(*exec.ExitError)
		if !ok || exit.ExitCode() != 1 || len(exit.Stderr) != 0 || ctx.Err() != nil {
			fail(w, http.StatusServiceUnavailable, "无法读取硬盘唤醒记录。")
			return
		}
	}

	entries := []string{}
	if log := strings.TrimSpace(string(output)); log != "" {
		entries = strings.Split(log, "\n")
	}
	w.Header().Set("Cache-Control", "no-store")
	jsonResponse(w, http.StatusOK, entries)
}
