package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func systemSensors(w http.ResponseWriter, _ *http.Request) {
	jsonResponse(w, http.StatusOK, readSensors("/sys/class/hwmon"))
}

type sensorReading struct {
	Name  string  `json:"name"`
	Kind  string  `json:"kind"`
	Value float64 `json:"value"`
}

func readSensors(root string) []sensorReading {
	readings := []sensorReading{}
	chips, _ := os.ReadDir(root)
	for _, chip := range chips {
		base := filepath.Join(root, chip.Name())
		driver := readMetadata(filepath.Join(base, "name"))
		var kind, prefix string
		// Only open inputs of known CPU, DIMM or board fan drivers.
		// Disk hwmon inputs, including drivetemp, may issue disk commands.
		switch driver {
		case "coretemp", "k10temp", "zenpower", "cpu_thermal", "peci_cputemp":
			kind, prefix = "cpu", "temp"
		case "jc42", "spd5118", "ts5111", "ts5110":
			kind, prefix = "memory", "temp"
		default:
			if strings.HasPrefix(driver, "nct") || strings.HasPrefix(driver, "it87") || strings.HasPrefix(driver, "it86") {
				kind, prefix = "fan", "fan"
			} else {
				switch driver {
				case "asus", "asus_wmi_sensors", "dell_smm", "dell_smm_hwmon", "thinkpad", "pwmfan", "hp_wmi_sensors", "acpitz":
					kind, prefix = "fan", "fan"
				default:
					continue
				}
			}
		}
		files, _ := os.ReadDir(base)
		for _, file := range files {
			channel, input := strings.CutSuffix(file.Name(), "_input")
			number, match := strings.CutPrefix(channel, prefix)
			if _, err := strconv.ParseUint(number, 10, 16); !match || !input || err != nil {
				continue
			}
			if readMetadata(filepath.Join(base, channel+"_fault")) == "1" {
				continue
			}
			value, err := strconv.Atoi(readMetadata(filepath.Join(base, file.Name())))
			if err != nil || (kind == "fan" && value < 0) {
				continue
			}
			name := readMetadata(filepath.Join(base, channel+"_label"))
			if name == "" {
				name = driver + " · " + channel
			}
			reading := sensorReading{Name: name, Kind: kind, Value: float64(value)}
			if kind != "fan" {
				reading.Value /= 1000
			}
			readings = append(readings, reading)
		}
	}
	return readings
}
