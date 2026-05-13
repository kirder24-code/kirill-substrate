-- manual_pending_outreach.sql
-- Table for 3-variant manual outreach experiments per lead.
-- Target DB: .data/outreach.db
-- Status lifecycle: manual_pending -> sent -> replied | bounced | dead

CREATE TABLE IF NOT EXISTS manual_pending_outreach (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id       TEXT    NOT NULL,
  company       TEXT    NOT NULL,
  email         TEXT,
  phone         TEXT,
  variant       TEXT    NOT NULL,   -- 'ru_missed_call' | 'en_appointment' | 'bilingual_short'
  lang_primary  TEXT    NOT NULL,   -- 'ru' | 'en' | 'bilingual'
  subject       TEXT    NOT NULL,
  body          TEXT    NOT NULL,
  demo_number   TEXT,
  landing_url   TEXT,
  status        TEXT    NOT NULL DEFAULT 'manual_pending',
  followup_at   TEXT    NOT NULL,   -- ISO datetime ~24h from created_at
  sent_at       TEXT,
  replied_at    TEXT,
  outcome       TEXT,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mpo_lead_id    ON manual_pending_outreach(lead_id);
CREATE INDEX IF NOT EXISTS idx_mpo_status     ON manual_pending_outreach(status);
CREATE INDEX IF NOT EXISTS idx_mpo_followup   ON manual_pending_outreach(followup_at);

-- View: pending items due for follow-up
CREATE VIEW IF NOT EXISTS v_pending_followup AS
  SELECT id, lead_id, company, email, phone, variant, subject, followup_at
  FROM   manual_pending_outreach
  WHERE  status = 'manual_pending'
    AND  followup_at <= datetime('now')
  ORDER  BY followup_at ASC;
