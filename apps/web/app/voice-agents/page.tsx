"use client";

import { useState } from "react";

const DEFAULT_COMPANY = "[CompanyName]";
const DEFAULT_DEMO = "(856) 556-8035";
const DEFAULT_CALENDAR = "https://cal.com/kirill-d";

const SUBJECT_TEMPLATES = [
  (c: string) => `${c} - what happens to missed calls after hours?`,
  (c: string) => `Quick question for ${c}`,
  (c: string) => `${c} - calls that go unanswered`,
  (c: string) => `After-hours coverage at ${c}`,
  (c: string) => `${c} - one question about lost jobs`,
];

function buildBodyEN(company: string, demo: string): string {
  return `Hi,

Quick question: when a customer calls ${company} after hours and nobody picks up, what happens to that call?

Most service businesses lose 3-5 jobs a week this way. The customer hangs up and calls whoever answers first. The work was there - the timing wasn't.

I build AI voice agents for trades and service companies in Calgary. Here is how it works: your after-hours line forwards to the agent, it answers live (not a recording), qualifies the caller, gives an estimated arrival window, and texts a confirmation. Your team handles it the next morning with full context.

Setup takes 3 days. Call forwarding only - no new hardware, nothing for your team to install or learn.

You can hear a live version right now by dialing ${demo}.

Are you open to a 15-minute call this week?

- Kirill D.
AI Voice Automation for Trades and Service Companies
https://launchsoloai.com
https://linkedin.com/in/kirill-derhachenko`;
}

function buildBodyRU(company: string, demo: string): string {
  return `Добрый день,

Короткий вопрос: когда клиент звонит в ${company} в нерабочее время и никто не берет трубку - что происходит с этой заявкой?

Большинство сервисных компаний теряют 3-5 заявок в неделю именно так. Клиент вешает трубку и звонит тому, кто ответил первым. Работа была - момент упущен.

Я внедряю голосовых ИИ-агентов для сервисных компаний в Калгари. Как это работает: нерабочая линия переключается на агента, он отвечает вживую (не автоответчик), уточняет запрос клиента, называет примерное время приезда и отправляет SMS с подтверждением. Ваша команда получает полный контекст с утра.

Настройка занимает 3 дня. Только переадресация - никакого нового оборудования, ничего нового для персонала.

Можете прямо сейчас услышать как агент принимает живой звонок: позвоните на ${demo}.

Открыты для 15-минутного созвона на этой неделе?

- Кирилл
Автоматизация голосовых агентов для сервисных компаний
https://launchsoloai.com
https://linkedin.com/in/kirill-derhachenko`;
}

function buildSms(company: string, demo: string): string {
  return `${company} - missed calls costing you jobs? AI voice agent answers live, 3-day setup. Call ${demo} to hear it. Worth 15 min this week?`;
}

const CALGARY_QUERIES = [
  "Calgary dental clinic emergency phone",
  "Calgary plumber 24/7 contact",
  "site:.ca hvac Calgary book appointment",
  "Alberta law firm free consultation call",
  "Calgary electrician after hours",
  "Calgary roofer emergency repair contact",
  "site:.ca Calgary trades call now",
  "Alberta dental office emergency line",
];

const CALGARY_OFFER =
  "We install and manage a 24/7 missed-call catcher for Canadian service businesses in 48 hours.";

const CALGARY_PRIORITY_SIGNALS = [
  "After-hours / emergency language in copy (but no live answer)",
  "Contact page has only a form - no direct phone number",
  ".ca domain with Calgary/Alberta address",
  "Google Business profile shows 'Closes at 5pm' or similar",
  "No answering service or virtual receptionist mentioned",
  "Reviews mention 'hard to reach' or 'left a message'",
];

const FACEBOOK_QUERIES = [
  "site:facebook.com plumber recommendation no one answered",
  "site:facebook.com/groups HVAC emergency recommendation",
  "site:facebook.com dentist emergency call no answer",
  "site:facebook.com/groups plumber emergency Calgary",
  "site:facebook.com lawyer after hours no answer recommendation",
  "site:facebook.com/groups who to call HVAC Calgary",
  "site:facebook.com dentist open now emergency recommendation",
  "site:facebook.com/groups plumber recommendation urgent",
];

