# Architecture & Design Document

## System Overview

The Talent Scout Agent is an AI-powered recruitment automation system that:
1. Accepts job descriptions via webhook
2. Discovers candidate profiles from Google Drive + Google Sheets
3. Computes explainable technical fit (Match Score) using Gemini LLM
4. Simulates candidate outreach to gauge interest (Interest Score)
5. Ranks and returns Top-N candidates with detailed reasoning

**Tech Stack**: n8n (workflow orchestration) + Google Gemini (LLM) + Google Drive/Sheets (data layer)

**Deployment Model**: Local (desktop n8n) or Docker Compose for demo; n8n Cloud for production

---

## Data Architecture

### Data Sources

```
┌─────────────────────┐       ┌──────────────────┐
│   Google Drive      │       │  Google Sheets   │
│  /Resumes Folder    │       │  (Candidates)    │
│                     │       │                  │
│ - resume1.pdf       │       │ - Name           │
│ - resume2.pdf       │       │ - Email          │
│ - ...               │       │ - Phone          │
└─────────┬───────────┘       │ - Skills         │
          │                   │ - Experience     │
          └───────────────────┴──────────────────┘
                      │
                      ▼
            ┌──────────────────────┐
            │  Candidate Discovery │
            │      & Merge         │
            └──────────┬───────────┘
                       │
            ┌──────────▼───────────┐
            │  Normalized Schema   │
            │  (Unified view)      │
            └──────────────────────┘
```

### Canonical Data Model

All candidates are normalized into a unified schema:

```json
{
  "candidate_id": "cand-001",
  "name": "Alice Chen",
  "email": "alice@example.com",
  "phone": "+1-415-555-0101",
  "resume_text": "... full extracted text ...",
  "skills": ["Python", "PostgreSQL", "AWS"],
  "years_experience": 7,
  "current_title": "Senior Backend Engineer",
  "current_company": "TechCorp Inc",
  "location": "San Francisco, CA",
  "resume_drive_file_id": "abc123def456",
  "source": "drive",  // or "sheets"
  "created_at": "2025-04-20T10:00:00Z",
  "updated_at": "2025-04-25T15:30:00Z"
}
```

### Scoring Data Model

```json
{
  "candidate_id": "cand-001",
  "job_id": "job-2025-001",
  
  // Match Score (Technical Fit)
  "match_score": 94,
  "skills_score": 96,
  "experience_score": 95,
  "domain_score": 92,
  "seniority_score": 90,
  "matched_skills": ["Python", "PostgreSQL", "AWS"],
  "missing_skills": [],
  
  // Interest Score (Engagement)
  "interest_score": 88,
  "intent_enthusiasm": 89,
  "availability": 90,
  "compensation_fit": 85,
  "engagement_depth": 88,
  
  // Composite & Metadata
  "composite_score": 91.8,
  "confidence": 0.96,
  "status_label": "Strong Fit",
  "explainability": { /* ... */ },
  "risk_flags": [],
  "ranking": 1
}
```

---

## Workflow Architecture

### Phase 1: Request Ingestion & Validation

```
┌─────────────────────────────────────────┐
│  Webhook: POST /talent-scout/job-desc   │
│  Payload: job_id, title, JD text, etc   │
└────────────┬────────────────────────────┘
             │
    ┌────────▼────────┐
    │ Validate Schema │
    └────────┬────────┘
             │
    ┌────────▼──────────────────┐
    │ Check for Duplicate Job   │
    │ (Idempotency)             │
    └────────┬──────────────────┘
             │
        ┌────┴────┐
        │ Accepted│
        └────┬────┘
             │
    ┌────────▼────────────────┐
    │ Normalize Request Data  │
    │ Add request_id,         │
    │ timestamp, defaults     │
    └────────┬────────────────┘
             │
         [Queue for Processing]
```

### Phase 2: Candidate Discovery & Parsing

