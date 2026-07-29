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
	Region   string
	Location string
	Spaces   int
	Status   string
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

INSERT OR IGNORE INTO shelters(region, location, spaces, status) VALUES
    ('DHK', 'MIRPUR', 120, 'OPEN'),
    ('DHK', 'UTTARA', 80, 'OPEN'),
    ('DHK', 'DU', 0, 'FULL');

INSERT OR IGNORE INTO alerts(alert_id, priority, expires_at, region, message) VALUES
    ('F22P', 'HIGH', CAST(strftime('%s', 'now') AS INTEGER) + 86400, 'DHK', 'Avoid the road near Mirpur bridge');
`)
	if err != nil {
		return fmt.Errorf("initialize sqlite database: %w", err)
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
SELECT region, location, spaces, status
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
		if err := rows.Scan(&shelter.Region, &shelter.Location, &shelter.Spaces, &shelter.Status); err != nil {
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
