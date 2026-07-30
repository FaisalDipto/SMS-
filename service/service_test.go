package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

var testAuthenticationKey = []byte("smsweb-test-key-2026")

func newTestServer(t *testing.T) (*Store, http.Handler) {
	t.Helper()
	store, err := OpenStore("file:test-smsweb?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, NewServer(store, testAuthenticationKey)
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

func requestAdminJSON(
	t *testing.T,
	handler http.Handler,
	method string,
	path string,
	payload any,
	key string,
) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-SMSWeb-Key", key)
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

func TestAdministratorUpdatesRequireTheSharedKeyAndWriteAudit(t *testing.T) {
	_, handler := newTestServer(t)
	update := hazardUpdate{
		HazardID:         "HZD9",
		Kind:             "FLOOD",
		Region:           "DHK",
		Latitude:         23.8101,
		Longitude:        90.3691,
		RadiusMeters:     120,
		Severity:         "HIGH",
		RoadName:         "Mirpur Road",
		Description:      "Flood water across the carriageway",
		Source:           "DHK_EOC",
		ExpiresInMinutes: 90,
	}

	unauthorized := requestAdminJSON(
		t, handler, http.MethodPost, "/admin/hazards", update, "wrong-key",
	)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized admin update, got %d", unauthorized.Code)
	}

	authorized := requestAdminJSON(
		t,
		handler,
		http.MethodPost,
		"/admin/hazards",
		update,
		string(testAuthenticationKey),
	)
	if authorized.Code != http.StatusOK {
		t.Fatalf("unexpected admin update response: %d %s", authorized.Code, authorized.Body)
	}

	stateRequest := httptest.NewRequest(http.MethodGet, "/admin/state", nil)
	stateRequest.Header.Set("X-SMSWeb-Key", string(testAuthenticationKey))
	stateResponse := httptest.NewRecorder()
	handler.ServeHTTP(stateResponse, stateRequest)
	if stateResponse.Code != http.StatusOK {
		t.Fatalf("unexpected admin state response: %d %s", stateResponse.Code, stateResponse.Body)
	}
	var state adminState
	if err := json.Unmarshal(stateResponse.Body.Bytes(), &state); err != nil {
		t.Fatal(err)
	}
	if len(state.Hazards) == 0 || state.Hazards[0].Trust != "VERIFIED" {
		t.Fatalf("expected a verified active hazard, got %#v", state.Hazards)
	}
	if len(state.Audit) == 0 || state.Audit[0].Action != "UPSERT_HAZARD" {
		t.Fatalf("expected hazard audit entry, got %#v", state.Audit)
	}
}

func TestIncomingHazardRequestReturnsSignedCompactHazards(t *testing.T) {
	_, handler := newTestServer(t)
	response := requestJSON(t, handler, http.MethodPost, "/sms/incoming", incomingSMS{
		Sender: "+8801712345678",
		Text:   "REQ|1|HZ99|HAZARD|DHK",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d %s", response.Code, response.Body)
	}
	var gateway gatewayResponse
	if err := json.Unmarshal(response.Body.Bytes(), &gateway); err != nil {
		t.Fatal(err)
	}
	if len(gateway.Messages) == 0 {
		t.Fatal("expected at least one hazard response")
	}
	for _, message := range gateway.Messages {
		if len(message) > 153 {
			t.Fatalf("hazard SMS exceeds protocol limit: %d", len(message))
		}
		if !VerifyMessageSignature(message, testAuthenticationKey) {
			t.Fatal("hazard response signature is invalid")
		}
		fields, err := splitFields(message)
		if err != nil {
			t.Fatal(err)
		}
		if len(fields) != 12 || fields[3] != "HAZARD" {
			t.Fatalf("unexpected hazard response fields: %#v", fields)
		}
	}
}

func TestJudgeDemoEndpointIsExplicitlyOptIn(t *testing.T) {
	store, handler := newTestServer(t)
	disabled := httptest.NewRecorder()
	handler.ServeHTTP(disabled, httptest.NewRequest(http.MethodGet, "/demo/scenario", nil))
	if disabled.Code != http.StatusNotFound {
		t.Fatalf("demo endpoint should be disabled by default, got %d", disabled.Code)
	}

	enabledHandler := NewServerWithOptions(store, testAuthenticationKey, ServerOptions{
		DemoEnabled: true,
	})
	enabled := httptest.NewRecorder()
	enabledHandler.ServeHTTP(enabled, httptest.NewRequest(http.MethodGet, "/demo/scenario", nil))
	if enabled.Code != http.StatusOK {
		t.Fatalf("unexpected demo endpoint status: %d %s", enabled.Code, enabled.Body)
	}
	var scenario struct {
		Mode     string             `json:"mode"`
		Messages []string           `json:"messages"`
		Location map[string]float64 `json:"location"`
	}
	if err := json.Unmarshal(enabled.Body.Bytes(), &scenario); err != nil {
		t.Fatal(err)
	}
	if scenario.Mode != "DEMO" || len(scenario.Messages) < 3 {
		t.Fatalf("unexpected demo scenario: %#v", scenario)
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
	if len(gateway.Messages) != 2 {
		t.Fatalf("expected two protocol parts, got %d: %#v", len(gateway.Messages), gateway.Messages)
	}
	if gateway.Text != gateway.Messages[0] {
		t.Fatalf("legacy text field should contain the first part")
	}
	var payloadParts []string
	var firstFields []string
	for index, message := range gateway.Messages {
		if len(message) > 153 {
			t.Fatalf("signed protocol message %d exceeds concatenated GSM segment size: %d", index+1, len(message))
		}
		if !VerifyMessageSignature(message, testAuthenticationKey) {
			t.Fatalf("protocol message %d has an invalid signature", index+1)
		}
		fields, err := splitFields(message)
		if err != nil {
			t.Fatal(err)
		}
		if len(fields) != 12 {
			t.Fatalf("expected metadata and signature response fields, got %d", len(fields))
		}
		expectedPart := fmt.Sprintf("%d/%d", index+1, len(gateway.Messages))
		if fields[4] != expectedPart {
			t.Fatalf("expected part %s, got %s", expectedPart, fields[4])
		}
		if index == 0 {
			firstFields = fields
		}
		payloadParts = append(payloadParts, fields[10])
	}
	if strings.Join(payloadParts, ";") != "DU:23.7271:90.3944:0:FULL;MIRPUR:23.8069:90.3687:120:OPEN;UTTARA:23.8759:90.4002:80:OPEN" {
		t.Fatalf("unexpected reconstructed shelter payload: %s", strings.Join(payloadParts, ";"))
	}
	verifiedAt, err := strconv.ParseInt(firstFields[8], 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	expiresAt, err := strconv.ParseInt(firstFields[9], 10, 64)
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
	if count != 3 {
		t.Fatalf("expected one incoming and two outgoing messages, got %d", count)
	}
}

func TestResponsePaginationRejectsInvalidPartsAndKeepsRecordsWhole(t *testing.T) {
	metadata := ResponseMetadata{
		Trust: "DEMO", Source: "SMSWEB_DEMO", VerifiedAt: 100, ExpiresAt: 200,
	}
	messages, err := SerializeResponseParts(
		"A17K",
		"SHELTER",
		"DHK",
		"FIRST:1:OPEN;SECOND:2:OPEN;THIRD:3:OPEN",
		20,
		metadata,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 3 {
		t.Fatalf("expected three record-aligned parts, got %d", len(messages))
	}
	for index, message := range messages {
		fields, err := splitFields(message)
		if err != nil {
			t.Fatal(err)
		}
		if fields[4] != fmt.Sprintf("%d/3", index+1) {
			t.Fatalf("unexpected pagination in %s", message)
		}
		if strings.Contains(fields[10], ";") {
			t.Fatalf("expected each record to remain whole, got %s", fields[10])
		}
	}

	if _, err := serializeResponsePart("A17K", "SHELTER", "3/2", "DHK", "x"); err == nil {
		t.Fatal("expected invalid part numbering to fail")
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
	if !VerifyMessageSignature(gateway.Text, testAuthenticationKey) {
		t.Fatalf("expected signed alert response: %s", gateway.Text)
	}
}

func TestMessageAuthenticationRejectsTamperingAndWeakKeys(t *testing.T) {
	message := "RES|1|A17K|SHELTER|1/1|DHK|DEMO|SMSWEB_DEMO|100|200|MIRPUR:120:OPEN"
	signed, err := SignMessage(message, testAuthenticationKey)
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyMessageSignature(signed, testAuthenticationKey) {
		t.Fatal("expected valid signed message")
	}
	for _, tampered := range []string{
		strings.Replace(signed, "120", "999", 1),
		strings.Replace(signed, "MIRPUR", "UTTARA", 1),
		strings.Replace(signed, "|200|", "|201|", 1),
		signed[:len(signed)-1] + "A",
	} {
		if VerifyMessageSignature(tampered, testAuthenticationKey) {
			t.Fatalf("tampered message passed authentication: %s", tampered)
		}
	}
	if _, err := SignMessage(message, []byte("short")); err == nil {
		t.Fatal("expected weak authentication key to be rejected")
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