const FACEBOOK_OFFER =
  "People are actively looking for providers in your area after hours; we can make sure those calls get answered tonight.";

const FACEBOOK_SIGNALS = [
  "Post asks community 'who to call right now' for plumber, HVAC, dentist, or lawyer",
  "Business is mentioned but commenters say they couldn't get through",
  "Post has urgency language: emergency, right now, tonight, ASAP",
  "Business has no after-hours number visible on their Facebook page",
  "Comments show multiple people recommending the same business with 'but they close at 5'",
  "Recent reviews on the business page mention not being able to reach anyone after hours",
];

const NO_BOOKING_QUERIES = [
  "Calgary dental clinic phone appointment",
  "Calgary hair salon book by phone only",
  "Calgary medspa contact us call",
  "Calgary chiropractor call to schedule",
  "Calgary law firm free consultation call",
  "site:.ca Calgary dental \"call us\" -\"book online\" -\"request appointment\"",
  "site:.ca Calgary salon \"call to book\" -\"online booking\" -\"schedule online\"",
  "site:.ca Alberta chiropractor \"call\" -\"book\" -\"schedule online\"",
  "site:.ca Calgary medspa \"call\" -\"online booking\" -\"book now\"",
  "site:.ca Calgary \"law firm\" \"call\" -\"contact form\" -\"request a consultation\"",
];

const NO_BOOKING_SIGNALS = [
  "Phone number prominent in header or hero section but no booking widget or button",
  "Contact page shows phone + email only - no form, no calendar link, no Calendly/Acuity",
  "Google Business profile: booking link absent or disabled",
  "Advertises evenings, weekends, or extended hours - but only lists a phone to reach them",
  "Multiple locations listed with separate phone numbers, no unified booking system",
  "Site copy says 'call to schedule' or 'call for an appointment' without a backup form",
  "No live chat, no chatbot, no contact form on any page",
  "Yelp or Google shows reviews mentioning 'called and got no answer' or 'hard to reach'",
];

const NO_BOOKING_NICHES = [
  { label: "Dental", why: "Emergency toothache calls spike evenings and weekends; most clinics phone-only" },
  { label: "Hair salons", why: "Walk-in + phone model; after-hours bookings go to voicemail or lost entirely" },
  { label: "Medspa / aesthetics", why: "High-value appointments; clients browse at night but can't self-book" },
  { label: "Chiropractor", why: "Injury/pain calls happen outside 9-5; clinic phone goes unanswered" },
  { label: "Law firms", why: "Consultation requests come during stressful moments - nights and weekends" },
];

const NO_BOOKING_OFFER =
  "We add a 24/7 AI receptionist that captures appointment requests when your phone isn't answered - no new software for your staff, live in 3 days.";

const REVIEW_COMPLAINT_QUERIES = [
  "site:yelp.com dental \"no one answered\" OR \"couldn't get through\" OR \"left a voicemail\"",
  "site:yelp.com hvac \"hold time\" OR \"on hold\" OR \"no callback\" OR \"never called back\"",
  "site:yelp.com plumber \"no answer\" OR \"didn't answer\" OR \"went to voicemail\"",
  "site:yelp.com \"law firm\" OR \"lawyer\" \"hard to reach\" OR \"no one picks up\"",
  "site:yelp.com salon \"couldn't reach\" OR \"no answer\" OR \"left message\"",
  "\"dental\" \"called and no one answered\" review Calgary",
  "\"plumber\" \"no callback\" OR \"never returned my call\" review Alberta",
  "\"HVAC\" OR \"heating\" \"on hold\" OR \"couldn't get through\" review Calgary",
  "\"salon\" OR \"hair\" \"no answer\" OR \"couldn't book\" review Calgary",
  "\"law firm\" \"couldn't reach\" OR \"no return call\" review Calgary",
];

