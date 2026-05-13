-- Lead status table for manual HVAC voice-first outreach
-- One row per lead, updated manually after each contact attempt

CREATE TABLE IF NOT EXISTS manual_hvac_outreach (
  id           TEXT PRIMARY KEY,
  company      TEXT NOT NULL,
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  website      TEXT,
  -- status fields
  delivered    BOOLEAN NOT NULL DEFAULT FALSE,  -- call/email was made
  replied      BOOLEAN NOT NULL DEFAULT FALSE,  -- lead responded
  meeting      BOOLEAN NOT NULL DEFAULT FALSE,  -- demo/meeting booked
  refusal      BOOLEAN NOT NULL DEFAULT FALSE,  -- explicit no
  next_step       TEXT    NOT NULL DEFAULT '',     -- free-text: callback date, followup note
  followup_due_at TEXT    NOT NULL DEFAULT '',     -- ISO datetime: when to next contact
  -- timestamps
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed the 8 leads
INSERT OR IGNORE INTO manual_hvac_outreach (id, company, phone, email, address, website) VALUES
  ('hvac-001', 'Fagnan''s Furnace Services',          '403-910-2556', 'info@fagnans.ca',                     '5025 23 Ave SE, Calgary, AB',         'https://www.fagnansfurnace.ca/'),
  ('hvac-002', 'Cassel HVAC and Refrigeration',       '403-800-2579', 'Service@casselhvac.com',              'Calgary, AB',                         'https://www.casselhvac.ca/'),
  ('hvac-003', 'NorthStar Heating And Cooling',       '403-973-0717', 'info@northstarheatingandcooling.ca',  '111 Citadel Acres Close NW, Calgary', 'https://northstarheatingandcooling.ca/'),
  ('hvac-004', 'Boland Mechanical Contractors Ltd',   '825-806-8922', 'boland@shaw.ca',                      '4516 19 Ave SW, Calgary, AB',         'http://www.bolandmechanical.ca/'),
  ('hvac-005', 'JNL Mechanical Ltd',                  '403-727-0331', 'info@jnlmechanical.ca',               '112-11979 40 St SE, Calgary, AB',     'https://jnlmechanical.ca/'),
  ('hvac-006', 'Qualimech Commercial Services',       '403-651-4344', 'tdmf@telusplanet.net',                'Calgary, AB',                         'http://qualimech.ca/'),
  ('hvac-007', 'Harmony Heating & Air Conditioning',  '403-207-5338', 'leads@harmonyheating.ca',             '427 51 Ave SE, Calgary, AB',          'https://www.harmonyheating.ca/'),
  ('hvac-008', 'Modern HVAC Solutions Inc',           '587-969-1950', 'modernhvac1@gmail.com',               '204 Covepark Rise NE, Calgary, AB',   'http://www.modernhvacsolutions.com/');
