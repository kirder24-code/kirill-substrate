-- validate-leads-contactability.sql
-- Selects newest SMB leads (last 24-48h) that have at least one reachable contact field.
-- Target DB: .data/linkedin-brand-os.sqlite
-- Run: sqlite3 .data/linkedin-brand-os.sqlite < scripts/outreach/validate-leads-contactability.sql

-- ============================================================
-- PART A: Email-based leads from outreach_emails (24h window)
-- Contactability criteria:
--   1. Valid email format (has @ and .)
--   2. Not already sent, bounced, or blocked
--   3. Likely SMB: category in ICP list OR website present
-- ============================================================

SELECT
  'outreach_emails'                  AS source_table,
  id                                 AS lead_id,
  business_name                      AS company,
  business_email                     AS email,
  NULL                               AS phone,
  business_category                  AS category,
  business_website                   AS website,
  status,
  created_at,

  -- Contactability score (0-100)
  (
    -- has a valid-looking email (+30)
    CASE WHEN business_email LIKE '%@%.%' AND length(business_email) >= 6 THEN 30 ELSE 0 END
    -- personal/owner email - not a generic prefix (+20)
    + CASE WHEN business_email NOT LIKE 'info@%'
            AND business_email NOT LIKE 'contact@%'
            AND business_email NOT LIKE 'office@%'
            AND business_email NOT LIKE 'admin@%'
            AND business_email NOT LIKE 'hello@%'
            AND business_email NOT LIKE 'support@%'
            AND business_email NOT LIKE 'sales@%'
            AND business_email NOT LIKE 'team@%'
            AND business_email NOT LIKE 'general@%'
       THEN 20 ELSE 0 END
    -- ICP category match (+25)
    + CASE WHEN business_category IN (
            'hvac','plumbers','roofing','landscaping','cleaning-services',
            'auto-repair','moving-companies','electricians','garage-door',
            'dental-clinics','physiotherapy','optometrists','veterinarians',
            'property-management','chiropractors','painting','fencing'
           ) THEN 25 ELSE 0 END
    -- has website (+10)
    + CASE WHEN business_website IS NOT NULL AND length(trim(business_website)) > 5 THEN 10 ELSE 0 END
    -- has a pre-written draft (+10)
    + CASE WHEN subject IS NOT NULL AND body IS NOT NULL AND length(body) > 80 THEN 10 ELSE 0 END
    -- not a gmail/hotmail/yahoo address (more likely business owner direct) (+5)
    + CASE WHEN business_email NOT LIKE '%@gmail.%'
            AND business_email NOT LIKE '%@hotmail.%'
            AND business_email NOT LIKE '%@yahoo.%'
            AND business_email NOT LIKE '%@outlook.%'
       THEN 5 ELSE 0 END
  ) AS contact_score

FROM outreach_emails

WHERE
  -- Last 24-48h window (adjust interval as needed)
  created_at >= datetime('now', '-48 hours')

  -- Must have something that looks like an email
  AND business_email IS NOT NULL
  AND business_email LIKE '%@%.%'
  AND length(business_email) >= 6

  -- Not already sent, bounced, or blocked
  AND status NOT IN ('sent', 'bounced', 'blocked', 'replied', 'unsubscribed')

  -- Must have a company name
  AND business_name IS NOT NULL
  AND length(trim(business_name)) > 2

ORDER BY contact_score DESC, created_at DESC
LIMIT 50;

-- ============================================================
-- PART B: Phone-based leads from manual_hvac_outreach
-- Separate table for leads sourced manually with phone data.
-- Contactability: phone present, not already refused/meeting.
-- ============================================================

SELECT
  'manual_hvac_outreach'             AS source_table,
  id                                 AS lead_id,
  company,
  email,
  phone,
  'hvac'                             AS category,
  website,
  CASE
    WHEN meeting = 1 THEN 'meeting'
    WHEN refusal  = 1 THEN 'refused'
    WHEN delivered = 1 THEN 'delivered'
    ELSE 'pending'
  END                                AS status,
  created_at,

  -- Contactability score
  (
    -- has phone (+35)
    CASE WHEN phone IS NOT NULL AND length(trim(phone)) >= 10 THEN 35 ELSE 0 END
    -- has email too (+25)
    + CASE WHEN email IS NOT NULL AND email LIKE '%@%.%' THEN 25 ELSE 0 END
    -- not yet contacted (+20)
    + CASE WHEN delivered = 0 AND refusal = 0 THEN 20 ELSE 0 END
    -- has website (+10)
    + CASE WHEN website IS NOT NULL AND length(trim(website)) > 5 THEN 10 ELSE 0 END
    -- not closed (+10)
    + CASE WHEN meeting = 0 AND refusal = 0 THEN 10 ELSE 0 END
  ) AS contact_score

