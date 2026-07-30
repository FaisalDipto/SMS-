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
	if len(gateway.Messages) < 3 {
		t.Fatalf("expected multipart expanded shelter data, got %d parts: %#v", len(gateway.Messages), gateway.Messages)
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
	payload := strings.Join(payloadParts, ";")
	records := strings.Split(payload, ";")
	if len(records) != 18 {
		t.Fatalf("expected eighteen expanded demo shelter records, got %d: %s", len(records), payload)
	}
	for _, expected := range []string{
		"BADDA:23.7806:90.4267:60:OPEN",
		"BANANI:23.7937:90.4066:48:OPEN",
		"BASHUNDHARA:23.8151:90.4255:75:OPEN",
		"DHANMONDI:23.7465:90.376:40:OPEN",
		"DU:23.7271:90.3944:0:FULL",
		"FARMGATE:23.7582:90.3906:35:OPEN",
		"GULSHAN:23.7925:90.4078:30:OPEN",
		"JATRABARI:23.7104:90.434:90:OPEN",
		"KALLYANPUR:23.7795:90.3615:70:OPEN",
		"KHILGAON:23.7509:90.425:42:OPEN",
		"LALBAGH:23.7182:90.388:25:OPEN",
		"MIRPUR:23.8069:90.3687:120:OPEN",
		"MOHAMMADPUR:23.7588:90.3588:65:OPEN",
		"MOTIJHEEL:23.7337:90.4176:50:OPEN",
		"PALLABI:23.8247:90.3654:85:OPEN",
		"RAMNA:23.7377:90.4016:0:FULL",
		"TEJGAON:23.7631:90.4007:55:OPEN",
		"UTTARA:23.8759:90.4002:80:OPEN",
	} {
		if !strings.Contains(payload, expected) {
			t.Fatalf("expanded shelter payload is missing %s: %s", expected, payload)
		}
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
	if count != 1+len(gateway.Messages) {
		t.Fatalf(
			"expected one incoming and %d outgoing messages, got %d",
			len(gateway.Messages),
			count,
		)
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
	if !strings.HasPrefix(gateway.Text, "ALT|1|B33M|F22P|HIGH|") {
		t.Fatalf("unexpected alert response: %s", gateway.Text)
	}
	if !VerifyMessageSignature(gateway.Text, testAuthenticationKey) {
		t.Fatalf("expected signed alert response: %s", gateway.Text)
	}
}

func TestRepeatedAlertRequestsProduceDistinctCorrelatedResponses(t *testing.T) {
	_, handler := newTestServer(t)
	var responses []string

	for _, requestID := range []string{"B33M", "C44P"} {
		response := requestJSON(t, handler, http.MethodPost, "/sms/incoming", incomingSMS{
			Sender: "+8801712345678",
			Text:   "REQ|1|" + requestID + "|ALERT|DHK",
		})
		if response.Code != http.StatusOK {
			t.Fatalf("unexpected status: %d %s", response.Code, response.Body.String())
		}

		var gateway gatewayResponse
		if err := json.Unmarshal(response.Body.Bytes(), &gateway); err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(gateway.Text, "ALT|1|"+requestID+"|F22P|") {
			t.Fatalf("alert response is not correlated to %s: %s", requestID, gateway.Text)
		}
		if !VerifyMessageSignature(gateway.Text, testAuthenticationKey) {
			t.Fatalf("expected signed alert response: %s", gateway.Text)
		}
		responses = append(responses, gateway.Text)
	}

	if responses[0] == responses[1] {
		t.Fatal("repeated alert requests must not produce replay-identical responses")
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
	if len(shelters) != 18 {
		t.Fatalf("expected migrated and seeded shelters, got %d", len(shelters))
	}
	var mirpur Shelter
	for _, shelter := range shelters {
		if shelter.Location == "MIRPUR" {
			mirpur = shelter
			break
		}
	}
	if mirpur.Latitude != 23.8069 || mirpur.Longitude != 90.3687 {
		t.Fatalf("expected migrated Mirpur coordinates, got %.4f, %.4f", mirpur.Latitude, mirpur.Longitude)
	}
	if mirpur.Trust != "DEMO" || mirpur.Source != "SMSWEB_DEMO" {
		t.Fatalf("expected migrated demo metadata, got %s from %s", mirpur.Trust, mirpur.Source)
	}
	if mirpur.VerifiedAt <= 0 || mirpur.ExpiresAt <= mirpur.VerifiedAt {
		t.Fatalf("expected current migration timestamps, got %d to %d", mirpur.VerifiedAt, mirpur.ExpiresAt)
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