```
┌──────────────────────────────────┐
│   Parallel Operations:           │
│  1. List Drive resumes           │
│  2. Read Sheets candidates       │
└────────┬───────────────┬──────────┘
         │               │
    ┌────▼─┐        ┌────▼─────────┐
    │Drive │        │Sheets Rows   │
    │PDFs  │        │              │
    └────┬─┘        └────┬─────────┘
         │               │
         └───────┬───────┘
                 │
         ┌───────▼──────────┐
         │  Merge & Dedupe  │
         │  (by email/phone)│
         └───────┬──────────┘
                 │
    ┌────────────▼──────────────┐
    │ For Each Candidate:       │
    │ 1. Download Resume (PDF)  │
    │ 2. Extract Text (n8n)     │
    │ 3. Parse Skills (Gemini)  │
    └────────────┬──────────────┘
                 │
         [Continue to Matching]
```

### Phase 3: Match Score Computation

```
┌──────────────────────────────────────┐
│  Input:                              │
│  - Candidate (skills, exp, domain)   │
│  - Job Description (parsed JD)       │
│  - Requirements (must-haves, etc)    │
└────────────┬─────────────────────────┘
             │
    ┌────────▼────────────────────┐
    │ Gemini: Compute Match Score │
    │                             │
    │ Evaluate 4 dimensions:      │
    │ 1. Skills (40% weight)      │
    │ 2. Experience (25% weight)  │
    │ 3. Domain (20% weight)      │
    │ 4. Seniority (15% weight)   │
    │                             │
    │ Output:                     │
    │ - match_score (0-100)       │
    │ - per-component scores      │
    │ - matched_skills[]          │
    │ - missing_skills[]          │
    │ - reasoning                 │
    └────────────┬────────────────┘
                 │
    ┌────────────▼──────────────────┐
    │ Apply Match Threshold        │
    │ (default: >= 50 passes)      │
    └────────────┬──────────────────┘
                 │
    ┌────────────▼────────────────┐
    │ Batch into Results          │
    │ [Proceed to Outreach or     │
    │  Baseline Interest if       │
    │  outreach_disabled]         │
    └────────────────────────────┘
```

### Phase 4: Interest Score (Outreach Simulation)

```
┌─────────────────────────────────────┐
│ IF outreach_enabled == true:        │
└────────────┬────────────────────────┘
             │
    ┌────────▼──────────────────┐
    │ Generate Opening Message  │
    │ (Gemini: personalized)    │
    └────────┬──────────────────┘
             │
    ┌────────▼─────────────────────┐
    │ Option A: Multi-Turn Loop    │
    │ (Wait for webhook callback)  │
    │                              │
    │ Candidate replies:           │
    │ → Infer intent               │
    │ → Generate next message      │
    │ → Loop (up to N turns)       │
    │ → Compute interest signals   │
    └────────┬─────────────────────┘
             │
    ┌────────▼─────────────────────┐
    │ Option B: Fallback (Timeout) │
    │ (No reply within N seconds)  │
    │                              │
    │ Use Gemini to simulate       │
    │ likely response and infer    │
    │ interest based on profile    │
    └────────┬─────────────────────┘
             │
    ┌────────▼──────────────────────┐
    │ Compute Interest Score:      │
    │ 35% Intent                   │
    │ 25% Availability             │
    │ 20% Compensation/Location    │
    │ 20% Engagement Depth         │
    │ = interest_score (0-100)     │
    └────────────┬─────────────────┘
                 │
    ┌────────────▼────────────────┐
    │ Store Conversation State    │
    │ (for audit trail)           │
    └────────────────────────────┘

┌─────────────────────────────────────┐
│ IF outreach_enabled == false:       │
│ Use Baseline Score (default: 50)    │
└─────────────────────────────────────┘
```

### Phase 5: Ranking & Output

