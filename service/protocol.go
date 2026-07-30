package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const protocolVersion = "1"
const minimumAuthenticationKeyBytes = 16
const authenticationTagBytes = 16

var identifierPattern = regexp.MustCompile(`^[A-Z0-9]{2,16}$`)
var regionPattern = regexp.MustCompile(`^[A-Z0-9_-]{1,12}$`)
var responsePartPattern = regexp.MustCompile(`^([1-9][0-9]*)/([1-9][0-9]*)$`)

var allowedCommands = map[string]bool{
	"HOME":    true,
	"SHELTER": true,
	"MED":     true,
	"ROAD":    true,
	"REPORT":  true,
	"HELP":    true,
	"ALERT":   true,
	"HAZARD":  true,
}

var alertPriorities = map[string]bool{
	"LOW": true, "MEDIUM": true, "HIGH": true, "CRITICAL": true,
}

var responseTrustLevels = map[string]bool{
	"VERIFIED":   true,
	"DEMO":       true,
	"UNVERIFIED": true,
}

var sourcePattern = regexp.MustCompile(`^[A-Z0-9_-]{2,24}$`)

type Request struct {
	Type      string
	Version   string
	RequestID string
	Command   string
	Arguments string
}

func splitFields(text string) ([]string, error) {
	var fields []string
	var field strings.Builder
	escaped := false

	for _, character := range strings.TrimSpace(text) {
		if escaped {
			if character != '|' && character != '\\' {
				return nil, fmt.Errorf("unsupported escape sequence: \\%c", character)
			}
			field.WriteRune(character)
			escaped = false
			continue
		}

		switch character {
		case '\\':
			escaped = true
		case '|':
			fields = append(fields, field.String())
			field.Reset()
		default:
			field.WriteRune(character)
		}
	}

	if escaped {
		return nil, fmt.Errorf("message ends with an incomplete escape sequence")
	}

	return append(fields, field.String()), nil
}

func ParseRequest(text string) (Request, error) {
	fields, err := splitFields(text)
	if err != nil {
		return Request{}, err
	}
	if len(fields) != 5 || fields[0] != "REQ" {
		return Request{}, fmt.Errorf("request must contain REQ and four fields")
	}
	if fields[1] != protocolVersion {
		return Request{}, fmt.Errorf("unsupported protocol version: %s", fields[1])
	}
	if !identifierPattern.MatchString(fields[2]) {
		return Request{}, fmt.Errorf("invalid request ID")
	}
	if !allowedCommands[fields[3]] {
		return Request{}, fmt.Errorf("unknown command: %s", fields[3])
	}
	if fields[4] == "" {
		return Request{}, fmt.Errorf("request arguments cannot be empty")
	}

	return Request{
		Type:      fields[0],
		Version:   fields[1],
		RequestID: fields[2],
		Command:   fields[3],
		Arguments: fields[4],
	}, nil
}

func validateRegion(region string) error {
	if region == "-" || regionPattern.MatchString(region) {
		return nil
	}
	return fmt.Errorf("invalid region: %s", region)
}

func escapeField(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	return strings.ReplaceAll(value, `|`, `\|`)
}

type ResponseMetadata struct {
	Trust      string
	Source     string
	VerifiedAt int64
	ExpiresAt  int64
}

func validateResponseMetadata(metadata ResponseMetadata) error {
	if !responseTrustLevels[metadata.Trust] {
		return fmt.Errorf("invalid response trust level")
	}
	if !sourcePattern.MatchString(metadata.Source) {
		return fmt.Errorf("invalid response source")
	}
	if metadata.VerifiedAt <= 0 {
		return fmt.Errorf("response verification time must be positive")
	}
	if metadata.ExpiresAt <= metadata.VerifiedAt {
		return fmt.Errorf("response expiry must be later than verification time")
	}
	return nil
}

func serializeResponsePart(requestID, page, part, region, payload string, metadata ...ResponseMetadata) (string, error) {
	if !identifierPattern.MatchString(requestID) {
		return "", fmt.Errorf("invalid request ID")
	}
	if page == "" {
		return "", fmt.Errorf("response page cannot be empty")
	}
	if err := validateRegion(region); err != nil {
		return "", err
	}
	partMatch := responsePartPattern.FindStringSubmatch(part)
	if len(partMatch) != 3 {
		return "", fmt.Errorf("response part must use PART/TOTAL")
	}
	partNumber, _ := strconv.Atoi(partMatch[1])
	totalParts, _ := strconv.Atoi(partMatch[2])
	if partNumber > totalParts {
		return "", fmt.Errorf("response part cannot exceed total")
	}

	fields := []string{
		"RES",
		protocolVersion,
		requestID,
		page,
		part,
		region,
	}
	if len(metadata) > 1 {
		return "", fmt.Errorf("response accepts at most one metadata record")
	}
	if len(metadata) == 1 {
		if err := validateResponseMetadata(metadata[0]); err != nil {
			return "", err
		}
		fields = append(fields,
			metadata[0].Trust,
			metadata[0].Source,
			strconv.FormatInt(metadata[0].VerifiedAt, 10),
			strconv.FormatInt(metadata[0].ExpiresAt, 10),
		)
	}
	fields = append(fields, payload)
	for index := 1; index < len(fields); index++ {
		fields[index] = escapeField(fields[index])
	}
	return strings.Join(fields, "|"), nil
}

