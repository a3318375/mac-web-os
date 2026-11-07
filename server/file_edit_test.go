package main

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestDeleteRequestGuards(t *testing.T) {
	for _, test := range []struct {
		name                             string
		system, wake, confirmed, consent bool
		path, file                       string
		status                           int
	}{
		{"system read only", true, false, true, true, ".", "file", 403},
		{"sleeping disk", false, true, false, true, ".", "file", 403},
		{"requires deletion consent", false, false, true, false, ".", "file", 400},
		{"cannot delete volume root", false, false, true, true, ".", ".", 400},
		{"rejects traversal", false, false, true, true, "../outside", "file", 400},
		{"rejects reserved staging", false, false, true, true, ".", ".mac-web-os-copy-job", 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler := editHandler(func() ([]*disk, error) {
				return []*disk{{ID: "disk", System: test.system, MayWake: test.wake, Volumes: []volume{{ID: "volume", Mount: "must-not-be-accessed"}}}}, nil
			})
			body, _ := json.Marshal(map[string]any{"action": "delete", "confirmDelete": test.consent, "name": test.file, "directory": fileLocation{Disk: "disk", Volume: "volume", Path: test.path, Confirmed: test.confirmed}})
			r := httptest.NewRequest("POST", "/api/file-edit", bytes.NewReader(body))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			handler(w, r)
			if w.Code != test.status {
				t.Fatalf("status %d: %s", w.Code, w.Body)
			}
		})
	}
}
