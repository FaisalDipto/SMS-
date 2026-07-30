package main

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

type Message struct {
	RequestID string
	Direction string
	RawText   string
	Status    string
	CreatedAt time.Time
}

type Shelter struct {
	Region     string  `json:"region"`
	Location   string  `json:"location"`
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
	Spaces     int     `json:"spaces"`
	Status     string  `json:"status"`
	Trust      string  `json:"trust"`
	Source     string  `json:"source"`
	VerifiedAt int64   `json:"verifiedAt"`
	ExpiresAt  int64   `json:"expiresAt"`
}

type Alert struct {
	AlertID  string `json:"alertId"`
	Priority string `json:"priority"`
	Expires  int64  `json:"expiresAt"`
	Region   string `json:"region"`
	Message  string `json:"message"`
}

type Hazard struct {
	HazardID    string  `json:"hazardId"`
	Kind        string  `json:"kind"`
	Region      string  `json:"region"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	Radius      int     `json:"radiusMeters"`
	Severity    string  `json:"severity"`
	RoadName    string  `json:"roadName"`
	Description string  `json:"description"`
	Trust       string  `json:"trust"`
	Source      string  `json:"source"`
	VerifiedAt  int64   `json:"verifiedAt"`
	ExpiresAt   int64   `json:"expiresAt"`
}

type AuditEntry struct {
	ID        int64  `json:"id"`
	Action    string `json:"action"`
	EntityID  string `json:"entityId"`
	Detail    string `json:"detail"`
	CreatedAt int64  `json:"createdAt"`
}

func OpenStore(path string) (*Store, error) {
	database, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}

	store := &Store{db: database}
	if err := store.initialize(); err != nil {
		database.Close()
		return nil, err
	}
	return store, nil
}

func (store *Store) initialize() error {
	_, err := store.db.Exec(`
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_request_id ON messages(request_id);

CREATE TABLE IF NOT EXISTS shelters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region TEXT NOT NULL,
    location TEXT NOT NULL,
    latitude REAL NOT NULL DEFAULT 0,
    longitude REAL NOT NULL DEFAULT 0,
    spaces INTEGER NOT NULL,
    status TEXT NOT NULL,
    trust TEXT NOT NULL DEFAULT 'DEMO',
    source TEXT NOT NULL DEFAULT 'SMSWEB_DEMO',
    verified_at INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL DEFAULT 0,
    UNIQUE(region, location)
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id TEXT NOT NULL UNIQUE,
    priority TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    region TEXT NOT NULL,
    message TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hazards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hazard_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    region TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    radius_meters INTEGER NOT NULL,
    severity TEXT NOT NULL,
    road_name TEXT NOT NULL,
    description TEXT NOT NULL,
    trust TEXT NOT NULL,
    source TEXT NOT NULL,
    verified_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

INSERT INTO alerts(alert_id, priority, expires_at, region, message) VALUES
    ('F22P', 'HIGH', CAST(strftime('%s', 'now') AS INTEGER) + 86400, 'DHK', 'Avoid the road near Mirpur bridge')
ON CONFLICT(alert_id) DO UPDATE SET
    expires_at = CAST(strftime('%s', 'now') AS INTEGER) + 86400;
`)
	if err != nil {
		return fmt.Errorf("initialize sqlite database: %w", err)
	}

	// Keep existing demo databases usable as geographic and trust metadata evolve.
	columns := map[string]string{
		"latitude":    "REAL NOT NULL DEFAULT 0",
		"longitude":   "REAL NOT NULL DEFAULT 0",
		"trust":       "TEXT NOT NULL DEFAULT 'DEMO'",
		"source":      "TEXT NOT NULL DEFAULT 'SMSWEB_DEMO'",
		"verified_at": "INTEGER NOT NULL DEFAULT 0",
		"expires_at":  "INTEGER NOT NULL DEFAULT 0",
	}
	for column, definition := range columns {
		if err := store.ensureShelterColumn(column, definition); err != nil {
			return err
		}
	}
	verifiedAt := time.Now().UTC().Unix()
	expiresAt := verifiedAt + int64((6 * time.Hour).Seconds())
	_, err = store.db.Exec(`
INSERT OR IGNORE INTO shelters(
    region, location, latitude, longitude, spaces, status,
    trust, source, verified_at, expires_at
) VALUES
    ('DHK', 'MIRPUR', 23.8069, 90.3687, 120, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'UTTARA', 23.8759, 90.4002, 80, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'DU', 23.7271, 90.3944, 0, 'FULL', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'MOHAMMADPUR', 23.7588, 90.3588, 65, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'DHANMONDI', 23.7465, 90.3760, 40, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'TEJGAON', 23.7631, 90.4007, 55, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'GULSHAN', 23.7925, 90.4078, 30, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'BASHUNDHARA', 23.8151, 90.4255, 75, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'MOTIJHEEL', 23.7337, 90.4176, 50, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'JATRABARI', 23.7104, 90.4340, 90, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'BANANI', 23.7937, 90.4066, 48, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'BADDA', 23.7806, 90.4267, 60, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'FARMGATE', 23.7582, 90.3906, 35, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'KALLYANPUR', 23.7795, 90.3615, 70, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'KHILGAON', 23.7509, 90.4250, 42, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'LALBAGH', 23.7182, 90.3880, 25, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'PALLABI', 23.8247, 90.3654, 85, 'OPEN', 'DEMO', 'SMSWEB_DEMO', ?, ?),
    ('DHK', 'RAMNA', 23.7377, 90.4016, 0, 'FULL', 'DEMO', 'SMSWEB_DEMO', ?, ?)
`, verifiedAt, expiresAt, verifiedAt, expiresAt, verifiedAt, expiresAt,
		verifiedAt, expiresAt, verifiedAt, expiresAt, verifiedAt, expiresAt,
		verifiedAt, expiresAt, verifiedAt, expiresAt, verifiedAt, expiresAt,
		verifiedAt, expiresAt, verifiedAt, expiresAt, verifiedAt, expiresAt,
		verifiedAt, expiresAt, verifiedAt, expiresAt, verifiedAt, expiresAt,
		verifiedAt, expiresAt, verifiedAt, expiresAt, verifiedAt, expiresAt)
	if err != nil {
		return fmt.Errorf("seed shelters: %w", err)
	}
	_, err = store.db.Exec(`
UPDATE shelters SET latitude = CASE location
    WHEN 'MIRPUR' THEN 23.8069
    WHEN 'UTTARA' THEN 23.8759
    WHEN 'DU' THEN 23.7271
    WHEN 'MOHAMMADPUR' THEN 23.7588
    WHEN 'DHANMONDI' THEN 23.7465
    WHEN 'TEJGAON' THEN 23.7631
    WHEN 'GULSHAN' THEN 23.7925
    WHEN 'BASHUNDHARA' THEN 23.8151
    WHEN 'MOTIJHEEL' THEN 23.7337
    WHEN 'JATRABARI' THEN 23.7104
    WHEN 'BANANI' THEN 23.7937
    WHEN 'BADDA' THEN 23.7806
    WHEN 'FARMGATE' THEN 23.7582
    WHEN 'KALLYANPUR' THEN 23.7795
    WHEN 'KHILGAON' THEN 23.7509
    WHEN 'LALBAGH' THEN 23.7182
    WHEN 'PALLABI' THEN 23.8247
    WHEN 'RAMNA' THEN 23.7377
    ELSE latitude
END,
longitude = CASE location
    WHEN 'MIRPUR' THEN 90.3687
    WHEN 'UTTARA' THEN 90.4002
    WHEN 'DU' THEN 90.3944
    WHEN 'MOHAMMADPUR' THEN 90.3588
    WHEN 'DHANMONDI' THEN 90.3760
    WHEN 'TEJGAON' THEN 90.4007
    WHEN 'GULSHAN' THEN 90.4078
    WHEN 'BASHUNDHARA' THEN 90.4255
    WHEN 'MOTIJHEEL' THEN 90.4176
    WHEN 'JATRABARI' THEN 90.4340
    WHEN 'BANANI' THEN 90.4066
    WHEN 'BADDA' THEN 90.4267
    WHEN 'FARMGATE' THEN 90.3906
    WHEN 'KALLYANPUR' THEN 90.3615
    WHEN 'KHILGAON' THEN 90.4250
    WHEN 'LALBAGH' THEN 90.3880
    WHEN 'PALLABI' THEN 90.3654
    WHEN 'RAMNA' THEN 90.4016
    ELSE longitude
END
WHERE region = 'DHK' AND (latitude = 0 OR longitude = 0);

UPDATE shelters
SET trust = 'DEMO',
    source = 'SMSWEB_DEMO',
    verified_at = ?,
    expires_at = ?
WHERE region = 'DHK'
  AND location IN (
      'MIRPUR', 'UTTARA', 'DU', 'MOHAMMADPUR', 'DHANMONDI',
      'TEJGAON', 'GULSHAN', 'BASHUNDHARA', 'MOTIJHEEL', 'JATRABARI',
      'BANANI', 'BADDA', 'FARMGATE', 'KALLYANPUR', 'KHILGAON',
      'LALBAGH', 'PALLABI', 'RAMNA'
  )
  AND source = 'SMSWEB_DEMO'
`, verifiedAt, expiresAt)
	if err != nil {
		return fmt.Errorf("refresh demo shelter metadata: %w", err)
	}
	_, err = store.db.Exec(`
INSERT INTO hazards(
    hazard_id, kind, region, latitude, longitude, radius_meters,
    severity, road_name, description, trust, source, verified_at, expires_at
) VALUES (
    'HZD1', 'ROAD_CLOSED', 'DHK', 23.8125, 90.3687, 90,
    'HIGH', 'Mirpur local road', 'Demonstration road closure',
    'DEMO', 'SMSWEB_DEMO', ?, ?
)
ON CONFLICT(hazard_id) DO UPDATE SET
    verified_at = excluded.verified_at,
    expires_at = excluded.expires_at
WHERE hazards.source = 'SMSWEB_DEMO'
`, verifiedAt, expiresAt)
	if err != nil {
		return fmt.Errorf("refresh demo hazard metadata: %w", err)
	}
	return nil
}

func (store *Store) ensureShelterColumn(column, definition string) error {
	rows, err := store.db.Query("PRAGMA table_info(shelters)")
	if err != nil {
		return fmt.Errorf("inspect shelter schema: %w", err)
	}
	defer rows.Close()

	var name string
	var found bool
	for rows.Next() {
		var cid int
		var columnType string
		var notNull int
		var defaultValue any
		var primaryKey int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return fmt.Errorf("read shelter schema: %w", err)
		}
		if name == column {
			found = true
			break
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read shelter schema rows: %w", err)
	}
	if found {
		return nil
	}

	allowedColumns := map[string]bool{
		"latitude": true, "longitude": true, "trust": true,
		"source": true, "verified_at": true, "expires_at": true,
	}
	if !allowedColumns[column] {
		return fmt.Errorf("unsupported shelter column: %s", column)
	}
	if _, err := store.db.Exec("ALTER TABLE shelters ADD COLUMN " + column + " " + definition); err != nil {
		return fmt.Errorf("add shelter %s: %w", column, err)
	}
	return nil
}

func (store *Store) Close() error {
	return store.db.Close()
}

func (store *Store) SaveMessage(message Message) error {
	if message.RequestID == "" || message.Direction == "" || message.RawText == "" || message.Status == "" {
		return fmt.Errorf("message fields cannot be empty")
	}
	_, err := store.db.Exec(`
INSERT INTO messages(request_id, direction, raw_text, status, created_at)
VALUES (?, ?, ?, ?, ?)
`, message.RequestID, message.Direction, message.RawText, message.Status, message.CreatedAt.UTC().Format(time.RFC3339Nano))
	return err
}

func (store *Store) UpdateMessageStatus(requestID, status string) error {
	result, err := store.db.Exec(`
UPDATE messages SET status = ?
WHERE request_id = ? AND direction = 'outgoing'
`, status, requestID)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("request ID not found: %s", requestID)
	}
	return nil
}

func (store *Store) FindShelters(region string) ([]Shelter, error) {
	rows, err := store.db.Query(`
SELECT region, location, latitude, longitude, spaces, status,
       trust, source, verified_at, expires_at
FROM shelters
WHERE region = ?
ORDER BY location
`, region)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var shelters []Shelter
	for rows.Next() {
		var shelter Shelter
		if err := rows.Scan(
			&shelter.Region,
			&shelter.Location,
			&shelter.Latitude,
			&shelter.Longitude,
			&shelter.Spaces,
			&shelter.Status,
			&shelter.Trust,
			&shelter.Source,
			&shelter.VerifiedAt,
			&shelter.ExpiresAt,
		); err != nil {
			return nil, err
		}
		shelters = append(shelters, shelter)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return shelters, nil
}

func (store *Store) FindActiveAlerts(region string, now time.Time) ([]Alert, error) {
	rows, err := store.db.Query(`
SELECT alert_id, priority, expires_at, region, message
FROM alerts
WHERE expires_at > ? AND (region = ? OR region = '-')
ORDER BY expires_at ASC
`, now.Unix(), region)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var alerts []Alert
	for rows.Next() {
		var alert Alert
		if err := rows.Scan(&alert.AlertID, &alert.Priority, &alert.Expires, &alert.Region, &alert.Message); err != nil {
			return nil, err
		}
		alerts = append(alerts, alert)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return alerts, nil
}

func (store *Store) FindActiveHazards(region string, now time.Time) ([]Hazard, error) {
	rows, err := store.db.Query(`
SELECT hazard_id, kind, region, latitude, longitude, radius_meters,
       severity, road_name, description, trust, source, verified_at, expires_at
FROM hazards
WHERE expires_at > ? AND (region = ? OR region = '-')
ORDER BY severity DESC, expires_at ASC
`, now.Unix(), region)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hazards []Hazard
	for rows.Next() {
		var hazard Hazard
		if err := rows.Scan(
			&hazard.HazardID,
			&hazard.Kind,
			&hazard.Region,
			&hazard.Latitude,
			&hazard.Longitude,
			&hazard.Radius,
			&hazard.Severity,
			&hazard.RoadName,
			&hazard.Description,
			&hazard.Trust,
			&hazard.Source,
			&hazard.VerifiedAt,
			&hazard.ExpiresAt,
		); err != nil {
			return nil, err
		}
		hazards = append(hazards, hazard)
	}
	return hazards, rows.Err()
}

func (store *Store) UpsertShelter(shelter Shelter) error {
	_, err := store.db.Exec(`
INSERT INTO shelters(
    region, location, latitude, longitude, spaces, status,
    trust, source, verified_at, expires_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(region, location) DO UPDATE SET
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    spaces = excluded.spaces,
    status = excluded.status,
    trust = excluded.trust,
    source = excluded.source,
    verified_at = excluded.verified_at,
    expires_at = excluded.expires_at
`, shelter.Region, shelter.Location, shelter.Latitude, shelter.Longitude,
		shelter.Spaces, shelter.Status, shelter.Trust, shelter.Source,
		shelter.VerifiedAt, shelter.ExpiresAt)
	return err
}

func (store *Store) UpsertHazard(hazard Hazard) error {
	_, err := store.db.Exec(`
INSERT INTO hazards(
    hazard_id, kind, region, latitude, longitude, radius_meters,
    severity, road_name, description, trust, source, verified_at, expires_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(hazard_id) DO UPDATE SET
    kind = excluded.kind,
    region = excluded.region,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    radius_meters = excluded.radius_meters,
    severity = excluded.severity,
    road_name = excluded.road_name,
    description = excluded.description,
    trust = excluded.trust,
    source = excluded.source,
    verified_at = excluded.verified_at,
    expires_at = excluded.expires_at
`, hazard.HazardID, hazard.Kind, hazard.Region, hazard.Latitude,
		hazard.Longitude, hazard.Radius, hazard.Severity, hazard.RoadName,
		hazard.Description, hazard.Trust, hazard.Source, hazard.VerifiedAt,
		hazard.ExpiresAt)
	return err
}

func (store *Store) UpsertAlert(alert Alert) error {
	_, err := store.db.Exec(`
INSERT INTO alerts(alert_id, priority, expires_at, region, message)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(alert_id) DO UPDATE SET
    priority = excluded.priority,
    expires_at = excluded.expires_at,
    region = excluded.region,
    message = excluded.message
`, alert.AlertID, alert.Priority, alert.Expires, alert.Region, alert.Message)
	return err
}

func (store *Store) SaveAudit(action, entityID, detail string, createdAt int64) error {
	_, err := store.db.Exec(`
INSERT INTO audit_log(action, entity_id, detail, created_at)
VALUES (?, ?, ?, ?)
`, action, entityID, detail, createdAt)
	return err
}

func (store *Store) RecentAudit(limit int) ([]AuditEntry, error) {
	rows, err := store.db.Query(`
SELECT id, action, entity_id, detail, created_at
FROM audit_log
ORDER BY id DESC
LIMIT ?
`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []AuditEntry
	for rows.Next() {
		var entry AuditEntry
		if err := rows.Scan(
			&entry.ID,
			&entry.Action,
			&entry.EntityID,
			&entry.Detail,
			&entry.CreatedAt,
		); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (store *Store) MessageCount() (int, error) {
	var count int
	err := store.db.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&count)
	return count, err
}
