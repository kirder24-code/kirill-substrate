import Database from 'better-sqlite3';

const db = new Database('.data/linkedin-brand-os.sqlite');

// Reddit founder segment quality breakdown
const redditFounderScores = db.prepare(`
  SELECT
    CASE
      WHEN score >= 70 THEN 'high_70plus'
      WHEN score >= 40 THEN 'mid_40_69'
      WHEN score >= 15 THEN 'low_15_39'
      ELSE 'junk_under15'
    END as band,
    COUNT(*) as cnt
  FROM leads
  WHERE source_platform IN (
    'reddit_r_sideproject','reddit_r_microsaas','reddit_r_SaaS',
    'reddit_r_vibecoding','reddit_r_buildinpublic','hn_show_hn',
    'reddit_r_nocode','reddit_r_cursor','reddit_r_lovable',
    'reddit_r_ClaudeAI','r/n8n'
  )
  GROUP BY band ORDER BY cnt DESC
`).all();
console.log('REDDIT FOUNDER SCORES:', JSON.stringify(redditFounderScores));

// HN whoshiring sample
const hnSample = db.prepare("SELECT name, company, role, location, score, pain_description FROM leads WHERE source = 'hn-whoshiring' LIMIT 5").all();
console.log('HN WHOSHIRING SAMPLE:', JSON.stringify(hnSample));

// IH products sample
const ihSample = db.prepare("SELECT name, company, role, location, score, pain_description FROM leads WHERE source = 'ih-products' LIMIT 5").all();
console.log('IH PRODUCTS SAMPLE:', JSON.stringify(ihSample));

// Ready buyer details
const readyBuyer = db.prepare("SELECT name, source_platform, score, stage, pain_description FROM leads WHERE id IN (SELECT lead_id FROM lead_enrichment WHERE classification = 'ready_buyer')").all();
console.log('READY BUYER:', JSON.stringify(readyBuyer));

// Warming leads sample
const warming = db.prepare("SELECT l.name, l.source_platform, l.score, l.stage, le.recommended_action FROM leads l JOIN lead_enrichment le ON l.id = le.lead_id WHERE le.classification = 'warming' LIMIT 10").all();
console.log('WARMING SAMPLE:', JSON.stringify(warming));

// Twitter Apify scores
const twitterScores = db.prepare(`
  SELECT
    CASE
      WHEN score >= 70 THEN 'high_70plus'
      WHEN score >= 40 THEN 'mid_40_69'
      ELSE 'low_junk'
    END as band,
    COUNT(*) as cnt
  FROM leads WHERE source = 'apify-twitter-icp'
  GROUP BY band ORDER BY cnt DESC
`).all();
console.log('TWITTER APIFY SCORES:', JSON.stringify(twitterScores));

// LinkedIn apify scores
const liApifyScores = db.prepare(`
  SELECT source, COUNT(*) as cnt,
    AVG(score) as avg_score,
    SUM(CASE WHEN score >= 40 THEN 1 ELSE 0 END) as cnt_40plus
  FROM leads
  WHERE source LIKE 'apify-linkedin%'
  GROUP BY source
`).all();
console.log('LINKEDIN APIFY BY SOURCE:', JSON.stringify(liApifyScores));

// Leads with LinkedIn URL (real people, not content)
const withLinkedinUrl = db.prepare("SELECT COUNT(*) as n FROM leads WHERE linkedin_url IS NOT NULL AND linkedin_url != ''").get();
console.log('WITH LINKEDIN URL:', withLinkedinUrl.n);

// Stage breakdown for reddit founder segment
const redditFounderStages = db.prepare(`
  SELECT stage, COUNT(*) as cnt FROM leads
  WHERE source_platform IN (
    'reddit_r_sideproject','reddit_r_microsaas','reddit_r_SaaS',
    'reddit_r_vibecoding','reddit_r_buildinpublic',
    'reddit_r_nocode','reddit_r_cursor','reddit_r_lovable',
    'reddit_r_ClaudeAI','r/n8n'
  )
  GROUP BY stage ORDER BY cnt DESC
`).all();
console.log('REDDIT FOUNDER STAGES:', JSON.stringify(redditFounderStages));

// Contacted leads - which platforms?
const contactedByPlatform = db.prepare("SELECT source_platform, COUNT(*) as cnt FROM leads WHERE stage = 'contacted' GROUP BY source_platform ORDER BY cnt DESC").all();
console.log('CONTACTED BY PLATFORM:', JSON.stringify(contactedByPlatform));

// Fresh pain scout - what subreddits?
const freshPainSubs = db.prepare("SELECT source_platform, COUNT(*) as cnt FROM leads WHERE source = 'fresh-pain-scout' GROUP BY source_platform ORDER BY cnt DESC LIMIT 15").all();
console.log('FRESH-PAIN-SCOUT BY SUB:', JSON.stringify(freshPainSubs));

// Pain descriptions non-null count
const withPain = db.prepare("SELECT COUNT(*) as n FROM leads WHERE pain_description IS NOT NULL AND pain_description != ''").get();
console.log('WITH PAIN DESCRIPTION:', withPain.n);

db.close();
