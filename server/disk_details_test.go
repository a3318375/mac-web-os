package main

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestOverviewHardwareReadings(t *testing.T) {
	if got := unallocatedSectors(100, []sectorRange{{20, 80}, {10, 40}, {85, 95}}); got != 20 {
		t.Fatalf("unallocated sectors = %d", got)
	}
	report, err := parseSMART([]byte(`{"smart_status":{"passed":false},"nvme_smart_health_information_log":{"temperature":36,"power_cycles":0,"power_on_hours":123,"percentage_used":4}}`))
	if err != nil || report.Passed == nil || *report.Passed || report.Temperature == nil || *report.Temperature != 36 ||
		report.Cycles == nil || *report.Cycles != 0 || report.Hours == nil || *report.Hours != 123 || report.Wear == nil || *report.Wear != 4 {
		t.Fatalf("unexpected SMART report: %+v, %v", report, err)
	}
	root := t.TempDir()
	for file, contents := range map[string]string{
		"hwmon0/name": "drivetemp", "hwmon0/temp1_input": "30000",
		"hwmon1/name": "coretemp", "hwmon1/temp1_input": "44500", "hwmon1/temp1_label": "Package",
		"hwmon2/name": "spd5118", "hwmon2/temp1_input": "33000",
		"hwmon3/name": "nct6798", "hwmon3/fan1_input": "0", "hwmon3/temp1_input": "33000",
	} {
		path := filepath.Join(root, file)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
	}
	want := []sensorReading{{"Package", "cpu", 44.5}, {"spd5118 · temp1", "memory", 33}, {"nct6798 · fan1", "fan", 0}}
	if got := readSensors(root); !slices.Equal(got, want) {
		t.Fatalf("unexpected sensors: %+v", got)
	}
}
