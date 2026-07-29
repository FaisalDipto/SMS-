package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const protocolVersion = "1"

var identifierPattern = regexp.MustCompile(`^[A-Z0-9]{2,16}$`)
var regionPattern = regexp.MustCompile(`^[A-Z0-9_-]{1,12}$`)

var allowedCommands = map[string]bool{
	"HOME":    true,
	"SHELTER": true,
	"MED":     true,
	"ROAD":    true,
	"REPORT":  true,
	"HELP":    true,
	"ALERT":   true,
}

var alertPriorities = map[string]bool{
	"LOW": true, "MEDIUM": true, "HIGH": true, "CRITICAL": true,
}

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

func SerializeResponse(requestID, page, region, payload string) (string, error) {
	if !identifierPattern.MatchString(requestID) {
		return "", fmt.Errorf("invalid request ID")
	}
	if page == "" {
		return "", fmt.Errorf("response page cannot be empty")
	}
	if err := validateRegion(region); err != nil {
		return "", err
	}

	fields := []string{
		"RES",
		protocolVersion,
		requestID,
		page,
		"1/1",
		region,
		payload,
	}
	for index := 1; index < len(fields); index++ {
		fields[index] = escapeField(fields[index])
	}
	return strings.Join(fields, "|"), nil
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

func compactShelter(location string, spaces int, status string) string {
	return strings.Join([]string{location, strconv.Itoa(spaces), status}, ":")
}