```
┌──────────────────────────────────────┐
│  Compute Composite Score             │
│  = 0.70*match + 0.30*interest        │
│                                      │
│  Example:                            │
│  match=94, interest=88               │
│  → 0.70*94 + 0.30*88 = 91.8          │
└────────────┬─────────────────────────┘
             │
    ┌────────▼────────────────────┐
    │ Sort by Composite Score     │
    │                             │
    │ Tie-breakers (in order):    │
    │ 1. match_score DESC         │
    │ 2. interest_score DESC      │
    │ 3. years_experience DESC    │
    └────────┬────────────────────┘
             │
    ┌────────▼──────────────────────┐
    │ Select Top-N (default: 10)   │
    │ Add rank (1, 2, 3, ...)      │
    └────────┬──────────────────────┘
             │
    ┌────────▼──────────────────┐
    │ Add Explainability:       │
    │ - why_matched             │
    │ - why_not_higher          │
    │ - interest_rationale      │
    │ - conversation_summary    │
    │ - risk_flags              │
    │ - next_action             │
    └────────┬──────────────────┘
             │
    ┌────────▼──────────────────────┐
    │ Write to Google Sheets:      │
    │ (shortlist_output tab)       │
    │                              │
    │ Append Top-N rows with all   │
    │ scores, skills, reasoning    │
    └────────┬──────────────────────┘
             │
    ┌────────▼──────────────────────┐
    │ Return Webhook Response      │
    │ (JSON + 200 OK)              │
    │                              │
    │ Includes full shortlist with │
    │ scores, explainability, etc  │
    └──────────────────────────────┘
```

---

## Scoring Formula Deep Dive

### Match Score = 40% Skills + 25% Exp + 20% Domain + 15% Seniority

#### Skills Component (40%)

```
matched_count = count(cv_skills ∩ required_skills)
partial_count = count(cv_skills ∩ similar_to_required_skills)
missing_count = count(required_skills - cv_skills)

skills_score = ((matched_count * 1.0) + (partial_count * 0.7)) / required_skills.length * 100
```

Example:
- Required: [Python, PostgreSQL, AWS, Docker, REST APIs]
- Candidate has: [Python, PostgreSQL, MySQL, AWS, Docker, Kubernetes]
- Matched: [Python, PostgreSQL, AWS, Docker] = 4
- Partial: [MySQL matches PostgreSQL] = 0.7
- Missing: [REST APIs] = 0
- Score: (4 + 0.7) / 5 * 100 = 94%

#### Experience Component (25%)

```
experience_score = (candidate_years / min_required_years) * 100
                   (capped at 100 if candidate_years > min_required_years)

if (relevant_domain_in_cv):
    experience_score += 15  // Bonus for domain match
```

Example:
- Min required: 5 years
- Candidate: 7 years, worked at fintech startup (relevant domain)
- Score: (7 / 5) * 100 = 140, capped at 100, +15 bonus = 100 (but capped at 100)

#### Domain Component (20%)

```
key_domain_terms = extract_domain_from_jd()
// e.g., ["microservices", "high-scale", "distributed"]

matched_terms = count(key_domain_terms ∩ cv_text)

domain_score = (matched_terms / key_domain_terms.length) * 100
```

#### Seniority Component (15%)

```
seniority_mapping = {
  "entry": [0, 2],
  "mid": [2, 5],
  "senior": [5, 10],
  "principal": [10, 100]
}

candidate_level = infer_from_cv_title_and_experience()
required_level = from_jd()

if (candidate_level == required_level): score = 100
else if (candidate_level one level above): score = 90
else if (candidate_level one level below): score = 60
else: score = 20
```

### Interest Score = 35% Intent + 25% Availability + 20% Compensation + 20% Depth

Computed from multi-turn conversation or simulated responses:

```
intent_score = positive_keywords_count / total_keywords * 100
              + (questions_asked / expected_questions) * 50
              // Cap at 100

availability_score = 100 if (can_start_within_2_weeks)
                   = 75 if (within_1_month)
                   = 50 if (vague)
                   = 0 if (not_available)

compensation_score = 100 if (accepts_range)
                   = 75 if (negotiable)
                   = 50 if (not_mentioned)
                   = 0 if (too_high)

depth_score = (specificity_of_response / max_specificity) * 100
            + (relevant_experience_mentioned) * 20
            // Cap at 100

interest_score = (0.35*intent + 0.25*availability + 0.20*compensation + 0.20*depth)
```

---

## API Contracts

### Request: JD Submission

```
POST /webhook/talent-scout/job-description

{
  "job_id": "job-2025-001",
  "title": "Senior Backend Engineer",
  "jd_text": "Full JD...",
  "must_have_skills": ["Python", "PostgreSQL", "AWS"],
  "nice_to_have_skills": ["Kubernetes"],
  "location": "Remote",
  "min_years_experience": 5,
  "shortlist_size": 10,
  "outreach_enabled": true
}
```

### Response: Results

