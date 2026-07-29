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
	Region    string
	Location  string
	Latitude  float64
	Longitude float64
	Spaces    int
	Status    string
}

type Alert struct {
	AlertID  string
	Priority string
	Expires  int64
	Region   string
	Message  string
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

INSERT OR IGNORE INTO alerts(alert_id, priority, expires_at, region, message) VALUES
    ('F22P', 'HIGH', CAST(strftime('%s', 'now') AS INTEGER) + 86400, 'DHK', 'Avoid the road near Mirpur bridge');
`)
	if err != nil {
		return fmt.Errorf("initialize sqlite database: %w", err)
	}

	// Existing demo databases were created before shelter coordinates existed.
	// Keep them usable while adding the new geographic fields in place.
	for _, column := range []string{"latitude", "longitude"} {
		if err := store.ensureShelterColumn(column); err != nil {
			return err
		}
	}
	_, err = store.db.Exec(`
INSERT OR IGNORE INTO shelters(region, location, latitude, longitude, spaces, status) VALUES
    ('DHK', 'MIRPUR', 23.8069, 90.3687, 120, 'OPEN'),
    ('DHK', 'UTTARA', 23.8759, 90.4002, 80, 'OPEN'),
    ('DHK', 'DU', 23.7271, 90.3944, 0, 'FULL')
`)
	if err != nil {
		return fmt.Errorf("seed shelters: %w", err)
	}
	_, err = store.db.Exec(`
UPDATE shelters SET latitude = CASE location
    WHEN 'MIRPUR' THEN 23.8069
    WHEN 'UTTARA' THEN 23.8759
    WHEN 'DU' THEN 23.7271
    ELSE latitude
END,
longitude = CASE location
    WHEN 'MIRPUR' THEN 90.3687
    WHEN 'UTTARA' THEN 90.4002
    WHEN 'DU' THEN 90.3944
    ELSE longitude
END
WHERE region = 'DHK' AND (latitude = 0 OR longitude = 0)
`)
	if err != nil {
		return fmt.Errorf("backfill shelter coordinates: %w", err)
	}
	return nil
}

func (store *Store) ensureShelterColumn(column string) error {
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

	if column != "latitude" && column != "longitude" {
		return fmt.Errorf("unsupported shelter column: %s", column)
	}
	if _, err := store.db.Exec("ALTER TABLE shelters ADD COLUMN " + column + " REAL NOT NULL DEFAULT 0"); err != nil {
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
WHERE id = (SELECT id FROM messages WHERE request_id = ? ORDER BY id DESC LIMIT 1)
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
SELECT region, location, latitude, longitude, spaces, status
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
		if err := rows.Scan(&shelter.Region, &shelter.Location, &shelter.Latitude, &shelter.Longitude, &shelter.Spaces, &shelter.Status); err != nil {
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

func (store *Store) MessageCount() (int, error) {
	var count int
	err := store.db.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&count)
	return count, err
}
