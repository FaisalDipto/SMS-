package main

import (
	"crypto/hmac"
	"errors"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const maximumUpdateLifetimeMinutes = 7 * 24 * 60

var compactNamePattern = regexp.MustCompile(`^[A-Z0-9_-]{2,24}$`)

type shelterUpdate struct {
	Region           string  `json:"region"`
	Location         string  `json:"location"`
	Latitude         float64 `json:"latitude"`
	Longitude        float64 `json:"longitude"`
	Spaces           int     `json:"spaces"`
	Status           string  `json:"status"`
	Source           string  `json:"source"`
	ExpiresInMinutes int     `json:"expiresInMinutes"`
}

type hazardUpdate struct {
	HazardID         string  `json:"hazardId"`
	Kind             string  `json:"kind"`
	Region           string  `json:"region"`
	Latitude         float64 `json:"latitude"`
	Longitude        float64 `json:"longitude"`
	RadiusMeters     int     `json:"radiusMeters"`
	Severity         string  `json:"severity"`
	RoadName         string  `json:"roadName"`
	Description      string  `json:"description"`
	Source           string  `json:"source"`
	ExpiresInMinutes int     `json:"expiresInMinutes"`
}

type alertUpdate struct {
	AlertID          string `json:"alertId"`
	Priority         string `json:"priority"`
	Region           string `json:"region"`
	Message          string `json:"message"`
	ExpiresInMinutes int    `json:"expiresInMinutes"`
}

type adminState struct {
	Shelters []Shelter    `json:"shelters"`
	Hazards  []Hazard     `json:"hazards"`
	Alerts   []Alert      `json:"alerts"`
	Audit    []AuditEntry `json:"audit"`
}

func (server *Server) requireAdministrator(response http.ResponseWriter, request *http.Request) bool {
	provided := []byte(request.Header.Get("X-SMSWeb-Key"))
	if len(provided) != len(server.authenticationKey) ||
		!hmac.Equal(provided, server.authenticationKey) {
		writeError(response, http.StatusUnauthorized, errors.New("administrator authentication failed"))
		return false
	}
	return true
}

func (server *Server) adminState(response http.ResponseWriter, request *http.Request) {
	if !server.requireAdministrator(response, request) {
		return
	}
	now := time.Now().UTC()
	shelters, err := server.store.FindShelters("DHK")
	if err != nil {
		writeError(response, http.StatusInternalServerError, err)
		return
	}
	hazards, err := server.store.FindActiveHazards("DHK", now)
	if err != nil {
		writeError(response, http.StatusInternalServerError, err)
		return
	}
	alerts, err := server.store.FindActiveAlerts("DHK", now)
	if err != nil {
		writeError(response, http.StatusInternalServerError, err)
		return
	}
	audit, err := server.store.RecentAudit(20)
	if err != nil {
		writeError(response, http.StatusInternalServerError, err)
		return
	}
	writeJSON(response, http.StatusOK, adminState{
		Shelters: shelters,
		Hazards:  hazards,
		Alerts:   alerts,
		Audit:    audit,
	})
}

func (server *Server) updateShelter(response http.ResponseWriter, request *http.Request) {
	if !server.requireAdministrator(response, request) {
		return
	}
	var input shelterUpdate
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	input.Region = normalizeCompact(input.Region)
	input.Location = normalizeCompact(input.Location)
	input.Source = normalizeCompact(input.Source)
	input.Status = strings.ToUpper(strings.TrimSpace(input.Status))
	if err := validateCompactUpdate(input.Region, input.Location, input.Source); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	if !validCoordinate(input.Latitude, input.Longitude) {
		writeError(response, http.StatusBadRequest, errors.New("shelter coordinates are invalid"))
		return
	}
	if input.Spaces < 0 || !map[string]bool{
		"OPEN": true, "FULL": true, "CLOSED": true, "UNKNOWN": true,
	}[input.Status] {
		writeError(response, http.StatusBadRequest, errors.New("shelter spaces or status is invalid"))
		return
	}
	if err := validateLifetime(input.ExpiresInMinutes); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}

	now := time.Now().UTC().Unix()
	shelter := Shelter{
		Region:     input.Region,
		Location:   input.Location,
		Latitude:   input.Latitude,
		Longitude:  input.Longitude,
		Spaces:     input.Spaces,
		Status:     input.Status,
		Trust:      trustForSource(input.Source),
		Source:     input.Source,
		VerifiedAt: now,
		ExpiresAt:  now + int64(input.ExpiresInMinutes*60),
	}
	if err := server.store.UpsertShelter(shelter); err != nil {
		writeError(response, http.StatusInternalServerError, err)
		return
	}
	_ = server.store.SaveAudit(
		"UPSERT_SHELTER",
		shelter.Location,
		fmt.Sprintf("%s %d %s by %s", shelter.Region, shelter.Spaces, shelter.Status, shelter.Source),
		now,
	)
	writeJSON(response, http.StatusOK, shelter)
}

