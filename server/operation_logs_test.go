package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
)

func TestOperationHistoryRetention(t *testing.T) {
	logs := newOperationLogs()
	active := logs.record(operationRecord{Action: "copy", State: "running"})
	for i := 0; i < logLimit+20; i++ {
		logs.record(operationRecord{Action: "delete", State: "done"})
	}
	if len(logs.items) != logLimit+1 {
		t.Fatalf("active copy was lost or retention exceeded: %d", len(logs.items))
	}
	logs.updateCopy(active, copyTask{State: "failed", Error: "copy failed", Files: []string{"file.txt"}})
	if len(logs.items) != logLimit {
		t.Fatal("finished copy did not respect retention")
	}
	w := httptest.NewRecorder()
	logs.list(w, httptest.NewRequest("GET", "/api/logs", nil))
	var result struct {
		Started time.Time
		Limit   int
		Items   []operationRecord
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Started.IsZero() || result.Limit != logLimit || len(result.Items) != logLimit {
		t.Fatal("invalid history scope")
	}
}

func TestCopyUpdatesOperationHistory(t *testing.T) {
	logs := newOperationLogs()
	tasks := newCopyTasks()
	tasks.logs = logs
	defer close(tasks.queue)
	w := httptest.NewRecorder()
	tasks.submit(w, "/volume/source", "/volume/target", func(ctx context.Context) error {
		reportCopy(ctx, func(task *copyTask) { task.Bytes = 42; task.Completed = 1; task.Files = []string{"source"} })
		return nil
	})
	if w.Code != 202 {
		t.Fatalf("copy was not queued: %d", w.Code)
	}
	deadline := time.Now().Add(time.Second)
	for {
		logs.mu.Lock()
		item := logs.items[0]
		logs.mu.Unlock()
		if item.State == "done" {
			if item.Action != "copy" || item.At.IsZero() || item.FinishedAt == nil || item.Copy.Bytes != 42 || item.Copy.Completed != 1 {
				t.Fatalf("missing copy detail: %+v", item)
			}
			// Clearing the old progress endpoint must not erase the operation log.
			tasks.list(httptest.NewRecorder(), httptest.NewRequest("DELETE", "/api/copy-tasks", nil))
			if len(logs.items) != 1 {
				t.Fatal("operation history was cleared")
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("copy log never finished")
		}
		time.Sleep(time.Millisecond)
	}
}
