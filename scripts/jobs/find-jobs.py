#!/usr/bin/env python3
"""
find-jobs.py — Remote AI job aggregator for Kirill D.

Pulls jobs from Indeed (+ optional LinkedIn/Glassdoor/Google) via JobSpy,
scores each against Kirill's profile (skills, edges, relocation goals),
and emits a ranked CSV + readable Markdown digest.

Run:
  scripts/jobs/run.sh                # default: Indeed only, 5 titles x 4 locations
  scripts/jobs/run.sh --linkedin     # add LinkedIn (slower, may rate-limit)
  scripts/jobs/run.sh --top 30       # show top 30 in digest (default 20)
"""

from datetime import datetime
from pathlib import Path
import argparse
import sys

import pandas as pd
from jobspy import scrape_jobs

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / ".data" / "jobs"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ─── Kirill profile encoded as search config ──────────────────────────

JOB_TITLES = [
    "AI Engineer",
    "AI Architect",
    "LLM Engineer",
    "Applied AI Engineer",
    "AI Solutions Architect",
]

LOCATIONS = [
    "Remote",          # global remote
    "Portugal",        # relocation target
    "United Kingdom",  # EN-speaking EU-adjacent
    "United States",   # largest remote market
]

# Score multipliers (matching keyword in title or description)
BOOST_KEYWORDS = {
    # Core LLM / agentic
    "llm": 3, "gpt": 2, "claude": 2, "anthropic": 2, "openai": 2,
    "rag": 2, "retrieval-augmented": 2, "langchain": 2,
    "agent": 2, "agentic": 3, "multi-agent": 3,
    "tool calling": 4, "tool-calling": 4, "function calling": 3,
    "multi-vendor": 5, "multi vendor": 5, "vendor-agnostic": 3,
    # Compliance specialty (Kirill's edge from Apollo)
    "compliance": 3, "regulated": 2, "audit": 2,
    "fintech": 2, "nbfc": 6, "lending": 2, "banking": 1, "finance": 1,
    "rbi": 5, "dpdp": 5, "kyc": 2, "aml": 2,
    # Stack
    "n8n": 4, "automation": 1, "workflow": 1, "notion": 1,
    "react native": 3, "expo": 2,
    "typescript": 1, "python": 1,
    "playwright": 2, "ollama": 2,
    # Remote / relocation
    "remote": 4, "fully remote": 5, "work from anywhere": 6,
    "visa sponsorship": 4, "relocation": 3, "relocation package": 3,
    "portugal": 5, "lisbon": 4, "porto": 3,
    "nhr": 3, "d8 visa": 5,
    # Bilingual edge
    "russian": 2, "ukrainian": 2, "cis": 2,
    # Production / shipping experience
    "production": 1, "ship": 1, "rapid": 1,
    "prototype": 1, "mvp": 1,
}

PENALTY_KEYWORDS = {
    # Visa / citizenship blockers (Kirill is Canadian, no US clearance)
    "phd required": -15, "ph.d. required": -15, "phd preferred": -5,
    "security clearance": -25, "ts/sci": -25, "secret clearance": -25,
    "us citizens only": -25, "us citizen only": -25, "us citizenship required": -25,
    "must be a us citizen": -25, "must hold us citizenship": -25,
    "department of defense": -10, "federal contractor": -10,
    # On-site / wrong location
    "must be located in": -5, "on-site only": -10, "on site only": -10,
    "5 days a week in office": -10, "must work in office": -10,
    "hybrid required": -5, "no remote": -10,
    # Wrong seniority
    "intern": -25, "internship": -25,
    "junior ": -10, "entry level": -10, "entry-level": -10,
    "10+ years": -3, "15+ years": -5, "20+ years": -8,
    # Wrong domain (Kirill is not CV/robotics)
    "computer vision": -3, "robotics": -3,
    "self-driving": -5, "autonomous vehicle": -5,
    "kubernetes engineer": -3, "devops only": -3,
    # Body shops (low pay, visa-locked, US-only typically)
    "tata consultancy": -15, "cognizant": -15, "infosys": -15,
    "wipro": -15, "hcl technologies": -10, "ltimindtree": -10,
    "capgemini": -5, "mphasis": -10, "accenture": -3,
}

# Apollo-overlap combos: both substrings present in title+desc = extra bonus
APOLLO_COMBOS = [
    ("compliance", "ai", 6), ("compliance", "llm", 6),
    ("fintech", "ai", 5), ("fintech", "llm", 5),
    ("banking", "ai", 5), ("banking", "llm", 5),
    ("insurance", "ai", 5),
    ("lending", "ai", 6),
    ("nbfc", "ai", 10),
    ("regulated", "ai", 5),
    ("audit", "ai", 4),
    ("aml", "ai", 6), ("aml", "llm", 6),
    ("kyc", "ai", 5),
    ("multi-vendor", "ai", 8), ("multi-vendor", "llm", 8),
]

