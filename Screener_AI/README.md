# AI-Powered Talent Scouting & Engagement Agent

A production-ready n8n workflow that accepts Job Descriptions via webhook, discovers matching candidates from Google Drive resumes and Google Sheets registries, computes explainable Match and Interest scores using Google Gemini, simulates conversational outreach to gauge candidate interest, and returns a ranked Top-10 shortlist with detailed reasoning.

---

## Overview

### Problem Solved
Recruiters manually sift through hundreds of profiles and chase candidate interest. This agent automates candidate discovery, matching, and preliminary engagement assessment using AI, delivering a scored and ranked shortlist ready for immediate recruiter action.

### Key Features
- **Webhook-first architecture**: Submit JD and manage outreach replies via REST API
- **Dual-dimensional scoring**: Match Score (technical fit) + Interest Score (engagement confidence)
- **Explainable rankings**: Each candidate includes matched skills, gaps, confidence, and rationale
- **Simulated multi-turn outreach**: Optional webhook conversation loop to assess genuine interest
- **Production-ready**: Google Drive/Sheets integration, PII controls, error handling, idempotency guards
- **Local deployment**: Runs on desktop n8n or Docker Compose setup

---

## Architecture

### Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                     JD Webhook Ingestion                         │
│           (POST /api/v1/talent-scout/job-description)            │
└─────────────────────────────┬──────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │ Validate & Dedupe  │
                    └─────────┬──────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼────┐          ┌─────▼──────┐        ┌────▼────┐
   │  Parse  │          │  Discover  │        │  Parse  │
   │ Job JD  │          │ Candidates │        │ JD Reqs │
   │(Gemini) │          │(Drive+Sh) │        │(Gemini) │
   └────┬────┘          └─────┬──────┘        └────┬────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Compute Match     │
                    │  Score (0-100)     │
                    │  with Evidence     │
                    └─────────┬──────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼──────┐      ┌───────▼────────┐     ┌──────▼────┐
   │ Generate  │      │ Outreach Loop  │     │ Interest  │
   │First Msg  │      │(Multi-turn)    │     │ Fallback  │
   │(Gemini)   │      │ or Timeout     │     │ Path      │
   └────┬──────┘      └───────┬────────┘     └──────┬────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                    ┌─────────▼──────────────┐
                    │ Compute Interest Score │
                    │       (0-100)          │
                    └─────────┬──────────────┘
                              │
                    ┌─────────▼──────────────┐
                    │ Rank by Composite      │
                    │ Score (70% Match +     │
                    │ 30% Interest)          │
                    └─────────┬──────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼──────┐      ┌───────▼────────┐    ┌──────▼────┐
   │Top-10 to  │      │Top-10 to Sheet │    │ Explain   │
   │Webhook    │      │ Output Tab     │    │ Risk      │
   │Response   │      │                │    │ Flags     │
   └───────────┘      └────────────────┘    └───────────┘
```

### Scoring Formulas

**Match Score (0–100)**: Technical fit between candidate profile and job requirements
$$\text{Match} = 0.40 \times \text{Skills} + 0.25 \times \text{Experience} + 0.20 \times \text{Domain} + 0.15 \times \text{Seniority}$$

Each component is sub-scored by Gemini with evidence (matched items, missing items, confidence).

**Interest Score (0–100)**: Engagement and intent signals from simulated outreach
$$\text{Interest} = 0.35 \times \text{Intent} + 0.25 \times \text{Availability} + 0.20 \times \text{Compensation} + 0.20 \times \text{Depth}$$

**Composite Score (0–100)**: Recruiter-ready ranking signal
$$\text{Composite} = 0.70 \times \text{Match} + 0.30 \times \text{Interest}$$

Ranking: Top 10 sorted descending by Composite. Ties broken by: Match desc → Interest desc → Years Experience desc.

---

## Installation & Setup

### Requirements
- **n8n**: [Desktop](https://docs.n8n.io/hosting/installation/desktop/) or [Docker](https://docs.n8n.io/hosting/installation/docker/)
- **Google Cloud Account**: Service account JSON key for Gemini, Drive, and Sheets APIs
- **Node.js 18+**: (if running from source)

### Quick Start (Local Desktop n8n)

1. **Clone and navigate**:
   ```bash
   git clone <your-repo-url> hackathon-talent-agent
   cd hackathon-talent-agent
   ```

2. **Install n8n** (if not already installed):
   ```bash
   npm install -g n8n
   ```

3. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your Google credentials, Gemini API key, etc.
   ```

4. **Import workflow**:
   - Open n8n: `n8n start` (or use Desktop App)
   - Navigate to **Workflows** → **Import from File**
   - Upload `workflows/talent-scout-main.json`
   - Verify all credentials are configured (Gemini, Google Drive, Google Sheets)

