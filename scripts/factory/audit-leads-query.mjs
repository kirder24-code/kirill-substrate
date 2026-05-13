import Database from 'better-sqlite3';

const db = new Database('.data/linkedin-brand-os.sqlite');

const total = db.prepare('SELECT COUNT(*) as n FROM leads').get();
console.log('TOTAL LEADS:', total.n);

const byStage = db.prepare('SELECT stage, COUNT(*) as cnt FROM leads GROUP BY stage ORDER BY cnt DESC').all();
console.log('\nBY STAGE:');
byStage.forEach(r => console.log(` ${r.stage}: ${r.cnt}`));

const byPlatform = db.prepare('SELECT source_platform, COUNT(*) as cnt FROM leads GROUP BY source_platform ORDER BY cnt DESC LIMIT 25').all();
console.log('\nBY PLATFORM:');
byPlatform.forEach(r => console.log(` ${r.source_platform}: ${r.cnt}`));

const bySource = db.prepare('SELECT source, COUNT(*) as cnt FROM leads GROUP BY source ORDER BY cnt DESC LIMIT 20').all();
console.log('\nBY SOURCE SCRIPT:');
bySource.forEach(r => console.log(` ${r.source}: ${r.cnt}`));

const byLocation = db.prepare("SELECT location, COUNT(*) as cnt FROM leads WHERE location IS NOT NULL AND location != '' GROUP BY location ORDER BY cnt DESC LIMIT 20").all();
console.log('\nBY LOCATION:');
byLocation.forEach(r => console.log(` ${r.location}: ${r.cnt}`));

const byIndustry = db.prepare("SELECT industry, COUNT(*) as cnt FROM leads WHERE industry IS NOT NULL AND industry != '' GROUP BY industry ORDER BY cnt DESC LIMIT 20").all();
console.log('\nBY INDUSTRY:');
byIndustry.forEach(r => console.log(` ${r.industry}: ${r.cnt}`));

const scoreBands = db.prepare(`
  SELECT
    CASE
      WHEN score >= 70 THEN 'high_70plus'
      WHEN score >= 40 THEN 'mid_40_69'
      WHEN score >= 15 THEN 'low_15_39'
      ELSE 'junk_under15'
    END as band,
    COUNT(*) as cnt
  FROM leads GROUP BY band ORDER BY cnt DESC
`).all();
console.log('\nSCORE BANDS:');
scoreBands.forEach(r => console.log(` ${r.band}: ${r.cnt}`));

const enrichedCount = db.prepare('SELECT COUNT(*) as n FROM lead_enrichment').get();
const uniqueEnriched = db.prepare('SELECT COUNT(DISTINCT lead_id) as n FROM lead_enrichment').get();
console.log('\nENRICHMENT:');
console.log(` total enrichment rows: ${enrichedCount.n}`);
console.log(` unique enriched leads: ${uniqueEnriched.n}`);

const classifications = db.prepare('SELECT classification, COUNT(*) as cnt FROM lead_enrichment GROUP BY classification ORDER BY cnt DESC').all();
console.log('\nLEAD CLASSIFICATIONS:');
classifications.forEach(r => console.log(` ${r.classification}: ${r.cnt}`));

const interactions = db.prepare('SELECT COUNT(*) as n FROM lead_interactions').get();
console.log('\nINTERACTIONS (outreach sent):', interactions.n);

// Reddit SaaS/founder segment deep dive
const redditFounders = db.prepare(`
  SELECT COUNT(*) as cnt FROM leads
  WHERE source_platform IN (
    'reddit_r_sideproject','reddit_r_microsaas','reddit_r_SaaS',
    'reddit_r_vibecoding','reddit_r_buildinpublic','hn_show_hn',
    'reddit_r_nocode','reddit_r_cursor','reddit_r_lovable'
  )
`).get();
console.log('\nREDDIT FOUNDER/SAAS SEGMENT:', redditFounders.cnt);

// Calgary/Alberta local segment
const calgaryLocal = db.prepare(`
  SELECT COUNT(*) as cnt FROM leads
  WHERE source_platform IN (
    'reddit_r_Calgary','reddit_r_Edmonton','reddit_r_alberta','reddit_r_yyc'
  )
  OR source = 'calgary-local-pain-scout'
  OR source = 'linkedin_hunter'
`).get();
console.log('CALGARY/ALBERTA LOCAL SEGMENT:', calgaryLocal.cnt);

// IH + HN segment
const ihHn = db.prepare(`
  SELECT COUNT(*) as cnt FROM leads
  WHERE source IN ('ih-products','hn-whoshiring','hn-show-hn-scout')
`).get();
console.log('IH + HN SEGMENT (mass scrape):', ihHn.cnt);

// Twitter Apify
const twitter = db.prepare("SELECT COUNT(*) as cnt FROM leads WHERE source = 'apify-twitter-icp'").get();
console.log('TWITTER APIFY SEGMENT:', twitter.cnt);

// Sample high-score leads
const topLeads = db.prepare(`
  SELECT name, company, role, location, industry, score, source, source_platform, stage
  FROM leads WHERE score >= 50 ORDER BY score DESC LIMIT 20
`).all();
console.log('\nTOP SCORED LEADS (score >= 50):');
topLeads.forEach(r => console.log(` [${r.score}] ${r.name || 'anon'} | ${r.company || 'n/a'} | ${r.role || 'n/a'} | ${r.location || 'n/a'} | ${r.source_platform} | ${r.stage}`));

db.close();