const REVIEW_COMPLAINT_SIGNALS = [
  "Review explicitly says \"called and no one answered\" or \"went to voicemail\"",
  "Review mentions \"on hold\" or \"long wait\" before anyone picked up",
  "Review says \"never got a callback\" or \"they didn't return my call\"",
  "Business shows 3-star or lower average with phone complaints in review text",
  "Multiple reviews in the same period mentioning contact difficulty",
  "Owner response absent or defensive about phone/callback issues",
  "Google Business profile has no call-back or messaging option listed",
];

const REVIEW_COMPLAINT_NICHES = [
  { label: "Dental", why: "Emergency toothache callers hit voicemail; one bad review drives 10 lost patients" },
  { label: "HVAC", why: "Heating failures spike nights/weekends; hold times during peak demand kill trust" },
  { label: "Plumbing", why: "Urgent jobs (burst pipes, floods) lost when phone goes unanswered at 9pm" },
  { label: "Law firms", why: "Clients in crisis can't wait; one missed call = a referral gone to the competition" },
  { label: "Salons", why: "Appointment calls during business hours go to staff who can't always step away" },
];

const REVIEW_COMPLAINT_OFFER =
  "I noticed callers mention phone issues publicly - we can stop that this week with 24/7 instant answer.";

const FOLLOW_UP_STEPS = [
  {
    label: "Step 1: Day 0 - Send initial email",
    when: "Tue-Thu, 8-10am Calgary time",
    action: "Send EN body below. Use subject option 1 or 2. Replace company name before sending.",
    onReply: "Interest: book 15-min call. Objection: offer one-pager instead.",
  },
  {
    label: "Step 2: Day 3 - Follow-up if no reply",
    when: "3 business days after initial send, no reply received",
    action: `Reply in same thread. Body: "Hi, following up on my note from a few days ago. If missed calls are not a problem, no worries - I will leave it there. But if you want to hear what the agent sounds like, dial the demo number. It answers live. Worth 15 minutes this week? - Kirill"`,
    onReply: "Reply with interest: book the call. Not interested: mark done, stop.",
  },
  {
    label: "Step 3: Day 7 - Final note if still no reply",
    when: "7 days after initial send, still no reply",
    action: `Final note in same thread. Body: "Last note from me. One thing I did not mention: the agent also handles appointment confirmations and status questions at 8pm without pulling your team in. Two slots open this week: [CALENDAR_LINK] - Kirill"`,
    onReply: "Reply received: book the call. No reply: mark dead, do not contact again.",
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      style={{
        padding: "2px 10px",
        fontSize: 12,
        cursor: "pointer",
        background: copied ? "#16a34a" : "#334155",
        color: "#fff",
        border: "none",
        borderRadius: 4,
        marginLeft: 8,
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function VoiceAgentsPage() {
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [demo, setDemo] = useState(DEFAULT_DEMO);
  const [calendar, setCalendar] = useState(DEFAULT_CALENDAR);
  const [lang, setLang] = useState<"en" | "ru">("en");

  const subjects = SUBJECT_TEMPLATES.map(fn => fn(company));
  const body = lang === "en" ? buildBodyEN(company, demo) : buildBodyRU(company, demo);
  const sms = buildSms(company, demo);

  const inputStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #334155",
    background: "#0f172a",
    color: "#e2e8f0",
    fontSize: 14,
    width: "100%",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: "#94a3b8",
    display: "block",
    marginBottom: 4,
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 700,
    color: "#7dd3fc",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    margin: "20px 0 10px",
  };

  const preStyle: React.CSSProperties = {
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: 8,
    padding: 14,
    fontSize: 13,
    color: "#e2e8f0",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    lineHeight: 1.6,
  };

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "32px 20px", fontFamily: "monospace", color: "#e2e8f0", background: "#0f172a", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Voice Agent Outbound Artifacts</h1>
      <p style={{ color: "#64748b", fontSize: 13, marginBottom: 24 }}>
        Manual sending kit - fill in company details, copy each section before sending.
      </p>

      {/* Inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
        <div>
          <label style={labelStyle}>Company Name</label>
          <input style={inputStyle} value={company} onChange={e => setCompany(e.target.value)} placeholder="NorthStar Heating" />
        </div>
        <div>
          <label style={labelStyle}>Demo Number</label>
          <input style={inputStyle} value={demo} onChange={e => setDemo(e.target.value)} placeholder="(856) 556-8035" />
        </div>
        <div>
          <label style={labelStyle}>Calendar Link</label>
          <input style={inputStyle} value={calendar} onChange={e => setCalendar(e.target.value)} placeholder="https://cal.com/kirill-d" />
        </div>
      </div>

      {/* (a) Subject lines */}
      <div style={sectionTitle}>(a) Email Subject Lines</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {subjects.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", background: "#1e293b", borderRadius: 6, padding: "8px 12px" }}>
            <span style={{ color: "#64748b", marginRight: 10, fontSize: 12 }}>{i + 1}.</span>
            <span style={{ flex: 1, fontSize: 13 }}>{s}</span>
            <CopyButton text={s} />
          </div>
        ))}
      </div>

      {/* (b) Email body */}
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>(b) Email Body</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setLang("en")}
            style={{ padding: "3px 12px", fontSize: 12, borderRadius: 4, border: "none", cursor: "pointer", background: lang === "en" ? "#0ea5e9" : "#1e293b", color: "#fff" }}
          >EN</button>
          <button
            onClick={() => setLang("ru")}
            style={{ padding: "3px 12px", fontSize: 12, borderRadius: 4, border: "none", cursor: "pointer", background: lang === "ru" ? "#0ea5e9" : "#1e293b", color: "#fff" }}
          >RU</button>
          <CopyButton text={body} />
        </div>
      </div>
      <pre style={preStyle}>{body}</pre>

      {/* (c) SMS / DM */}
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>(c) SMS / DM Variant</span>
        <CopyButton text={sms} />
      </div>
      <div style={{ ...preStyle, fontStyle: "normal" }}>
        {sms}
        <span style={{ color: "#475569", marginLeft: 8, fontSize: 11 }}>({sms.length} chars)</span>
      </div>

      {/* (d) Calgary/Canada Lead Source */}
      <div style={sectionTitle}>(d) Calgary/Canada Geo-Intent Lead Source</div>
      <div style={{ background: "#0c1a2e", border: "1px solid #1e3a5f", borderRadius: 8, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
          Use these queries in Google/Maps/Yelp to find local businesses showing missed-call risk signals:
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {CALGARY_QUERIES.map((q, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", background: "#1e293b", borderRadius: 6, padding: "7px 12px" }}>
              <span style={{ flex: 1, fontSize: 13, fontFamily: "monospace", color: "#7dd3fc" }}>{q}</span>
              <CopyButton text={q} />
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Priority signals - target businesses showing these:</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          {CALGARY_PRIORITY_SIGNALS.map((s, i) => (
            <li key={i} style={{ fontSize: 12, color: "#cbd5e1" }}>{s}</li>
          ))}
        </ul>
      </div>
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
        <span>Canada Offer Line</span>
        <CopyButton text={CALGARY_OFFER} />
      </div>
      <div style={{ ...preStyle, color: "#86efac" }}>{CALGARY_OFFER}</div>

      {/* (e) Facebook Emergency Lead Source */}
      <div style={sectionTitle}>(e) Facebook Emergency-Service Lead Source</div>
      <div style={{ background: "#0c1a2e", border: "1px solid #1e3a5f", borderRadius: 8, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
          Search public Facebook posts and groups for people asking who to call right now. Find the businesses being mentioned and check if they have after-hours coverage gaps:
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {FACEBOOK_QUERIES.map((q, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", background: "#1e293b", borderRadius: 6, padding: "7px 12px" }}>
              <span style={{ flex: 1, fontSize: 13, fontFamily: "monospace", color: "#7dd3fc" }}>{q}</span>
              <CopyButton text={q} />
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Target signals - businesses mentioned in these posts that show:</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          {FACEBOOK_SIGNALS.map((s, i) => (
            <li key={i} style={{ fontSize: 12, color: "#cbd5e1" }}>{s}</li>
          ))}
        </ul>
      </div>
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
        <span>Facebook Outreach Line</span>
        <CopyButton text={FACEBOOK_OFFER} />
      </div>
      <div style={{ ...preStyle, color: "#86efac", marginBottom: 24 }}>{FACEBOOK_OFFER}</div>

      {/* (f) Phone-Only / No Booking Form Lead Source */}
      <div style={sectionTitle}>(f) Phone-Only / No Booking Form Lead Source</div>
      <div style={{ background: "#0c1a2e", border: "1px solid #1e3a5f", borderRadius: 8, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
          Find appointment-heavy businesses whose sites show a phone number but have no online booking widget, request form, or calendar link. Use Google/Maps with these queries:
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {NO_BOOKING_QUERIES.map((q, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", background: "#1e293b", borderRadius: 6, padding: "7px 12px" }}>
              <span style={{ flex: 1, fontSize: 13, fontFamily: "monospace", color: "#7dd3fc" }}>{q}</span>
              <CopyButton text={q} />
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Priority signals - businesses showing any of these:</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
          {NO_BOOKING_SIGNALS.map((s, i) => (
            <li key={i} style={{ fontSize: 12, color: "#cbd5e1" }}>{s}</li>
          ))}
        </ul>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>Top niches - prioritize these verticals:</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {NO_BOOKING_NICHES.map((n, i) => (
            <div key={i} style={{ background: "#1e293b", borderRadius: 6, padding: "8px 12px" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#f0f9ff" }}>{n.label}: </span>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>{n.why}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
        <span>No-Booking Offer Line</span>
        <CopyButton text={NO_BOOKING_OFFER} />
      </div>
      <div style={{ ...preStyle, color: "#86efac", marginBottom: 24 }}>{NO_BOOKING_OFFER}</div>

      {/* (g) Review Complaint Lead Source */}
      <div style={sectionTitle}>(g) Review Complaint Lead Source</div>
      <div style={{ background: "#0c1a2e", border: "1px solid #1e3a5f", borderRadius: 8, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
          Search Yelp, Google reviews, and local review pages for businesses where customers publicly complain about unanswered phones, long hold times, or no callback. Target dental, HVAC, plumbing, law, and salons:
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {REVIEW_COMPLAINT_QUERIES.map((q, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", background: "#1e293b", borderRadius: 6, padding: "7px 12px" }}>
              <span style={{ flex: 1, fontSize: 13, fontFamily: "monospace", color: "#7dd3fc" }}>{q}</span>
              <CopyButton text={q} />
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Qualifying signals - target businesses showing any of these in reviews:</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
          {REVIEW_COMPLAINT_SIGNALS.map((s, i) => (
            <li key={i} style={{ fontSize: 12, color: "#cbd5e1" }}>{s}</li>
          ))}
        </ul>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>Priority niches:</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {REVIEW_COMPLAINT_NICHES.map((n, i) => (
            <div key={i} style={{ background: "#1e293b", borderRadius: 6, padding: "8px 12px" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#f0f9ff" }}>{n.label}: </span>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>{n.why}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
        <span>Review Complaint Outreach Line</span>
        <CopyButton text={REVIEW_COMPLAINT_OFFER} />
      </div>
      <div style={{ ...preStyle, color: "#86efac", marginBottom: 24 }}>{REVIEW_COMPLAINT_OFFER}</div>

      {/* (h) Follow-up plan */}
      <div style={sectionTitle}>(h) 3-Step Follow-Up Plan</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {FOLLOW_UP_STEPS.map((step, i) => (
          <div key={i} style={{ background: "#1e293b", borderRadius: 8, padding: 14 }}>
            <div style={{ fontWeight: 700, color: "#7dd3fc", marginBottom: 8, fontSize: 13 }}>{step.label}</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
              <span style={{ color: "#475569" }}>When: </span>{step.when}
            </div>
            <div style={{ fontSize: 12, color: "#cbd5e1", marginBottom: 4 }}>
              <span style={{ color: "#475569" }}>Action: </span>{step.action.replace("[CALENDAR_LINK]", calendar)}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              <span style={{ color: "#475569" }}>On reply: </span>{step.onReply}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
