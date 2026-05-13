# Channel Registry

**Frozen file. Substrate may NOT rewrite this. Manual edit by Kirill only.**

This is the complete map of channels substrate knows about: connection
status, geographic popularity, audience fit, operator capability per
channel. Every action that proposes outreach MUST consult this registry
to pick the right channel for the target market and ICP.

When substrate finds an opportunity, it must explicitly recommend WHICH
channel(s) to use, WHY for that market, and WHAT specific deliverables
operator needs (URLs, company names, group handles — never "go search
LinkedIn").

---

## Connected channels (substrate can read or draft, operator sends)

### Telegram
- **Connection**: user-account session saved (.data/telegram-session.txt + telegram MTProto npm)
- **Substrate capability**: read groups + DMs, draft contextual replies, queue for approval
- **Operator action**: manually copy approved draft, post from own client (anti-ban)
- **Geographic dominance**: Russia (still, despite restrictions), Iran, Belarus, Ukraine,
  ex-USSR republics, Middle East (UAE, Saudi, Qatar), parts of SE Asia (Indonesia,
  Thailand). Strong in crypto / AI / dev communities globally regardless of geo.
- **Audience fit**: technical founders, crypto, AI builders, ex-USSR business owners,
  Middle East SMB
- **B2B reach**: medium globally, very high in Russian-speaking + crypto/AI
- **Cost**: free
- **Substrate action**: telegram_listener
- **Best for opportunities targeting**: ex-USSR, MENA, AI/crypto builder audience

### Threads
- **Connection**: Kirill posts manually (~20 followers, building)
- **Substrate capability**: draft posts only
- **Operator action**: manually post
- **Geographic dominance**: USA, Brazil, India, Indonesia, Mexico — fastest-growing
  English-speaking text platform 2025-2026
- **Audience fit**: tech-curious general professional, less hardcore-tech than X
- **B2B reach**: low at current scale, growing
- **Cost**: free
- **Substrate action**: draft_writing with channel=threads
- **Best for opportunities targeting**: building-in-public narrative, English-speaking
  general professional audience

### Site (launchsoloai.com)
- **Connection**: substrate can fetch live, generate drafts to .data/site-drafts/
- **Substrate capability**: audit, generate landing pages, blog posts, FAQ, case studies
- **Operator action**: copy drafts to actual site repo, deploy
- **Geographic dominance**: anyone with browser = global. SEO traffic depends on
  target keyword competition per market.
- **Audience fit**: anyone searching for what operator offers
- **B2B reach**: depends entirely on SEO + content quality
- **Cost**: free (operator owns hosting)
- **Substrate action**: site_audit_live, site_content_generate
- **Best for opportunities targeting**: SEO-driven inbound, vertical-specific landing
  pages, authority content

### Reddit
- **Connection**: substrate can fetch public subreddits via reddit-counter.mjs
- **Substrate capability**: read posts, draft comments, identify pain signals
- **Operator action**: manually post (Reddit API for posting requires OAuth + karma)
- **Geographic dominance**: USA dominant (~50% traffic), then Canada, UK, Australia,
  Germany. English-only effectively.
- **Audience fit**: tech, indie hackers, SaaS founders, vertical SMB owners (per
  subreddit), crypto, AI builders
- **B2B reach**: high if comment-first protocol followed
- **Cost**: free, but requires karma and account age investment
- **Substrate action**: web_research with reddit URL, reddit_strategist persona for plans
- **Best for opportunities targeting**: USA/CA/UK/AU SMB, indie hackers, AI builders,
  vertical pain signals

### LinkedIn
- **Connection**: Kirill posts manually (~525 followers, predominantly Calgary/Canadian
  + some global tech)
- **Substrate capability**: draft posts, draft DMs, draft comments
- **Operator action**: manually post / DM (LinkedIn API for posting requires Premium +
  app approval)
- **Geographic dominance**: USA, Canada, Western Europe, India, Brazil, Australia.
  WEAK in: Russia (banned), China, Iran. Very strong B2B everywhere it works.
- **Audience fit**: B2B decision-makers (founders, CXO, mid-management), recruiters,
  enterprise buyers
- **B2B reach**: highest of any channel where it works
- **Cost**: free (Premium $40 USD/mo for some features, not required)
- **Substrate action**: draft_writing with channel=linkedin
- **Best for opportunities targeting**: anywhere LinkedIn works (see geo above)

### X / Twitter
- **Connection**: Kirill posts manually (small follower count, building)
- **Substrate capability**: draft posts, threads
- **Operator action**: manually post
- **Geographic dominance**: USA, UK, India, Japan, Brazil, Saudi. Declining EU
  professionals, growing AI/crypto/founder community globally.
- **Audience fit**: AI builders, crypto, indie hackers, US tech founders, journalists
- **B2B reach**: medium — works for thought leadership + specific niches
  (AI consulting, dev tools), weak for traditional SMB
- **Cost**: free (X Premium $8/mo for verification, not required)
- **Substrate action**: draft_writing with channel=x_twitter
- **Best for opportunities targeting**: AI builder community, US tech founders,
  cross-border content that travels

---

## Unavailable channels (Kirill chose not to use yet)

### Email outreach (cold)
- **Why unavailable**: requires $60 CAD/mo SMTP infrastructure, Kirill declined until
  substrate proves it understands what it does
- **Substrate must NOT propose email outreach** as a primary channel until status
  changes
- **Allowed**: substrate can draft email TEMPLATES Kirill could use later, save to
  .data/survival-drafts/ for reference

---

## Discoverable channels (substrate may propose when relevant)

These are channels substrate is aware of but operator has not connected.
Substrate may RECOMMEND these in implementation plans when they fit the
opportunity, with explicit cost + setup time + expected ROI.

### YouTube
- Geographic dominance: universal
- B2B reach: long-form authority builder, slow burn (3-12 months to traction)
- Cost: time only (1 video/week minimum), or $200/mo for production
- Best for: thought leadership in AI / consulting niche
- Setup: 4-8 weeks until first video published

### TikTok
- Geographic dominance: USA, SE Asia, LATAM, MENA. Banned/restricted: India.
- B2B reach: emerging for B2B SaaS / AI tools, otherwise B2C
- Cost: time only
- Best for: short-form authority, AI demo content
- Setup: 2-4 weeks until first video

### YouTube ads / Google ads (contextual)
- Geographic dominance: anywhere with internet
- B2B reach: high if landing page is conversion-ready
- Cost: $300-3000 CAD/mo budget (Kirill has run ~$10/day before per memory)
- Setup: 1-2 weeks for keyword research + landing page sync
- Substrate has past memory: project_google_ads_launch.md

### Substack / Beehiiv newsletter
- Geographic dominance: NA + EU professionals
- B2B reach: medium-high for niche-specific authority
- Cost: free at start
- Setup: 1 week for first issue

### Indie Hackers / ProductHunt / BetaList
- Geographic dominance: USA + global tech
- B2B reach: peers, fellow indie builders, early-stage startup funders
- Cost: free
- Setup: instant
- Best for: building-in-public narrative

### HackerNews
- Geographic dominance: USA tech
- B2B reach: dev/eng decision-makers, technical founders
- Cost: free
- Setup: requires established account
- Best for: technical thought leadership posts

### Quora
- Geographic dominance: USA, India
- B2B reach: medium-low, declining
- Cost: free
- Setup: instant
- Best for: SEO-adjacent answers in specific niches

### Medium publications
- Geographic dominance: USA, India, EU professionals
- B2B reach: medium
- Cost: free or $5/mo for paid program
- Setup: instant
- Best for: AI/tech thought leadership

### DEV.to / Hashnode
- Geographic dominance: global tech
- B2B reach: developer-buyer audience
- Cost: free
- Setup: instant
- Best for: technical content for AI consulting buyers

### WhatsApp Business
- Geographic dominance: LATAM (dominant), India, Africa, MENA, parts of EU
- B2B reach: very high in dominant markets, where business is done in WhatsApp
- Cost: free for basic, paid for API
- Setup: 1-2 weeks for compliant setup
- Best for: opportunities targeting LATAM / India / Africa SMB

### WeChat (China)
- Geographic dominance: dominant in China only
- B2B reach: only viable channel for China B2B
- Cost: free, but requires Chinese business entity for full features
- Setup: weeks-months including business registration
- Best for: ONLY if Kirill builds China entity

### Line (Japan)
- Geographic dominance: dominant in Japan, also Thailand, Taiwan
- B2B reach: works for SMB if local-language content
- Cost: free + paid tiers
- Setup: 1 week
- Best for: Japan-targeted opportunities (requires Japanese-language assets)

### KakaoTalk (Korea)
- Geographic dominance: dominant in South Korea
- Setup: requires Korean phone number for business account
- Best for: ONLY Korean-targeted opportunities

### Industry-specific Slack / Discord communities
- Geographic dominance: global English-speaking
- B2B reach: very high if right community joined
- Cost: free
- Setup: 1-30 days lurking before commenting
- Best for: any vertical with active community (AI builders, indie SaaS, design,
  e-commerce ops)
- Discovery: substrate should research and surface communities per opportunity

### LinkedIn Sales Navigator
- Geographic dominance: same as LinkedIn
- Substrate capability: enhanced search, lead recommendation
- Cost: $100 USD/mo
- Best for: structured prospecting at scale

### Conference / podcast guest spots
- Geographic dominance: global
- B2B reach: high authority transfer
- Cost: $0-5K depending on type
- Setup: 4-12 weeks lead time
- Best for: building case studies + reach

### Local meetups (Calgary, Western Canada)
- Geographic dominance: Calgary, Edmonton local
- B2B reach: very high for local SMB partnerships
- Cost: free attendance, $20-100 to host
- Best for: local Canadian SMB opportunities

### Cold call / direct phone
- Geographic dominance: anywhere (cultural fit varies)
- B2B reach: declining but still 5-10% reply rate to verified mobile in NA
- Cost: time only
- Best for: high-intent, fast-moving opportunities (grant deadline, etc.)

---

## Channel-by-market quick lookup

| Market | Top 3 channels for B2B SMB |
|---|---|
| Canada (primary) | LinkedIn, local meetups, Reddit (r/CanadaSmallBusiness, vertical subs) |
| USA | LinkedIn, Reddit, X/Twitter, YouTube ads |
| United Kingdom | LinkedIn, YouTube, X/Twitter |
| Australia | LinkedIn, partnerships (R&D advisors), local podcasts |
| EU (English) | LinkedIn, Substack, X/Twitter |
| Portugal | LinkedIn, local Slack communities, partnerships |
| Russia / ex-USSR | Telegram (dominant), VK (declining) |
| MENA (UAE, Saudi) | LinkedIn, Telegram, WhatsApp Business |
| India | LinkedIn, WhatsApp, Telegram |
| LATAM (Brazil, Mexico) | WhatsApp Business, LinkedIn, Telegram (smaller) |
| China | WeChat (only) |
| Japan | LinkedIn (limited), Line, local meetups |
| Korea | KakaoTalk, LinkedIn (limited) |
| Hong Kong | LinkedIn, Telegram, WhatsApp |
| Singapore | LinkedIn, Telegram |

---

## Hard rules for substrate when proposing channels

1. **Always recommend at least 2 different channels per opportunity** — diversification
   reduces single-channel risk.
2. **Match channel to MARKET** using the lookup table above. Do not propose LinkedIn
   for Russia. Do not propose Telegram for primary US targeting.
3. **Concrete deliverables required**: when proposing LinkedIn, must include specific
   company names + LinkedIn URLs OR a precise search query with filters that returns
   those companies. When proposing Telegram, specific group invite links or @handles
   OR exact search queries to find them. When proposing Reddit, specific subreddit
   names + search queries.
4. **Never propose email outreach** until Kirill explicitly enables it (cost gate).
5. **Always state cost + setup time** for any discoverable channel proposal.
6. **Geographic-first reasoning**: substrate must STATE the target geography of the
   opportunity before recommending channels.

---

## Authoritative source

This file is the channel registry. operator-identity.md provides voice rules
per market. Together they bound substrate's channel-selection logic.