5. **Set up Google Sheets**:
   - Create a Google Sheet with the following tabs:
     - `candidates` — existing candidate registry (columns: name, email, phone, skills, years_experience, resume_drive_id)
     - `jobs` — job requirements reference (columns: job_id, title, must_have_skills, nice_to_have_skills, etc.)
     - `shortlist_output` — results tab (workflow appends Top-10 here)
     - `outreach_state` — conversation state (for multi-turn outreach simulation)
   - Share with your Google service account email

6. **Set up Google Drive**:
   - Create a folder for resumes (e.g., `/Recruiter/Resumes`)
   - Upload sample candidate PDFs
   - Note the folder ID and add to `.env`

7. **Deploy and test**:
   - Activate the workflow
   - Submit a test JD via webhook (see **Usage** below)

### Docker Compose Setup (Optional)

```bash
docker-compose -f setup/docker-compose.yml up -d
# Then import workflow via web UI on http://localhost:5678
```

---

## Usage

### 1. Submit Job Description (Webhook Ingestion)

**Endpoint**: `POST http://localhost:5678/webhook/job-submission`

**Request**:
```json
{
  "job_id": "job-2025-001",
  "title": "Senior Backend Engineer",
  "jd_text": "Full job description text here...",
  "must_have_skills": ["Python", "PostgreSQL", "AWS"],
  "nice_to_have_skills": ["Kubernetes", "Terraform"],
  "location": "Remote",
  "min_years_experience": 5,
  "shortlist_size": 10,
  "outreach_enabled": true
}
```

**Response** (202 Accepted):
```json
{
  "status": "processing",
  "job_id": "job-2025-001",
  "request_id": "req-abc123def456",
  "polling_url": "GET /webhook/job-submission/job-2025-001/status/req-abc123def456"
}
```

### 2. Poll for Results (Optional)

**Endpoint**: `GET http://localhost:5678/webhook/job-submission/job-2025-001/status/req-abc123def456`

**Response** (when complete):
```json
{
  "status": "completed",
  "job_id": "job-2025-001",
  "request_id": "req-abc123def456",
  "timestamp": "2025-04-27T10:30:00Z",
  "execution_ms": 45230,
  "shortlist": [
    {
      "rank": 1,
      "candidate_id": "cand-001",
      "name": "Alice Chen",
      "email": "alice@example.com",
      "match_score": 92,
      "interest_score": 87,
      "composite_score": 90.5,
      "status_label": "Strong Fit",
      "matched_skills": ["Python", "PostgreSQL", "AWS", "Docker"],
      "missing_skills": ["Kubernetes"],
      "confidence": 0.94,
      "explainability": {
        "why_matched": "5+ years backend experience, strong cloud infrastructure knowledge",
        "why_not_higher": "Missing container orchestration experience",
        "interest_rationale": "Expressed enthusiasm, available within 2 weeks",
        "outreach_summary": "Positive responses in 2-turn conversation, asked about equity"
      },
      "risk_flags": []
    },
    ...
  ]
}
```

### 3. Continue Outreach Conversation (If Multi-Turn Enabled)

**Endpoint**: `POST http://localhost:5678/webhook/outreach/conversation`

**Request**:
```json
{
  "conversation_id": "conv-cand-001-job-2025-001",
  "candidate_id": "cand-001",
  "job_id": "job-2025-001",
  "message": "Sounds great! I'd love to learn more. Are you open to a quick call next week?",
  "timestamp": "2025-04-27T10:45:00Z"
}
```

**Response**:
```json
{
  "status": "message_received",
  "conversation_id": "conv-cand-001-job-2025-001",
  "turn_number": 2,
  "interest_inferred": true,
  "confidence": 0.88,
  "next_message": "Perfect! I'll have the hiring manager reach out to schedule. In the meantime, do you have any questions about the role or compensation expectations?"
}
```

---

## API Reference

### Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/webhook/job-submission` | Submit JD for candidate matching |
| GET | `/webhook/job-submission/{job_id}/status/{request_id}` | Poll for results |
| POST | `/webhook/outreach/conversation` | Send/receive outreach message |
| GET | `/health` | Workflow health check |

### Error Handling

**Example error response** (400 Bad Request):
```json
{
  "error": "validation_failed",
  "details": {
    "field": "must_have_skills",
    "message": "must_have_skills array cannot be empty"
  },
  "request_id": "req-xyz789"
}
```

**Example error response** (500 Internal Server Error):
```json
{
  "error": "gemini_api_error",
  "details": "Quota exceeded for model google/gemini-2.0-flash",
  "request_id": "req-xyz789",
  "retry_after_seconds": 60
}
```

---

## Configuration

