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

CREATE TABLE IF NOT EXISTS leads (
  clinic_id TEXT NOT NULL,
  leadgen_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  name TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  follow_up_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (clinic_id, leadgen_id)
);

CREATE INDEX IF NOT EXISTS idx_leads_clinic_phone ON leads (clinic_id, phone);
CREATE INDEX IF NOT EXISTS idx_leads_clinic_status ON leads (clinic_id, status);

CREATE TABLE IF NOT EXISTS lead_followups (
  clinic_id TEXT NOT NULL,
  leadgen_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TEXT,
  PRIMARY KEY (clinic_id, leadgen_id, step)
);

CREATE INDEX IF NOT EXISTS idx_lead_followups_due ON lead_followups (status, due_at);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id TEXT NOT NULL,
  patient_phone TEXT NOT NULL,
  patient_name TEXT,
  treatment TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  source TEXT NOT NULL DEFAULT 'whatsapp_ai',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_appointments_clinic_date ON appointments (clinic_id, date, time);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments (clinic_id, patient_phone);
CREATE INDEX IF NOT EXISTS idx_appointments_active_window ON appointments (clinic_id, status, start_at, end_at);