func SerializeResponse(requestID, page, region, payload string, metadata ...ResponseMetadata) (string, error) {
	return serializeResponsePart(requestID, page, "1/1", region, payload, metadata...)
}

func SerializeResponseParts(
	requestID,
	page,
	region,
	payload string,
	maxPayloadCharacters int,
	metadata ...ResponseMetadata,
) ([]string, error) {
	if maxPayloadCharacters <= 0 {
		return nil, fmt.Errorf("maximum payload characters must be positive")
	}
	if payload == "" {
		message, err := SerializeResponse(requestID, page, region, payload, metadata...)
		return []string{message}, err
	}

	records := strings.Split(payload, ";")
	chunks := make([]string, 0, len(records))
	current := ""
	for _, record := range records {
		if record == "" {
			return nil, fmt.Errorf("response payload contains an empty record")
		}
		candidate := record
		if current != "" {
			candidate = current + ";" + record
		}
		if len(candidate) <= maxPayloadCharacters {
			current = candidate
			continue
		}
		if current != "" {
			chunks = append(chunks, current)
		}
		current = record
	}
	if current != "" {
		chunks = append(chunks, current)
	}

	messages := make([]string, 0, len(chunks))
	for index, chunk := range chunks {
		part := fmt.Sprintf("%d/%d", index+1, len(chunks))
		message, err := serializeResponsePart(requestID, page, part, region, chunk, metadata...)
		if err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, nil
}

func SerializeError(requestID, code, message string) string {
	return strings.Join([]string{
		"ERR",
		protocolVersion,
		escapeField(requestID),
		escapeField(code),
		escapeField(message),
	}, "|")
}

func SerializeAlert(alertID, priority string, expires int64, region, message string) (string, error) {
	if !identifierPattern.MatchString(alertID) {
		return "", fmt.Errorf("invalid alert ID")
	}
	if !alertPriorities[priority] {
		return "", fmt.Errorf("invalid alert priority")
	}
	if expires <= 0 {
		return "", fmt.Errorf("alert expiry must be positive")
	}
	if err := validateRegion(region); err != nil {
		return "", err
	}
	if strings.TrimSpace(message) == "" {
		return "", fmt.Errorf("alert message cannot be empty")
	}

	fields := []string{
		"ALT",
		protocolVersion,
		alertID,
		priority,
		strconv.FormatInt(expires, 10),
		region,
		message,
	}
	for index := 1; index < len(fields); index++ {
		fields[index] = escapeField(fields[index])
	}
	return strings.Join(fields, "|"), nil
}

func parseShelterRegion(arguments string) (string, error) {
	region := strings.TrimSpace(arguments)
	if region == "" || region == "-" {
		return "DHK", nil
	}
	if err := validateRegion(region); err != nil {
		return "", err
	}
	return region, nil
}

func compactShelter(location string, latitude, longitude float64, spaces int, status string) string {
	return strings.Join([]string{
		location,
		strconv.FormatFloat(latitude, 'f', -1, 64),
		strconv.FormatFloat(longitude, 'f', -1, 64),
		strconv.Itoa(spaces),
		status,
	}, ":")
}

func compactHazard(hazard Hazard) string {
	kindCodes := map[string]string{
		"ROAD_CLOSED": "C",
		"FLOOD":       "F",
		"FIRE":        "R",
		"UNSAFE":      "U",
	}
	severityCodes := map[string]string{
		"LOW": "L", "MEDIUM": "M", "HIGH": "H", "CRITICAL": "C",
	}
	roadName := strings.ReplaceAll(hazard.RoadName, " ", "_")
	if len(roadName) > 20 {
		roadName = roadName[:20]
	}
	return strings.Join([]string{
		hazard.HazardID,
		kindCodes[hazard.Kind],
		strconv.FormatFloat(hazard.Latitude, 'f', 4, 64),
		strconv.FormatFloat(hazard.Longitude, 'f', 4, 64),
		strconv.Itoa(hazard.Radius),
		severityCodes[hazard.Severity],
		roadName,
	}, ":")
}

func SignMessage(message string, authenticationKey []byte) (string, error) {
	if len(authenticationKey) < minimumAuthenticationKeyBytes {
		return "", fmt.Errorf("authentication key must contain at least %d bytes", minimumAuthenticationKeyBytes)
	}
	if strings.TrimSpace(message) == "" {
		return "", fmt.Errorf("message to sign cannot be empty")
	}

	mac := hmac.New(sha256.New, authenticationKey)
	_, _ = mac.Write([]byte(message))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil)[:authenticationTagBytes])
	return message + "|" + signature, nil
}

func VerifyMessageSignature(message string, authenticationKey []byte) bool {
	if len(authenticationKey) < minimumAuthenticationKeyBytes {
		return false
	}
	separator := strings.LastIndex(message, "|")
	if separator <= 0 || separator == len(message)-1 {
		return false
	}

	provided, err := base64.RawURLEncoding.DecodeString(message[separator+1:])
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, authenticationKey)
	_, _ = mac.Write([]byte(message[:separator]))
	expected := mac.Sum(nil)[:authenticationTagBytes]
	return len(provided) == authenticationTagBytes && hmac.Equal(provided, expected)
}
