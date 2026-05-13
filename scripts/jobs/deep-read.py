#!/usr/bin/env python3
"""
deep-read.py — Pass each top job description through Claude CLI for real fit analysis.

Run after find-jobs.py. Reads latest CSV, takes top N by score, has Claude read each
full description against Kirill's profile and Apollo case, outputs a curated digest.

Usage:
  scripts/jobs/run.sh && scripts/jobs/deep-read.sh --top 8 --location-filter portugal
"""
import argparse
import glob
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
JOBS_DIR = ROOT / ".data" / "jobs"

KIRILL_PROFILE = """
- Name: Kirill D., Calgary AB Canada → wants to relocate to Portugal
- Origin: Ukraine, 4 years in Canada
- Education: BSc Radiophysics + Bioengineering (Kharkiv, 2009-2014)
- Background: 5.5 years Senior PM at Verkhovna Rada (Ukraine Parliament). Then small business owner (cosmetology equipment repair, signs/graphics).
- Recent: AI Strategy Consultant since June 2025. Built launchsoloai.com, Substrate (autonomous AI OS with 420 modules), gaide.vercel.app.
- Apollo Finvest 3-day take-home (May 2026): production React Native + multi-vendor AI (Gemini primary, Groq fallback via one env flag, raw fetch both vendors), 27 schema-validated tool definitions, dual-mode agent (customer + team), full RBI DLD 2025 + DPDP Act 2023 compliance baked in as 5-checkbox structural pre-flight gate, anonymous mode with on-device PII tokenization, FNV-1a + SHA-256 hash chain audit, production economics modeled to $0.05/customer/month at 100K DAU. Apollo team accepted and looped in tech lead.
- Tech: LLM orchestration, multi-vendor AI architecture, tool calling, RAG, agents, n8n, Notion, React Native + Expo, TypeScript/Python, Playwright, Ollama, compliance AI, vibecoding.
- English: not native (self-stated). Russian native. Ukrainian. Works fine for written technical communication.
- Income floor: $4000 USD/month minimum. Contractor $120/hr CAD floor.
- Goal: full-time AI engineer role at company that hires internationally / sponsors visa OR Portugal-located OR genuinely remote-worldwide. Wants to use Apollo case as primary credibility.
"""

PROMPT_TEMPLATE = """You are evaluating a job posting for Kirill D.'s fit.

KIRILL'S PROFILE:
{profile}

JOB POSTING:
Title: {title}
Company: {company}
Location: {location}
URL: {url}
Salary: {salary}

DESCRIPTION:
{description}

Read the description carefully. Then output ONLY a JSON object (no markdown fence, no preamble) with this exact shape:

{{
  "role_focus": "<1-sentence summary of what this person actually does day-to-day, e.g. 'LLM-powered customer support automation' or 'classical ML for facility sensor data'>",
  "tech_required_must_have": ["<top 3-5 must-have technical requirements>"],
  "years_experience_required": <integer or null>,
  "remote_status": "<one of: fully_remote_global, fully_remote_country_only, hybrid, on_site, unclear>",
  "visa_sponsorship": "<one of: explicit_yes, eu_citizen_required, unclear, explicit_no>",
  "apollo_fit_1_10": <integer 1-10, how directly Kirill's Apollo Finvest case applies>,
  "overall_fit_1_10": <integer 1-10>,
  "red_flags": ["<concrete blockers e.g. 'requires Portuguese language' or 'must be EU citizen' or 'requires 10+ years' — empty list if none>"],
  "kirill_strengths_that_match": ["<2-3 specific things in Kirill's profile that match this role>"],
  "cover_letter_hook": "<one specific sentence Kirill should open his cover letter with, citing Apollo or a concrete piece of his work that matches THIS role>",
  "verdict": "<one of: apply_now, apply_maybe, skip>"
}}

Be honest. If the role is wrong for him (computer vision, robotics, data engineering pipelines with no AI, sales engineering, etc.) say skip. If it requires Portuguese fluency say skip. If it requires EU citizenship without sponsorship say skip.
"""