See [`.env.example`](.env.example) for all configurable options:

- `GOOGLE_GEMINI_API_KEY`: API key for Google Gemini
- `GOOGLE_DRIVE_FOLDER_ID`: Folder ID for candidate resumes
- `GOOGLE_SHEETS_ID`: Spreadsheet ID for candidate registry
- `N8N_WEBHOOK_URL`: Base webhook URL (auto-detected locally)
- `OUTREACH_ENABLED`: Enable/disable multi-turn conversation simulation
- `INTEREST_CONFIDENCE_THRESHOLD`: Minimum confidence to include in Interest Score
- `PII_MASKING_ENABLED`: Mask email/phone in LLM prompts (default: true)
- `EXECUTION_TIMEOUT_MS`: Maximum seconds for entire pipeline (default: 300000 = 5 min)

---

## Sample Data

### Input Examples

**Sample JD** (in `samples/input/job-description-sample.json`):
- Senior Backend Engineer role
- Python + PostgreSQL + AWS required
- 5+ years experience
- Remote position

### Output Examples

**Sample shortlist** (in `samples/output/shortlist-response-sample.json`):
- Top 10 ranked candidates
- Full scores and explainability
- Risk flags and next actions

---

## Scoring Logic Deep Dive

### Match Score Breakdown

**Skills Component (40% weight)**:
- Hard match: required skill present in CV → 100 points
- Partial match: similar/adjacent skill → 70 points
- Missing: required skill absent → 0 points
- Sub-score = (matched + partial*0.7) / total_required_skills

**Experience Component (25% weight)**:
- Years in role: candidate_years vs min_required_years (capped at 1.0 if exceeds)
- Relevant domain: if CV mentions target industry/domain → +15 bonus points

**Domain Component (20% weight)**:
- Key domain terms from JD matched in CV
- Examples: "distributed systems", "microservices", "high-scale", etc.

**Seniority Component (15% weight)**:
- Current role level inferred from CV (entry/mid/senior/principal)
- Matched against JD level requirement
- Leadership experience as bonus for senior roles

### Interest Score Breakdown

Computed from simulated multi-turn conversation responses or single-turn fallback:

**Intent/Enthusiasm (35% weight)**:
- Explicit interest indicators: "interested", "excited", "definitely", "100%"
- Negative indicators: "maybe", "not sure", "low priority"
- Question count (more questions = higher engagement)

**Availability (25% weight)**:
- Explicit timeline: "available in 2 weeks" → high confidence
- Vague responses → reduced confidence
- Mention of current employment status

**Compensation/Location Fit (20% weight)**:
- Candidate accepts location or expresses flexibility
- Compensation range mentioned or implied alignment
- Willingness to negotiate

**Engagement Depth (20% weight)**:
- Response quality and specificity
- Asks clarifying questions
- Mentions concrete examples or domain knowledge

---

## Operational Notes

### Performance Baselines (Local n8n)
- Single JD screening: ~45 seconds (10 candidates)
- Batch of 100 candidates: ~6-8 minutes
- Multi-turn outreach (3 turns): +30 seconds per candidate

### Cost Considerations
- Google Gemini API: ~$0.10 per 1M tokens (varies by model)
- Estimated cost per Top-10 ranking: $0.02–0.05 (includes parsing, scoring, outreach)
- Google Drive/Sheets: Free tier usually sufficient for 1000s of candidates

### Security & Privacy
- PII (name, email, phone) masked before LLM prompts by default
- All credentials stored in n8n's encrypted credential manager (not in workflow JSON)
- Recommend rotating Gemini API key quarterly
- Drive/Sheets access controlled via Google service account with minimal scopes

### Limitations
- Does **not** scrape live job boards (LinkedIn, Indeed, etc.) — requires pre-loaded candidate corpus
- Outreach simulation is **not** real email/SMS — uses webhook state for testing interest inference
- Scoring is rule-based + Gemini; no ML model retraining loop in this version
- Max payload size: 25 MB (Google Cloud limits)

---

## Architecture Diagram

See `docs/architecture.md` for detailed flow diagrams and component descriptions.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit changes: `git commit -m "Add your feature"`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

---

## License

MIT License — see LICENSE file for details.

---

## Support

**Questions or issues?**
- Check `docs/troubleshooting.md` for common problems
- Review sample workflow runs in `samples/execution_logs/`
- File an issue on GitHub

---

## Hackathon Submission

**Submitted to**: Deccan AI Hackathon (Catalyst 2025)
**Submission Date**: April 27, 2025
**Team**: [Your Name/Team]
**Repository**: [Your GitHub URL]
**Demo Video**: [Your Video Link]
**Project Site**: [Your Project Site URL]

---

*Last updated: 2025-04-25*