FROM manual_hvac_outreach

WHERE
  -- Exclude refused and closed
  refusal = 0
  AND meeting = 0

  -- Must have phone or email
  AND (
    (phone IS NOT NULL AND length(trim(phone)) >= 10)
    OR (email IS NOT NULL AND email LIKE '%@%.%')
  )

ORDER BY contact_score DESC, created_at DESC
LIMIT 20;

-- ============================================================
-- PART C: Combined contactable leads view (use for the script)
-- Run this to see merged, scored, deduplicated top candidates.
-- ============================================================

SELECT * FROM (

  SELECT
    'outreach_emails' AS source_table,
    id AS lead_id,
    business_name AS company,
    business_email AS email,
    NULL AS phone,
    business_category AS category,
    business_website AS website,
    status,
    created_at,
    (
      CASE WHEN business_email LIKE '%@%.%' AND length(business_email) >= 6 THEN 30 ELSE 0 END
      + CASE WHEN business_email NOT LIKE 'info@%' AND business_email NOT LIKE 'contact@%'
              AND business_email NOT LIKE 'office@%' AND business_email NOT LIKE 'admin@%'
              AND business_email NOT LIKE 'hello@%' AND business_email NOT LIKE 'support@%'
              AND business_email NOT LIKE 'sales@%' AND business_email NOT LIKE 'team@%'
         THEN 20 ELSE 0 END
      + CASE WHEN business_category IN (
              'hvac','plumbers','roofing','landscaping','cleaning-services',
              'auto-repair','moving-companies','electricians','garage-door',
              'dental-clinics','physiotherapy','optometrists','veterinarians',
              'property-management','chiropractors','painting','fencing'
             ) THEN 25 ELSE 0 END
      + CASE WHEN business_website IS NOT NULL AND length(trim(business_website)) > 5 THEN 10 ELSE 0 END
      + CASE WHEN subject IS NOT NULL AND body IS NOT NULL AND length(body) > 80 THEN 10 ELSE 0 END
      + CASE WHEN business_email NOT LIKE '%@gmail.%' AND business_email NOT LIKE '%@hotmail.%'
              AND business_email NOT LIKE '%@yahoo.%' AND business_email NOT LIKE '%@outlook.%'
         THEN 5 ELSE 0 END
    ) AS contact_score
  FROM outreach_emails
  WHERE created_at >= datetime('now', '-48 hours')
    AND business_email IS NOT NULL AND business_email LIKE '%@%.%'
    AND length(business_email) >= 6
    AND status NOT IN ('sent','bounced','blocked','replied','unsubscribed')
    AND business_name IS NOT NULL AND length(trim(business_name)) > 2

  UNION ALL

  SELECT
    'manual_hvac_outreach' AS source_table,
    id AS lead_id,
    company,
    email,
    phone,
    'hvac' AS category,
    website,
    CASE WHEN meeting=1 THEN 'meeting' WHEN refusal=1 THEN 'refused'
         WHEN delivered=1 THEN 'delivered' ELSE 'pending' END AS status,
    created_at,
    (
      CASE WHEN phone IS NOT NULL AND length(trim(phone)) >= 10 THEN 35 ELSE 0 END
      + CASE WHEN email IS NOT NULL AND email LIKE '%@%.%' THEN 25 ELSE 0 END
      + CASE WHEN delivered = 0 AND refusal = 0 THEN 20 ELSE 0 END
      + CASE WHEN website IS NOT NULL AND length(trim(website)) > 5 THEN 10 ELSE 0 END
      + CASE WHEN meeting = 0 AND refusal = 0 THEN 10 ELSE 0 END
    ) AS contact_score
  FROM manual_hvac_outreach
  WHERE refusal = 0 AND meeting = 0
    AND (
      (phone IS NOT NULL AND length(trim(phone)) >= 10)
      OR (email IS NOT NULL AND email LIKE '%@%.%')
    )

) combined

ORDER BY contact_score DESC, created_at DESC
LIMIT 20;
