CREATE TABLE IF NOT EXISTS clients (
  clinic_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  name TEXT,
  treatment_interest TEXT,
  appointment_slot TEXT,
  notes TEXT,
  first_contact TEXT DEFAULT (datetime('now')),
  last_contact TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (clinic_id, phone)
);
