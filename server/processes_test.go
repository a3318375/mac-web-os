package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func processStat(pid int, name string) string {
	// Fields 3 through 24 of /proc/PID/stat.
	return fmt.Sprintf("%d (%s) S 1 1 1 0 -1 0 0 0 0 0 120 30 0 0 20 0 4 0 9876 1048576 25", pid, name)
}

func TestParseProcessStat(t *testing.T) {
	p, err := parseProcessStat(processStat(42, "worker (copy) ) task"))
	if err != nil {
		t.Fatal(err)
	}
	if p.PID != 42 || p.Name != "worker (copy) ) task" || p.State != "S" || p.Ticks != 150 ||
		p.Threads != 4 || p.Started != 9876 || p.Memory != 25*uint64(os.Getpagesize()) {
		t.Fatalf("unexpected process: %+v", p)
	}
	for _, stat := range []string{"", "42 (truncated) S", processStat(0, "bad PID"),
		strings.Replace(processStat(42, "bad ticks"), "120", "no", 1),
		strings.TrimSuffix(processStat(42, "bad RSS"), "25") + "-1"} {
		if _, err := parseProcessStat(stat); err == nil {
			t.Fatalf("accepted invalid stat: %q", stat)
		}
	}
}

func TestReadProcesses(t *testing.T) {
	proc := t.TempDir()
	for name, content := range map[string]string{
		"stat":    "cpu 60 2 20 300 5 1 3 4 0 0\ncpu0 0\ncpu1 0\n",
		"meminfo": "MemTotal: 8000 kB\nMemAvailable: 5000 kB\n", "net/dev": "",
		"42/stat": processStat(42, "worker task"), "42/status": "Name:\tworker task\nUid:\t1000\t1000\t1000\t1000\n",
		"43/stat": processStat(43, "no status"), "44/stat": "broken", "45/status": "already exited",
		"46/stat": processStat(99, "mismatched PID"), "not-a-pid/stat": "ignored",
	} {
		file := filepath.Join(proc, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	sample, err := readProcesses(proc)
	if err != nil {
		t.Fatal(err)
	}
	if len(sample.Processes) != 2 || sample.Skipped != 3 || sample.CPU.Logical != 2 || sample.Memory.Total != 8000*1024 || sample.At <= 0 {
		t.Fatalf("unexpected sample: %+v", sample)
	}
	if sample.Processes[0].UID != "1000" || sample.Processes[1].UID != "—" {
		t.Fatalf("unexpected UIDs: %+v", sample.Processes)
	}
	if _, err := readProcesses(filepath.Join(proc, "missing")); err == nil {
		t.Fatal("accepted unavailable procfs")
	}
}
