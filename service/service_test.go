package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newTestServer(t *testing.T) (*Store, http.Handler) {
	t.Helper()
	store, err := OpenStore("file:test-smsweb?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, NewServer(store)
}

func requestJSON(t *testing.T, handler http.Handler, method, path string, payload any) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestHealth(t *testing.T) {
	_, handler := newTestServer(t)
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK || response.Body.String() != "{\"status\":\"ok\"}\n" {
		t.Fatalf("unexpected health response: %d %s", response.Code, response.Body.String())
	}
}

func TestIncomingShelterRequest(t *testing.T) {
	store, handler := newTestServer(t)
	response := requestJSON(t, handler, http.MethodPost, "/sms/incoming", incomingSMS{
		Sender: "+8801712345678",
		Text:   "REQ|1|A17K|SHELTER|DHK",
	})

	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d %s", response.Code, response.Body.String())
	}

	var gateway gatewayResponse
	if err := json.Unmarshal(response.Body.Bytes(), &gateway); err != nil {
		t.Fatal(err)
	}
	if gateway.Recipient != "+8801712345678" {
		t.Fatalf("unexpected recipient: %s", gateway.Recipient)
	}
	if gateway.Text != "RES|1|A17K|SHELTER|1/1|DHK|DU:0:FULL;MIRPUR:120:OPEN;UTTARA:80:OPEN" {
		t.Fatalf("unexpected response text: %s", gateway.Text)
	}

	count, err := store.MessageCount()
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("expected incoming and outgoing messages, got %d", count)
	}
}

func TestResponseStatusUpdate(t *testing.T) {
	_, handler := newTestServer(t)
	_ = requestJSON(t, handler, http.MethodPost, "/sms/incoming", incomingSMS{
		Sender: "+8801712345678",
		Text:   "REQ|1|A17K|HOME|-",
	})

	response := requestJSON(t, handler, http.MethodPost, "/sms/response", responseStatus{
		RequestID: "A17K",
		Status:    "sent",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d %s", response.Code, response.Body.String())
	}
}

func TestRejectsInvalidRequest(t *testing.T) {
	_, handler := newTestServer(t)
	response := requestJSON(t, handler, http.MethodPost, "/sms/incoming", incomingSMS{
		Sender: "+8801712345678",
		Text:   "REQ|1|A17K|UNKNOWN|-",
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status: %d %s", response.Code, response.Body.String())
	}
}
