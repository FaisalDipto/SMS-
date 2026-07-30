package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
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
	if !strings.HasPrefix(gateway.Text, "RES|1|A17K|SHELTER|1/1|DHK|DEMO|SMSWEB_DEMO|") {
		t.Fatalf("unexpected response text: %s", gateway.Text)
	}
	if !strings.HasSuffix(gateway.Text, "|DU:23.7271:90.3944:0:FULL;MIRPUR:23.8069:90.3687:120:OPEN;UTTARA:23.8759:90.4002:80:OPEN") {
		t.Fatalf("unexpected shelter payload: %s", gateway.Text)
	}
	fields, err := splitFields(gateway.Text)
	if err != nil {
		t.Fatal(err)
	}
	if len(fields) != 11 {
		t.Fatalf("expected metadata response fields, got %d", len(fields))
	}
	verifiedAt, err := strconv.ParseInt(fields[8], 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	expiresAt, err := strconv.ParseInt(fields[9], 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	if expiresAt-verifiedAt != int64((6 * time.Hour).Seconds()) {
		t.Fatalf("expected six-hour demo expiry window, got %d seconds", expiresAt-verifiedAt)
	}

	count, err := store.MessageCount()
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("expected incoming and outgoing messages, got %d", count)
	}
}

func TestIncomingAlertRequest(t *testing.T) {
	_, handler := newTestServer(t)
	response := requestJSON(t, handler, http.MethodPost, "/sms/incoming", incomingSMS{
		Sender: "+8801712345678",
		Text:   "REQ|1|B33M|ALERT|DHK",
	})

	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d %s", response.Code, response.Body.String())
	}

	var gateway gatewayResponse
	if err := json.Unmarshal(response.Body.Bytes(), &gateway); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(gateway.Text, "ALT|1|F22P|HIGH|") {
		t.Fatalf("unexpected alert response: %s", gateway.Text)
	}
}

func TestMigratesLegacyShelterSchema(t *testing.T) {
	databasePath := t.TempDir() + "/legacy.db"
	database, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Exec(`
CREATE TABLE shelters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region TEXT NOT NULL,
    location TEXT NOT NULL,
    spaces INTEGER NOT NULL,
    status TEXT NOT NULL,
    UNIQUE(region, location)
)
`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Exec(`INSERT INTO shelters(region, location, spaces, status) VALUES ('DHK', 'MIRPUR', 120, 'OPEN')`)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	shelters, err := store.FindShelters("DHK")
	if err != nil {
		t.Fatal(err)
	}
	if len(shelters) != 3 {
		t.Fatalf("expected migrated and seeded shelters, got %d", len(shelters))
	}
	if shelters[1].Latitude != 23.8069 || shelters[1].Longitude != 90.3687 {
		t.Fatalf("expected migrated Mirpur coordinates, got %.4f, %.4f", shelters[1].Latitude, shelters[1].Longitude)
	}
	if shelters[1].Trust != "DEMO" || shelters[1].Source != "SMSWEB_DEMO" {
		t.Fatalf("expected migrated demo metadata, got %s from %s", shelters[1].Trust, shelters[1].Source)
	}
	if shelters[1].VerifiedAt <= 0 || shelters[1].ExpiresAt <= shelters[1].VerifiedAt {
		t.Fatalf("expected current migration timestamps, got %d to %d", shelters[1].VerifiedAt, shelters[1].ExpiresAt)
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
