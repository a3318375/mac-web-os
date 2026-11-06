package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadMetrics(t *testing.T) {
	proc := t.TempDir()
	if err := os.Mkdir(filepath.Join(proc, "net"), 0700); err != nil {
		t.Fatal(err)
	}
	for name, contents := range map[string]string{
		"stat":    "cpu  60 2 20 300 5 1 3 4 10 1\ncpu0 0\ncpu1 0\nintr 0\n",
		"meminfo": "MemTotal: 8000 kB\nMemFree: 100 kB\nMemAvailable: 5000 kB\n",
		"net/dev": "Inter-| Receive | Transmit\n face |bytes|bytes\n lo: 80 0 0 0 0 0 0 0 80 0 0 0 0 0 0 0\n enp3s0: 1200 1 0 0 0 0 0 0 800 1 0 0 0 0 0 0\n",
	} {
		if err := os.WriteFile(filepath.Join(proc, name), []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
	}
	sample, err := readMetrics(proc)
	if err != nil {
		t.Fatal(err)
	}
	if sample.At <= 0 || sample.CPU != (cpuCounters{Busy: 90, Idle: 305, Logical: 2}) ||
		sample.Memory != (memoryCounters{Total: 8000 * 1024, Available: 5000 * 1024}) ||
		len(sample.Network) != 1 || sample.Network[0] != (networkCounters{Name: "enp3s0", Rx: 1200, Tx: 800}) {
		t.Fatalf("unexpected sample: %+v", sample)
	}
	if err := os.WriteFile(filepath.Join(proc, "meminfo"), []byte("MemTotal: 8000 kB\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := readMetrics(proc); err == nil {
		t.Fatal("accepted missing available memory counter")
	}
}