func (server *Server) updateHazard(response http.ResponseWriter, request *http.Request) {
	if !server.requireAdministrator(response, request) {
		return
	}
	var input hazardUpdate
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	input.HazardID = normalizeCompact(input.HazardID)
	input.Kind = strings.ToUpper(strings.TrimSpace(input.Kind))
	input.Region = normalizeCompact(input.Region)
	input.Severity = strings.ToUpper(strings.TrimSpace(input.Severity))
	input.Source = normalizeCompact(input.Source)
	input.RoadName = strings.TrimSpace(input.RoadName)
	input.Description = strings.TrimSpace(input.Description)
	if err := validateCompactUpdate(input.HazardID, input.Region, input.Source); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	if !validCoordinate(input.Latitude, input.Longitude) {
		writeError(response, http.StatusBadRequest, errors.New("hazard coordinates are invalid"))
		return
	}
	if !map[string]bool{
		"ROAD_CLOSED": true, "FLOOD": true, "FIRE": true, "UNSAFE": true,
	}[input.Kind] {
		writeError(response, http.StatusBadRequest, errors.New("unsupported hazard kind"))
		return
	}
	if !alertPriorities[input.Severity] {
		writeError(response, http.StatusBadRequest, errors.New("unsupported hazard severity"))
		return
	}
	if input.RadiusMeters < 10 || input.RadiusMeters > 2_000 {
		writeError(response, http.StatusBadRequest, errors.New("hazard radius must be between 10 and 2000 metres"))
		return
	}
	if input.RoadName == "" || len(input.RoadName) > 32 ||
		strings.ContainsAny(input.RoadName, ":;|") {
		writeError(response, http.StatusBadRequest, errors.New("road name must contain 1-32 safe characters"))
		return
	}
	if input.Description == "" || len(input.Description) > 120 {
		writeError(response, http.StatusBadRequest, errors.New("hazard description must contain 1-120 characters"))
		return
	}
	if err := validateLifetime(input.ExpiresInMinutes); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}

	now := time.Now().UTC().Unix()
	hazard := Hazard{
		HazardID:    input.HazardID,
		Kind:        input.Kind,
		Region:      input.Region,
		Latitude:    input.Latitude,
		Longitude:   input.Longitude,
		Radius:      input.RadiusMeters,
		Severity:    input.Severity,
		RoadName:    input.RoadName,
		Description: input.Description,
		Trust:       trustForSource(input.Source),
		Source:      input.Source,
		VerifiedAt:  now,
		ExpiresAt:   now + int64(input.ExpiresInMinutes*60),
	}
	if err := server.store.UpsertHazard(hazard); err != nil {
		writeError(response, http.StatusInternalServerError, err)
		return
	}
	_ = server.store.SaveAudit(
		"UPSERT_HAZARD",
		hazard.HazardID,
		fmt.Sprintf("%s on %s by %s", hazard.Kind, hazard.RoadName, hazard.Source),
		now,
	)
	writeJSON(response, http.StatusOK, hazard)
}

func (server *Server) updateAlert(response http.ResponseWriter, request *http.Request) {
	if !server.requireAdministrator(response, request) {
		return
	}
	var input alertUpdate
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	input.AlertID = normalizeCompact(input.AlertID)
	input.Priority = strings.ToUpper(strings.TrimSpace(input.Priority))
	input.Region = normalizeCompact(input.Region)
	input.Message = strings.TrimSpace(input.Message)
	if !identifierPattern.MatchString(input.AlertID) || !alertPriorities[input.Priority] {
		writeError(response, http.StatusBadRequest, errors.New("alert ID or priority is invalid"))
		return
	}
	if err := validateRegion(input.Region); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	if input.Message == "" || len(input.Message) > 80 {
		writeError(response, http.StatusBadRequest, errors.New("alert message must contain 1-80 characters"))
		return
	}
	if err := validateLifetime(input.ExpiresInMinutes); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}

	now := time.Now().UTC().Unix()
	alert := Alert{
		AlertID:  input.AlertID,
		Priority: input.Priority,
		Expires:  now + int64(input.ExpiresInMinutes*60),
		Region:   input.Region,
		Message:  input.Message,
	}
	if err := server.store.UpsertAlert(alert); err != nil {
		writeError(response, http.StatusInternalServerError, err)
		return
	}
	_ = server.store.SaveAudit(
		"UPSERT_ALERT",
		alert.AlertID,
		fmt.Sprintf("%s alert for %s", alert.Priority, alert.Region),
		now,
	)
	writeJSON(response, http.StatusOK, alert)
}

func normalizeCompact(value string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(value), " ", "_"))
}

func validateCompactUpdate(values ...string) error {
	for _, value := range values {
		if !compactNamePattern.MatchString(value) {
			return fmt.Errorf("compact identifiers must contain 2-24 uppercase letters, numbers, underscores, or hyphens")
		}
	}
	return nil
}

func validCoordinate(latitude, longitude float64) bool {
	return !math.IsNaN(latitude) && !math.IsNaN(longitude) &&
		latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
}

func validateLifetime(minutes int) error {
	if minutes < 5 || minutes > maximumUpdateLifetimeMinutes {
		return fmt.Errorf("expiry must be between 5 and %d minutes", maximumUpdateLifetimeMinutes)
	}
	return nil
}

func trustForSource(source string) string {
	if source == "SMSWEB_DEMO" {
		return "DEMO"
	}
	return "VERIFIED"
}
