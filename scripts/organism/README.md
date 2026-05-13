# organism

A persistent belief graph that lives across Claude sessions.
Claude (the LLM) is the larynx; this graph is the body — it remembers, accumulates,
contradicts itself, updates from evidence.

The graph **is** the organism. Claude is rented compute that operates on it.

## Why this exists

LLMs read but don't change. Each conversation starts fresh. The system around them
runs processes that "complete" without any signal back about whether the world
actually moved. This module breaks that:

1. **Persistent belief storage** — sqlite, not JSON state files
2. **Update propagation** — every new input modifies existing beliefs, not just appends
3. **Two-source convergence** — text claims (from Claude/articles/messages) and
   real outcomes (from Stripe/IMAP/action logs) meet on the same belief nodes;
   agreement strengthens, disagreement flags
4. **Larynx pattern** — Claude is called as oracle, not as memory; the organism
   keeps state between calls

## Files

- `db.mjs` — SQLite schema + primitives (open, upsert, link, contradict, query)
- `bootstrap-market-scan.mjs` — first breath; calls Claude in 9 parallel waves
  to seed the graph with strategic priors (markets × dimensions, programs, operational)
- `inspect.mjs` — read-only window into the graph

## Schema

```
beliefs(id, claim, domain, weight, sources_count, contradictions_count, origin, ...)
belief_links(from_id, to_id, link_type, weight)
belief_evidence(belief_id, source_type, source_ref, signal, signal_strength, observed_at)
belief_log(ts, belief_id, op, before_json, after_json, reason, source_type, source_ref)
```

## Usage

```bash
# First-time bootstrap — generates ~150-300 strategic priors
node scripts/organism/bootstrap-market-scan.mjs

# View overview, top beliefs, verdict
node scripts/organism/inspect.mjs

# Just the strategic verdict
node scripts/organism/inspect.mjs --verdict

# Recent updates
node scripts/organism/inspect.mjs --changes

# Beliefs Claude is confident about based on a single source — verify against reality
node scripts/organism/inspect.mjs --risky

# Drill into a specific domain
node scripts/organism/inspect.mjs --domain=market.singapore.*
```

## Database location

`.data/organism.db` — same convention as the project's other sqlite stores
(brain.db, cortex.db, leads.db, etc.).

## What's NOT here yet (next waves)

- `ingest-outcome.mjs` — pull real outcomes from Stripe / IMAP / Telegram /
  existing action logs and update belief weights
- `ingest-text.mjs` — accept arbitrary text, extract claims, propose graph ops
- `digest.mjs` — emit a markdown summary for injection into the next Claude session
- `track-record.md` — log of Claude's claims and how they resolved
- Source weighting (sources lose trust when their claims are contradicted)
- Periodic abstraction passes (compress many edges into higher-level beliefs)

## Design notes

- **Weight update** is precision-weighted average — older beliefs with more
  sources are harder to move. New evidence has small effect early; large effect
  on rarely-touched beliefs. See `updatedWeight` in `db.mjs`.
- **Contradiction** decays weight by 15% and increments contradictions_count.
  This is intentionally aggressive: the graph should be unstable in the face
  of contradicting evidence rather than ride out the conflict.
- **Origin** field on each belief tracks how it entered (bootstrap, outcome,
  text-ingest, etc.) so we can later weight or audit by origin.
- **belief_log** is append-only and never trimmed — it's the organism's memory
  of how its beliefs evolved, including Claude's track record of being right
  or wrong.

## Safety

This module is fully additive. It creates one new directory (`scripts/organism/`)
and one new database file (`.data/organism.db`). It does not modify any
existing scripts or databases. To remove: `rm -rf scripts/organism .data/organism.db`.
