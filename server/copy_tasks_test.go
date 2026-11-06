package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCopyTaskSurvivesClearWhileRunning(t *testing.T) {
	tasks := newCopyTasks()
	defer close(tasks.queue)
	started := make(chan struct{})
	release := make(chan struct{})
	defer close(release)
	response := httptest.NewRecorder()
	tasks.submit(response, "source", "target", func(ctx context.Context) error {
		reportCopy(ctx, func(task *copyTask) { task.Bytes = 42 })
		close(started)
		<-release
		return nil
	})
	if response.Code != http.StatusAccepted {
		t.Fatalf("submit returned %d", response.Code)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("copy worker did not start")
	}
	response = httptest.NewRecorder()
	tasks.list(response, httptest.NewRequest(http.MethodDelete, "/api/copy-tasks", nil))
	var listed []copyTask
	if err := json.Unmarshal(response.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].State != "running" || listed[0].Bytes != 42 {
		t.Fatalf("running task missing or altered: %+v", listed)
	}
}