# Title-level penalties (role too senior/junior)
TITLE_LEVEL_PENALTIES = {
    "vp ": -15, "vice president": -15,
    "director ": -10, "director,": -10, "director of": -10,
    "head of": -10, "chief ": -15,
    "principal ": -3,
    "intern": -25, "internship": -25,
    "junior ": -10, "entry": -8,
    "associate ": -3,
}

def location_modifier(location, description):
    """Adjust score based on location fit for a Canadian wanting to relocate."""
    loc = (location or "").lower()
    desc = (description or "").lower()
    mod = 0

    # Strong: Portugal (his target)
    if any(w in loc for w in ["portugal", "lisbon", "lisboa", "porto", "remoto, p"]):
        mod += 10
    # Good: EU
    elif any(w in loc for w in ["netherlands", "germany", "spain", "ireland",
                                  "berlin", "amsterdam", "madrid", "dublin", "barcelona"]):
        mod += 5
    # OK: UK
    elif any(w in loc for w in ["united kingdom", " uk,", "england", "london"]):
        mod += 3

    # Worldwide remote (Canadian can take)
    if any(w in desc for w in ["work from anywhere", "globally remote", "worldwide remote",
                                "anywhere in the world", "remote globally"]):
        mod += 8

    # Visa sponsorship explicit
    if any(w in desc for w in ["visa sponsorship", "relocation package",
                                "we sponsor visas", "d8 visa", "skilled worker visa"]):
        mod += 6

    # US-only remote = often blocker for Canadians
    if "remote, us" in loc and "canada" not in desc and "international" not in desc:
        mod -= 2

    return mod

SALARY_BOOST_FLOOR_USD = 80000

# Title must contain at least one of these for the job to be eligible.
# Filters out Sales / Ops / Electrical / etc. that incidentally mention "Claude" or "agent".
TITLE_MUST_CONTAIN = [
    "ai", "ml", "llm", "gpt", "machine learning",
    "artificial intelligence", "data scien", "applied scien",
    "ml ops", "mlops", "prompt", "agent", "automation",
    "ai/ml", "genai", "gen ai", "gen-ai", "generative",
    "ai engineer", "ai architect", "ai solutions", "ai consultant",
    "ai developer", "ai workflow", "rag",
]

# Country mapping for Indeed regional endpoints (JobSpy)
COUNTRY_INDEED = {
    "Portugal": "portugal", "Lisbon": "portugal", "Porto": "portugal",
    "United Kingdom": "uk", "London": "uk", "UK": "uk",
    "Germany": "germany", "Berlin": "germany",
    "Netherlands": "netherlands", "Amsterdam": "netherlands",
    "Spain": "spain", "Madrid": "spain", "Barcelona": "spain",
    "Ireland": "ireland", "Dublin": "ireland",
    "Canada": "canada",
    "United States": "usa", "USA": "usa", "US": "usa",
    "Remote": "usa",  # default broad endpoint
}

def title_eligible(title):
    t = (title or "").lower()
    return any(kw in t for kw in TITLE_MUST_CONTAIN)

# ─── Scoring ──────────────────────────────────────────────────────────

def score_job(row):
    title = str(row.get("title", "") or "").lower()
    desc = str(row.get("description", "") or "").lower()
    company = str(row.get("company", "") or "").lower()
    location = str(row.get("location", "") or "").lower()
    text = title + " " + desc

    score = 0
    matched = []

    # Standard keyword scoring
    for kw, pts in BOOST_KEYWORDS.items():
        if kw in text:
            score += pts
            matched.append(kw)
    for kw, pts in PENALTY_KEYWORDS.items():
        if kw in text or kw in company:
            score += pts
            matched.append(f"-{kw}")

    # Title-level penalties (VP/Director/Head/Chief/Junior)
    for kw, pts in TITLE_LEVEL_PENALTIES.items():
        if kw in title:
            score += pts
            matched.append(f"-LVL:{kw.strip()}")

    # Apollo-overlap combos (BOTH substrings → big bonus)
    for kw1, kw2, bonus in APOLLO_COMBOS:
        if kw1 in text and (not kw2 or kw2 in text):
            score += bonus
            matched.append(f"APOLLO:{kw1}+{kw2}" if kw2 else f"APOLLO:{kw1}")

    # Location / relocation fit
    loc_mod = location_modifier(location, desc)
    if loc_mod != 0:
        score += loc_mod
        matched.append(f"LOC:{loc_mod:+d}")

    # Salary boost
    min_amt = row.get("min_amount")
    try:
        if min_amt and float(min_amt) >= SALARY_BOOST_FLOOR_USD:
            score += 2
            matched.append(f"sal>={int(float(min_amt))}")
    except (ValueError, TypeError):
        pass

    return score, "|".join(matched[:10])