def call_claude(prompt: str, timeout: int = 180) -> str:
    """Run claude CLI with stdin prompt, return stdout."""
    try:
        result = subprocess.run(
            ["claude", "-p", "--output-format", "text"],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        return ""
    except Exception as e:
        print(f"  claude error: {e}", file=sys.stderr)
        return ""


def parse_json_loose(s: str) -> dict | None:
    """Extract first JSON object from a string."""
    if not s:
        return None
    m = re.search(r"\{.*\}", s, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=8, help="How many top-scored jobs to deep-read")
    ap.add_argument("--location-filter", default="portugal",
                    help="Substring (case-insensitive) to filter location, e.g. 'portugal' or 'london' or '' for none")
    ap.add_argument("--csv", default=None, help="Path to CSV (default: latest in .data/jobs/)")
    args = ap.parse_args()

    csv_path = args.csv
    if not csv_path:
        candidates = sorted(JOBS_DIR.glob("results-*.csv"))
        if not candidates:
            print("No results CSV found. Run find-jobs.py first.", file=sys.stderr)
            sys.exit(1)
        csv_path = candidates[-1]
    csv_path = Path(csv_path)
    print(f"Reading: {csv_path.relative_to(ROOT)}")

    df = pd.read_csv(csv_path)
    print(f"Total jobs in CSV: {len(df)}")

    if args.location_filter:
        loc_filter = args.location_filter.lower()
        before = len(df)
        if loc_filter == "portugal":
            df = df[df["location"].astype(str).str.lower().str.contains(
                "portugal|lisbo|porto|remoto, p|, pt", na=False, regex=True
            )]
        else:
            df = df[df["location"].astype(str).str.lower().str.contains(loc_filter, na=False)]
        print(f"After location filter '{loc_filter}': {len(df)} (-{before-len(df)})")

    df = df.sort_values("score", ascending=False).head(args.top)
    print(f"\nDeep-reading top {len(df)} jobs via Claude CLI (~30s each)...\n")

    out_records = []
    for idx, (_, row) in enumerate(df.iterrows(), 1):
        title = str(row.get("title", ""))
        company = str(row.get("company", ""))
        location = str(row.get("location", ""))
        url = str(row.get("job_url", ""))
        description = str(row.get("description", ""))
        salary = ""
        try:
            mn, mx = row.get("min_amount"), row.get("max_amount")
            if pd.notna(mn) and pd.notna(mx):
                salary = f"${int(mn)}-${int(mx)}"
            elif pd.notna(mn):
                salary = f">=${int(mn)}"
        except Exception:
            pass

        print(f"[{idx}/{len(df)}] {title[:55]} @ {company[:25]} ...", end=" ", flush=True)

        prompt = PROMPT_TEMPLATE.format(
            profile=KIRILL_PROFILE.strip(),
            title=title,
            company=company,
            location=location,
            url=url,
            salary=salary or "not disclosed",
            description=description[:6000],  # cap to keep context reasonable
        )
        raw = call_claude(prompt)
        parsed = parse_json_loose(raw)
        if not parsed:
            print("PARSE FAIL")
            parsed = {"verdict": "parse_fail", "raw": raw[:300]}

        parsed["_meta"] = {
            "title": title, "company": company, "location": location,
            "url": url, "salary": salary, "keyword_score": int(row.get("score", 0)),
        }
        out_records.append(parsed)
        print(f"verdict={parsed.get('verdict','?')} | apollo={parsed.get('apollo_fit_1_10','?')} | overall={parsed.get('overall_fit_1_10','?')}")

    # Save JSON
    date_str = datetime.now().strftime("%Y-%m-%d-%H%M")
    json_path = JOBS_DIR / f"deep-{date_str}.json"
    json_path.write_text(json.dumps(out_records, indent=2, ensure_ascii=False))
    print(f"\nJSON: {json_path.relative_to(ROOT)}")

    # Markdown digest
    md_path = JOBS_DIR / f"deep-{date_str}.md"
    lines = [f"# Deep-Read: Top {len(out_records)} Portugal AI Jobs for Kirill — {date_str}\n"]
    lines.append("Verdicts produced by Claude reading the full job description against Kirill's profile.\n")

    # Sort by verdict then overall fit
    verdict_order = {"apply_now": 0, "apply_maybe": 1, "skip": 2, "parse_fail": 3}
    out_records.sort(key=lambda r: (verdict_order.get(r.get("verdict", "skip"), 3),
                                       -(r.get("overall_fit_1_10") or 0)))

    for i, r in enumerate(out_records, 1):
        m = r["_meta"]
        verdict = r.get("verdict", "?")
        emoji = {"apply_now": "✅", "apply_maybe": "🟡", "skip": "❌", "parse_fail": "⚠️"}.get(verdict, "?")
        lines.append(f"## {emoji} #{i} [{verdict.upper()}] {m['title']} @ {m['company']}\n")
        lines.append(f"- **Location:** {m['location']}")
        if m['salary']:
            lines.append(f"- **Salary:** {m['salary']}")
        lines.append(f"- **Apollo fit:** {r.get('apollo_fit_1_10','?')}/10  |  **Overall fit:** {r.get('overall_fit_1_10','?')}/10  |  Keyword score: {m['keyword_score']}")
        lines.append(f"- **Role focus:** {r.get('role_focus','—')}")
        if r.get('tech_required_must_have'):
            lines.append(f"- **Must-have tech:** {', '.join(r['tech_required_must_have'])}")
        if r.get('years_experience_required'):
            lines.append(f"- **Years exp required:** {r['years_experience_required']}")
        lines.append(f"- **Remote:** {r.get('remote_status','?')}  |  **Visa:** {r.get('visa_sponsorship','?')}")
        if r.get('kirill_strengths_that_match'):
            lines.append(f"- **Kirill match:** {', '.join(r['kirill_strengths_that_match'])}")
        if r.get('red_flags'):
            lines.append(f"- **Red flags:** {', '.join(r['red_flags'])}")
        if r.get('cover_letter_hook'):
            lines.append(f"- **Cover letter hook:** _{r['cover_letter_hook']}_")
        lines.append(f"- **Apply:** {m['url']}\n")

    md_path.write_text("\n".join(lines))
    print(f"Digest: {md_path.relative_to(ROOT)}")

    # Quick summary
    by_verdict = {}
    for r in out_records:
        by_verdict[r.get("verdict","?")] = by_verdict.get(r.get("verdict","?"), 0) + 1
    print(f"\nVerdicts: {by_verdict}")


if __name__ == "__main__":
    main()
