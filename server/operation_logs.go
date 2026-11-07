package main

import (
	"net/http"
	"sync"
	"time"
)

const logLimit = 1000

type operationRecord struct {
	ID         int        `json:"id"`
	At         time.Time  `json:"at"`
	FinishedAt *time.Time `json:"finishedAt,omitempty"`
	Action     string     `json:"action"`
	Source     string     `json:"source"`
	Target     string     `json:"target"`
	State      string     `json:"state"`
	Error      string     `json:"error"`
	Copy       *copyTask  `json:"copy,omitempty"`
}

// Process-local history: active copies are never evicted; the UI states the retention scope.
type operationLogs struct {
	mu      sync.Mutex
	next    int
	started time.Time
	items   []operationRecord
}

func newOperationLogs() *operationLogs { return &operationLogs{started: time.Now()} }

func (logs *operationLogs) record(item operationRecord) int {
	logs.mu.Lock()
	defer logs.mu.Unlock()
	logs.next++
	item.ID = logs.next
	if item.At.IsZero() {
		item.At = time.Now()
	}
	logs.items = append([]operationRecord{item}, logs.items...)
	logs.trim()
	return item.ID
}

func (logs *operationLogs) trim() {
	completed := 0
	kept := logs.items[:0]
	for _, item := range logs.items {
		active := item.State == "queued" || item.State == "running"
		if !active {
			completed++
		}
		if active || completed <= logLimit {
			kept = append(kept, item)
		}
	}
	logs.items = kept
}

func (logs *operationLogs) updateCopy(id int, task copyTask) {
	logs.mu.Lock()
	defer logs.mu.Unlock()
	for i := range logs.items {
		item := &logs.items[i]
		if item.ID != id {
			continue
		}
		task.Files = append([]string(nil), task.Files...)
		item.Copy, item.State, item.Error = &task, task.State, task.Error
		if task.State == "done" || task.State == "failed" {
			now := time.Now()
			item.FinishedAt = &now
			logs.trim()
		}
		break
	}
}

func (logs *operationLogs) list(w http.ResponseWriter, r *http.Request) {
	logs.mu.Lock()
	items := append([]operationRecord{}, logs.items...)
	logs.mu.Unlock()
	jsonResponse(w, http.StatusOK, struct {
		Started time.Time         `json:"started"`
		Limit   int               `json:"limit"`
		Items   []operationRecord `json:"items"`
	}{logs.started, logLimit, items})
}