# ─── Search execution ─────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--linkedin", action="store_true", help="Also scrape LinkedIn (slower)")
    ap.add_argument("--google", action="store_true", help="Also scrape Google Jobs")
    ap.add_argument("--glassdoor", action="store_true", help="Also scrape Glassdoor")
    ap.add_argument("--titles", nargs="*", default=None, help="Override job titles")
    ap.add_argument("--locations", nargs="*", default=None, help="Override locations")
    ap.add_argument("--per-search", type=int, default=25, help="Results per search (default 25)")
    ap.add_argument("--hours-old", type=int, default=168, help="Max age of postings in hours (default 168 = 7d)")
    ap.add_argument("--top", type=int, default=20, help="Top N in markdown digest (default 20)")
    args = ap.parse_args()

    sites = ["indeed"]
    if args.linkedin: sites.append("linkedin")
    if args.google:   sites.append("google")
    if args.glassdoor: sites.append("glassdoor")

    titles = args.titles or JOB_TITLES
    locations = args.locations or LOCATIONS

    print(f"[{datetime.now().isoformat()}] Job aggregation for Kirill D.")
    print(f"Sites: {sites}")
    print(f"Titles: {len(titles)}, Locations: {len(locations)} = {len(titles)*len(locations)} searches")

    all_results = []
    for title in titles:
        for loc in locations:
            try:
                print(f"  '{title}' @ '{loc}'", end=" ", flush=True)
                jobs = scrape_jobs(
                    site_name=sites,
                    search_term=title,
                    location=loc,
                    results_wanted=args.per_search,
                    hours_old=args.hours_old,
                    country_indeed=COUNTRY_INDEED.get(loc, "usa"),
                )
                n = 0 if jobs is None else len(jobs)
                print(f"-> {n}")
                if n > 0:
                    jobs["search_term"] = title
                    jobs["search_location"] = loc
                    all_results.append(jobs)
            except Exception as e:
                print(f"!! {type(e).__name__}: {str(e)[:100]}")

    if not all_results:
        print("No results. Check network/JobSpy install.", file=sys.stderr)
        sys.exit(1)

    df = pd.concat(all_results, ignore_index=True)
    print(f"\nRaw: {len(df)}")

    # Dedup on job_url
    if "job_url" in df.columns:
        df = df.drop_duplicates(subset=["job_url"], keep="first")
    print(f"After dedup: {len(df)}")

    # Title eligibility filter (drops Sales/Ops/Electrical/etc.)
    before = len(df)
    df = df[df["title"].apply(title_eligible)].copy()
    print(f"After title filter: {len(df)} (-{before - len(df)})")

    # Hard date filter — drop anything older than args.hours_old (Indeed sometimes lies)
    if "date_posted" in df.columns:
        before = len(df)
        cutoff = pd.Timestamp.now() - pd.Timedelta(hours=args.hours_old)
        df["date_posted_dt"] = pd.to_datetime(df["date_posted"], errors="coerce")
        df = df[df["date_posted_dt"].isna() | (df["date_posted_dt"] >= cutoff)].copy()
        print(f"After date filter (<={args.hours_old}h): {len(df)} (-{before - len(df)})")

    # Score
    scored = df.apply(score_job, axis=1, result_type="expand")
    df["score"] = scored[0]
    df["matched"] = scored[1]
    df = df.sort_values("score", ascending=False)

    # Save CSV
    date_str = datetime.now().strftime("%Y-%m-%d-%H%M")
    csv_path = OUT_DIR / f"results-{date_str}.csv"
    df.to_csv(csv_path, index=False)
    print(f"\nCSV: {csv_path.relative_to(ROOT)}")

    # Top-N Markdown digest
    md_path = OUT_DIR / f"top-{date_str}.md"
    top = df.head(args.top)
    lines = [
        f"# Top {args.top} Remote AI Jobs for Kirill — {date_str}",
        f"",
        f"From {len(df)} unique postings (past {args.hours_old}h). Sources: {', '.join(sites)}",
        f"",
        f"| # | Score | Title | Company | Location | Source | Salary | Matched |",
        f"|---|---|---|---|---|---|---|---|",
    ]
    for i, (_, row) in enumerate(top.iterrows(), 1):
        title = str(row.get("title", ""))[:50].replace("|", "/")
        company = str(row.get("company", ""))[:25].replace("|", "/")
        loc = str(row.get("location", ""))[:30].replace("|", "/")
        site = str(row.get("site", ""))
        matched = str(row.get("matched", ""))[:50]
        score = row.get("score", 0)
        url = row.get("job_url", "")
        min_amt = row.get("min_amount")
        max_amt = row.get("max_amount")
        sal = ""
        if pd.notna(min_amt) and pd.notna(max_amt):
            sal = f"{int(min_amt)}-{int(max_amt)}"
        elif pd.notna(min_amt):
            sal = f">{int(min_amt)}"
        lines.append(
            f"| {i} | {score} | [{title}]({url}) | {company} | {loc} | {site} | {sal} | {matched} |"
        )

    lines.append("")
    lines.append(f"Full CSV: `{csv_path.relative_to(ROOT)}`")
    md_path.write_text("\n".join(lines))
    print(f"Digest: {md_path.relative_to(ROOT)}")

    if len(df) > 0:
        print(f"\nTop score: {int(df['score'].max())}, median: {df['score'].median()}, n>=10: {(df['score']>=10).sum()}")

if __name__ == "__main__":
    main()
