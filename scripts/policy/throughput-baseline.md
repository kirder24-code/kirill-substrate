# Throughput Baseline (May 11 2026)

Council-mandated measurement before any phase 4 work. Three numbers + gate.
Source: `.data/linkedin-brand-os.sqlite` → `outreach_emails`,
`status IN ('sent','bounced','replied')`, `sent_at IS NOT NULL`.

## 1. Real sent_at per week — last 12 weeks

| ISO Week | Window           | Sent |
|----------|------------------|------|
| 2026-W17 | Apr 21 – Apr 27  | 19   |
| 2026-W16 | Apr 14 – Apr 20  | 45   |
| 2026-W15 | Apr 07 – Apr 13  | 144  |
| 2026-W14 | Apr 01 – Apr 06  | 2    |
| 2026-W13 | Mar 24 – Mar 30  | 12   |
| 2026-W12 | Mar 17 – Mar 23  | 2    |

Last-4-weeks mean (W14–W17): **52.5/wk**, but distorted by a single 144-batch in W15.
Trend after W15: 45 → 19 → 0 (this week).

Rolling windows:
- Last 7 days: **0 sent**
- Last 14 days: **19**
- Last 28 days: **208**

## 2. Manual achievable per week

Not yet measured. Open question to Kirill: at full focus, how many cold-outreach
touches per week is he willing to send by hand? Estimate placeholder: 20/wk.

## 3. Max N in 90 days

Depends on which rate is restored:
- If pipeline stays dead (recent 7d=0): **0**
- If recent W17 rate (19/wk) resumes: ~250 total
- If W15 batch rate (144/wk) resumes and sustains: ~1870 total (unprecedented)
- Realistic best-case post-revival: ~30/wk × 13 = **~400 total**

Baseline reply-rate from the same period: **7/207 = 3.4%**.

For an A/B comparison detecting a 3pp uplift on a 3.4% baseline at alpha=0.05,
power=0.8, required N per arm ≈ 1300+. Even 400 total ≈ 200/arm — well below.

## Gate (council rule)

> If N < 100/arm in 90 days → phase 4 is **executor-claim audit**, not learning loop.

Best realistic estimate: 200/arm.
Worst realistic estimate: 0–50/arm.
Either way, statistical detection of policy uplift on a 3.4% reply base is
**out of reach in 90 days**.

**Verdict: phase 4 cannot honestly be framed as a learning loop right now.**
Scope must collapse to executor-claim audit:
divergence classes the verifier checks against outbound activity, not
A/B variant uplift.

## Independent urgent finding (not in council scope)

The send pipeline produced **zero emails in the last 7 days**. W17 was 19,
W16 was 45 — declining since the W15 batch. Before any audit/learning work,
the immediate question is why outreach stopped. This is a SELL track issue,
not a BUILD track issue, and it directly blocks any throughput-dependent
strategy.

## Open decisions for Kirill

1. Confirm scope: phase 4 → executor-claim audit (not learning loop).
2. Confirm divergence classes to audit:
   - claimed_sent_not_found
   - duplicate_send
   - wrong_recipient_or_thread
   - missing_message_id
   - verifier_parse_failure
3. Manual outreach revival: is there a plan to restart sends this week, or is
   the pipeline intentionally paused?
4. Revenue track: given infrastructure work cannot generate clients at current
   throughput, what is the parallel SELL track this week?
