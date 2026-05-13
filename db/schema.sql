-- db/schema.sql
-- Consolidated schema for all outreach-related tables.
-- Primary DB: .data/linkedin-brand-os.sqlite
-- Secondary DB: .data/outreach.db

-- ============================================================
-- outreach_emails
-- Populated by scout/scraper bots. One row per discovered lead.
-- ============================================================
CREATE TABLE IF NOT EXISTS outreach_emails (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  business_name       TEXT,
  business_email      TEXT,
  business_phone      TEXT,
  business_category   TEXT,
  business_website    TEXT,
  business_address    TEXT,
  owner_name          TEXT,
  subject             TEXT,
  body                TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  -- status: pending | sent | bounced | blocked | replied | unsubscribed
  source              TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_oe_email    ON outreach_emails(business_email);
CREATE INDEX IF NOT EXISTS idx_oe_status   ON outreach_emails(status);
CREATE INDEX IF NOT EXISTS idx_oe_category ON outreach_emails(business_category);
CREATE INDEX IF NOT EXISTS idx_oe_created  ON outreach_emails(created_at);

-- ============================================================
-- manual_hvac_outreach
-- Manually curated HVAC leads for voice-first outreach.
-- ============================================================
CREATE TABLE IF NOT EXISTS manual_hvac_outreach (
  id                  TEXT PRIMARY KEY,
  company             TEXT NOT NULL,
  phone               TEXT,
  email               TEXT,
  address             TEXT,
  website             TEXT,
  delivered           BOOLEAN NOT NULL DEFAULT FALSE,
  replied             BOOLEAN NOT NULL DEFAULT FALSE,
  meeting             BOOLEAN NOT NULL DEFAULT FALSE,
  refusal             BOOLEAN NOT NULL DEFAULT FALSE,
  next_step           TEXT    NOT NULL DEFAULT '',
  followup_due_at     TEXT    NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mho_status ON manual_hvac_outreach(meeting, refusal, delivered);

-- ============================================================
-- manual_pending_outreach (in .data/outreach.db)
-- 3-variant manual outreach per lead. Status lifecycle:
-- manual_pending -> sent -> replied | bounced | dead
-- ============================================================
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
  followup_at   TEXT    NOT NULL,
  sent_at       TEXT,
  replied_at    TEXT,
  outcome       TEXT,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mpo_lead_id  ON manual_pending_outreach(lead_id);
CREATE INDEX IF NOT EXISTS idx_mpo_status   ON manual_pending_outreach(status);
CREATE INDEX IF NOT EXISTS idx_mpo_followup ON manual_pending_outreach(followup_at);

CREATE VIEW IF NOT EXISTS v_pending_followup AS
  SELECT id, lead_id, company, email, phone, variant, subject, followup_at
  FROM   manual_pending_outreach
  WHERE  status = 'manual_pending'
    AND  followup_at <= datetime('now')
  ORDER  BY followup_at ASC;