```json
{
  "status": "completed",
  "job_id": "job-2025-001",
  "request_id": "req-abc123",
  "timestamp": "2025-04-27T10:30:45Z",
  "execution_ms": 47230,
  "candidates_evaluated": 247,
  "shortlist": [
    {
      "rank": 1,
      "candidate_id": "cand-001",
      "name": "Alice Chen",
      "match_score": 94,
      "interest_score": 88,
      "composite_score": 91.8,
      "status_label": "Strong Fit",
      "matched_skills": ["Python", "PostgreSQL", "AWS", "Docker"],
      "missing_skills": [],
      "explainability": { ... }
    },
    ...
  ]
}
```

---

## Operational Flow

### Execution Phases

| Phase | Duration | Dependencies | Notes |
|-------|----------|--------------|-------|
| Ingestion | 2–5s | Webhook availability | Includes dedup check |
| Discovery | 10–20s | Drive/Sheets API | Parallel reads |
| Parsing | 5–15s per candidate | Gemini API | Batch of 10 default |
| Matching | 15–30s per batch | Gemini API | Heaviest CPU/API use |
| Outreach | 20–60s if enabled | Multi-turn timeout | Optional; 30s timeout default |
| Ranking | 2–5s | Post-processing | Sorting & output generation |
| Writing | 5–10s | Sheets API | Bulk append to tab |
| **Total** | **~60–150s** | All systems | For ~50 candidate batch |

### Resource Requirements

**Network**:
- Google Drive API: ~100 calls (list, download)
- Google Sheets API: ~2-5 calls (read candidates, read jobs, append results)
- Gemini API: ~50 calls (1 per candidate + overhead)

**CPU/Memory**:
- n8n container: 512MB–1GB RAM (local)
- PDF extraction: Minimal (handled by n8n)
- Gemini inference: Server-side (no local compute)

**Storage**:
- n8n database: ~10MB (execution history)
- Google Sheets: Append-only (negligible)

---

## Failure Handling

### Transient Failures

**Retry Strategy**: Exponential backoff (0.5s, 1s, 2s, 4s) up to 3 attempts
- Gemini API rate limit
- Google Drive/Sheets quota exceeded
- Network timeout

### Non-Recoverable Failures

**Fallback Strategy**:
- Resume extraction fails → Use empty skills, note in risk_flags
- Gemini call fails → Use baseline scores (50), note low confidence
- Sheets write fails → Still return webhook response, log for manual sync

### Dead-Letter Queue

Failed items written to error sheet with:
- candidate_id, job_id, error_type, error_message, timestamp, retry_count

---

## Security & Privacy

### PII Handling

By default:
- Email/phone masked in Gemini prompts (configurable)
- Resume text truncated (first 10,000 chars) if present
- Full candidate names used only internally

### Data Retention

- Raw resumes: 365 days (configurable)
- Outreach logs: 90 days (configurable)
- Results: Indefinite (Sheets-based)
- Execution logs: 30 days (n8n default)

### Access Control

- Google service account with minimal scopes (Drive editor, Sheets editor, Gemini API)
- n8n credentials stored encrypted in credential manager
- No secrets in workflow JSON

---

## Extensibility Points

### Easy to Add:

1. **New candidate sources**: LinkedIn, ATS integration (webhook input)
2. **Custom scoring logic**: Edit Gemini prompts, adjust weights
3. **Outreach channels**: Email, SMS, Slack (webhook output)
4. **Candidate enrichment**: Portfolio links, GitHub profile (via Gemini scraping)
5. **Advanced filtering**: Domain expertise, location match, compensation
6. **Feedback loop**: Hiring manager ratings → ML model retraining

### Hard to Add (would require redesign):

- Real-time multi-day conversation loops
- Distributed scaling (beyond single n8n instance)
- Complex ML-based ranking (requires ML infrastructure)

---

## Performance Benchmarks (Local n8n)

| Scenario | Time | Notes |
|----------|------|-------|
| Single candidate match | 8–12s | PDF extraction + Gemini |
| 10 candidates (batch) | 90–120s | Parallel processing |
| 50 candidates | 5–8 min | With outreach |
| 100+ candidates | 15–20 min | Full pipeline |

---

**Last Updated**: 2025-04-25

For visual diagrams, see `docs/diagrams/` directory.
