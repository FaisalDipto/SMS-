package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

type Server struct {
	store *Store
}

type incomingSMS struct {
	Sender string `json:"sender"`
	Text   string `json:"text"`
}

type gatewayResponse struct {
	Recipient string `json:"recipient"`
	Text      string `json:"text"`
}

type responseStatus struct {
	RequestID string `json:"requestId"`
	Status    string `json:"status"`
}

func NewServer(store *Store) http.Handler {
	server := &Server{store: store}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", server.health)
	mux.HandleFunc("POST /sms/incoming", server.incoming)
	mux.HandleFunc("POST /sms/response", server.response)
	return mux
}

func (server *Server) health(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]string{"status": "ok"})
}

func (server *Server) incoming(response http.ResponseWriter, request *http.Request) {
	var payload incomingSMS
	if err := decodeJSON(request, &payload); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}

	payload.Sender = strings.TrimSpace(payload.Sender)
	payload.Text = strings.TrimSpace(payload.Text)
	if payload.Sender == "" || payload.Text == "" {
		writeError(response, http.StatusBadRequest, errors.New("sender and text are required"))
		return
	}

	parsedRequest, err := ParseRequest(payload.Text)
	if err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}

	now := time.Now().UTC()
	if err := server.store.SaveMessage(Message{
		RequestID: parsedRequest.RequestID,
		Direction: "incoming",
		RawText:   payload.Text,
		Status:    "received",
		CreatedAt: now,
	}); err != nil {
		writeError(response, http.StatusInternalServerError, err)
		return
	}

	responseText, err := server.createResponse(parsedRequest)
	if err != nil {
		responseText = SerializeError(parsedRequest.RequestID, "SERVICE_ERROR", err.Error())
	}

	if err := server.store.SaveMessage(Message{
		RequestID: parsedRequest.RequestID,
		Direction: "outgoing",
		RawText:   responseText,
		Status:    "queued",
		CreatedAt: now,
	}); err != nil {
		writeError(response, http.StatusInternalServerError, err)
		return
	}

	writeJSON(response, http.StatusOK, gatewayResponse{
		Recipient: payload.Sender,
		Text:      responseText,
	})
}

func (server *Server) response(response http.ResponseWriter, request *http.Request) {
	var payload responseStatus
	if err := decodeJSON(request, &payload); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}

	payload.RequestID = strings.TrimSpace(payload.RequestID)
	payload.Status = strings.TrimSpace(payload.Status)
	if payload.RequestID == "" || !map[string]bool{"queued": true, "sent": true, "failed": true, "received": true}[payload.Status] {
		writeError(response, http.StatusBadRequest, errors.New("requestId and a valid status are required"))
		return
	}

	if err := server.store.UpdateMessageStatus(payload.RequestID, payload.Status); err != nil {
		writeError(response, http.StatusNotFound, err)
		return
	}

	writeJSON(response, http.StatusOK, map[string]string{"status": payload.Status})
}

func (server *Server) createResponse(request Request) (string, error) {
	switch request.Command {
	case "SHELTER":
		region, err := parseShelterRegion(request.Arguments)
		if err != nil {
			return "", err
		}
		shelters, err := server.store.FindShelters(region)
		if err != nil {
			return "", err
		}

		records := make([]string, 0, len(shelters))
		for _, shelter := range shelters {
			records = append(records, compactShelter(
				shelter.Location,
				shelter.Latitude,
				shelter.Longitude,
				shelter.Spaces,
				shelter.Status,
			))
		}
		return SerializeResponse(request.RequestID, "SHELTER", region, strings.Join(records, ";"))
	case "HOME":
		return SerializeResponse(request.RequestID, "HOME", "-", "SMSWeb crisis service")
	case "HELP":
		return SerializeResponse(request.RequestID, "HELP", "-", "HOME;SHELTER;MED;ROAD;REPORT;HELP;ALERT")
	case "ALERT":
		region, err := parseShelterRegion(request.Arguments)
		if err != nil {
			return "", err
		}
		alerts, err := server.store.FindActiveAlerts(region, time.Now().UTC())
		if err != nil {
			return "", err
		}
		if len(alerts) == 0 {
			return SerializeError(request.RequestID, "NO_ALERTS", "No active alerts are available"), nil
		}
		alert := alerts[0]
		return SerializeAlert(alert.AlertID, alert.Priority, alert.Expires, alert.Region, alert.Message)
	default:
		return SerializeError(request.RequestID, "NOT_IMPLEMENTED", fmt.Sprintf("command %s is not implemented", request.Command)), nil
	}
}

func decodeJSON(request *http.Request, destination any) error {
	if request.Header.Get("Content-Type") != "application/json" {
		return errors.New("Content-Type must be application/json")
	}
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(destination)
}

func writeJSON(response http.ResponseWriter, status int, payload any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(payload)
}

func writeError(response http.ResponseWriter, status int, err error) {
	writeJSON(response, status, map[string]string{"error": err.Error()})
}

func main() {
	address := flag.String("addr", ":8080", "HTTP listen address")
	databasePath := flag.String("db", "smsweb.db", "SQLite database path")
	flag.Parse()

	store, err := OpenStore(*databasePath)
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()

	log.Printf("SMSWeb crisis service listening on %s", *address)
	log.Fatal(http.ListenAndServe(*address, NewServer(store)))
}
