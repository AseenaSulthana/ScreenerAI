# Screener AI v2 - Complete Workflow Documentation

A unified n8n workflow that automates end-to-end AI-powered recruitment: from resume ingestion through candidate matching, dynamic question generation, email outreach, response collection, interest scoring, and final ranking—all backed by Postgres/NeonDB and Google Gemini.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Flow](#architecture-flow)
3. [Stage 0: Webhook Entry & Initialization](#stage-0-webhook-entry--initialization)
4. [Stage 1: Resume Processing Pipeline](#stage-1-resume-processing-pipeline)
5. [Stage 2: Matching Engine](#stage-2-matching-engine)
6. [Stage 3: Dynamic Question Generation](#stage-3-dynamic-question-generation)
7. [Stage 4: Email Automation](#stage-4-email-automation)
8. [Stage 5: Candidate Response Processing](#stage-5-candidate-response-processing)
9. [Stage 6: Interest Scoring Engine](#stage-6-interest-scoring-engine)
10. [Output & Response](#output--response)
11. [Scoring Logic Summary](#scoring-logic-summary)
12. [Error Handling & Fallbacks](#error-handling--fallbacks)
13. [Postgres Data Model](#postgres-data-model)
14. [Key Features](#key-features)
15. [Deployment & Setup](#deployment--setup)

---

## Overview

**Screener AI v2** consolidates fragmented talent-scouting workflows into a single, modular, webhook-driven orchestration. It processes recruitment events in two modes:

- **`resume_applied`** → Resume ingestion, parsing, embedding, JD matching, match scoring, dynamic question generation, and email outreach.
- **`candidate_response`** → Form response processing, interest scoring, and final ranking.

All data persists in Postgres/NeonDB with pgvector for semantic similarity search. Gemini LLM powers resume parsing, JD comparison, question generation, and interest scoring with deterministic fallbacks at every stage.

---

## Architecture Flow

```
Webhook Input (POST /webhook/recruitment/v2)
    ↓
[Event Router: resume_applied | candidate_response]
    ↓
┌─────────────────────┬──────────────────────────────┐
│                     │                              │
v                     v                              v
Resume Path      Shared Postgres         Response Path
 • Extract         Bootstrap              • Validate
 • Parse           Tables & Schema        • Load context
 • Embed                                  • Score interest
 • Store           ┌──────────────┐       • Rank
 • Match           │  recruitment │       • Persist
 • Generate Qs     │  evaluations │
 • Email           └──────────────┘
    ↓                                        ↓
    └────────────────┬─────────────────────┘
                     ↓
            [Final Webhook Response]
```

---

## STAGE 0: Webhook Entry & Initialization

### Nodes 1–3

#### 1. **Recruitment Webhook (Node 1)**

- **Route**: `POST /webhook/recruitment/v2`
- **Accepts dual events**:
  - `event_type=resume_applied` → include `resume_text` (plaintext or base64 PDF binary) + `job_id` (optional)
  - `event_type=candidate_response` → include `answers` (form response object)

#### 2. **Normalize Intake (Node 2)**

Extracts and standardizes all incoming fields into a consistent structure:

```javascript
{
  request_id: "req-1234567-abcdef",  // Unique per request
  event_type: "resume_applied",      // or "candidate_response"
  candidate_id: "cand@example.com",  // Primary identifier
  candidate_name: "John Doe",
  email: "john@example.com",
  phone: "+1-234-567-8900",
  job_id: "job-123",
  jd_text: "...",                    // For resume_applied
  resume_text: "...",                // For resume_applied
  answers: { Q1: "...", Q2: "..." }, // For candidate_response
  source: "webhook",
  received_at: "2024-04-26T10:30:00Z",
  shortlist_size: 10,
  weights: { match: 0.6, interest: 0.4 }
}
```

#### 3. **Bootstrap Postgres Schema (Node 3)**

Runs idempotent DDL to ensure all required tables exist. Creates:

- `recruitment_jds` – Job descriptions with embeddings.
- `recruitment_resumes` – Candidate resume data with embeddings.
- `recruitment_evaluations` – Evaluation records (match scores, interest scores, final rankings).

Uses `CREATE TABLE IF NOT EXISTS` + `CREATE EXTENSION IF NOT EXISTS vector` for pgvector support.

---

## STAGE 1: Resume Processing Pipeline (resume_applied event)

### Overview

When `event_type == "resume_applied"`, the workflow:
1. Validates resume data (text or binary PDF).
2. Extracts resume text from PDF if needed.
3. Parses resume into structured schema (name, skills, experience, etc.).
4. Generates deterministic embedding vector.
5. Stores in Postgres for future lookups.
6. Finds best-matching JD via vector similarity or explicit job_id.
7. Scores match between resume and JD.
8. Generates 5–8 tailored screening questions.
9. Seeds evaluation record in Postgres.

### Nodes 5–16

#### 1a. Resume Extraction & Validation

**Node 4: Resume Event?**
- Conditional router: if `event_type == 'resume_applied'`, proceed to resume path.
- Otherwise, route to response path (Node 33 onward).

**Node 5: Resume Data Present?**
- Validates: `resume_text` is non-empty OR `resume_binary_key` points to a binary attachment.
- Error: Return 400 `{ error: 'missing_resume_data' }` if neither provided.

**Node 8: Has Resume Binary?**
- Conditional:
  - YES: Extract text from PDF (Node 9).
  - NO: Use plaintext directly (Node 11).

**Node 9: Extract Resume PDF Text**
- Uses n8n's PDF extractor to convert binary to plaintext.
- Falls back to empty string if extraction fails.

**Nodes 10–11: Text Source Routing**
- Node 10: If PDF extraction succeeded, normalize extracted text.
- Node 11: If plaintext provided, pass through unchanged.
- Both outputs converge → Resume Parser Gemini.

#### 1b. Resume Schema Parsing

**Node 12: Resume Parser Gemini**
- Calls Google Gemini with strict prompt:
  ```
  Parse this resume into STRICT JSON only:
  {
    "candidate_name": "string",
    "email": "string",
    "phone": "string",
    "skills": ["string"],
    "years_experience": 0,
    "projects": ["string"],
    "current_title": "string",
    "summary": "string"
  }
  ```
- LLM model: `gemini-2.0-flash`
- Returns structured JSON or falls through to contract validation.

**Node 14: Resume Schema Contract**
- Validates Gemini JSON output; applies **fallback logic** if parsing fails:
  ```javascript
  function fallbackProfile(resumeText) {
    const skillBank = ['python', 'javascript', 'node.js', 'react', 'fastapi', 'aws', 'postgres', ...];
    const skills = skillBank.filter(skill => resumeText.toLowerCase().includes(skill));
    const yearsExp = parseFloat(resumeText.match(/(\d+)\+?\s+years?/)?.[1] || 3);
    return {
      candidate_name: 'Unknown Candidate',
      email: '',
      phone: '',
      skills: skills.slice(0, 12),
      years_experience: yearsExp,
      projects: [],
      current_title: '',
      summary: 'Parsed by fallback profile extractor'
    };
  }
  ```
- Outputs:
  - `resume_profile` – Normalized structured object.
  - `resume_search_text` – Concatenated searchable string (for embedding).
  - `resume_contract_valid` – Boolean flag.

#### 1c. Embedding & Storage

**Node 15: Resume Embedding Vector**
- Generates deterministic 16-dimensional vector from `resume_search_text` using simple hash-based token frequency:
  ```javascript
  function makeVector(text, size = 16) {
    const vector = new Array(size).fill(0);
    const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
    for (const token of tokens) {
      let hash = 0;
      for (let i = 0; i < token.length; i++)
        hash = ((hash << 5) - hash) + token.charCodeAt(i);
      const index = Math.abs(hash) % size;
      vector[index] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v*v, 0)) || 1;
    return vector.map(v => Number((v / norm).toFixed(6)));
  }
  ```
- Output: SQL-ready vector string like `[0.1, 0.2, 0.3, ..., 0.15]`.
- Note: This is a deterministic fallback. Can upgrade to Gemini or OpenAI embeddings API for higher semantic accuracy.

**Node 16: Store Resume in Postgres**
- SQL: Upsert into `recruitment_resumes`:
  ```sql
  INSERT INTO recruitment_resumes 
    (candidate_id, candidate_name, email, phone, resume_text, parsed_json, 
     resume_embedding, source, updated_at) 
  VALUES (...) 
  ON CONFLICT (candidate_id) DO UPDATE SET 
    candidate_name = EXCLUDED.candidate_name,
    resume_embedding = EXCLUDED.resume_embedding,
    updated_at = now()
  RETURNING *;
  ```
- Idempotent: Re-running with same candidate_id updates the record.

---

## STAGE 2: Matching Engine

### Overview

After resume is stored, the workflow:
1. Looks up the best-matching JD from the database (by explicit job_id or vector similarity).
2. Validates a JD was found; errors if not.
3. Calls Gemini to compare JD and resume.
4. Computes match_score (weighted combination of skill, experience, semantic components).
5. Stores match result as part of the evaluation record.

### Nodes 17–25

#### 2a. JD Lookup

**Node 17: JD Id Provided?**
- Conditional:
  - YES (job_id provided): Load specific JD by ID (Node 18).
  - NO: Find best-matching JD via vector similarity (Node 19).

**Node 18: Load JD By Id**
- SQL query:
  ```sql
  SELECT job_id, title, jd_text, parsed_json, jd_embedding,
         100 - ROUND((jd_embedding <=> resume_embedding::vector) * 100, 2) AS vector_similarity
  FROM recruitment_jds 
  WHERE job_id = ?
  LIMIT 1;
  ```
- Uses explicit job_id lookup.

**Node 19: Find JD By Similarity**
- SQL query:
  ```sql
  SELECT job_id, title, jd_text, parsed_json, jd_embedding,
         100 - ROUND((jd_embedding <=> resume_embedding::vector) * 100, 2) AS vector_similarity
  FROM recruitment_jds 
  ORDER BY jd_embedding <=> resume_embedding::vector ASC 
  LIMIT 1;
  ```
- pgvector similarity search: finds closest JD by cosine distance.
- Returns highest-similarity JD record.

**Node 20: Normalize JD Context**
- Extracts fields and outputs standardized `job_context` object:
  ```javascript
  {
    job_id: "job-123",
    title: "Senior Backend Engineer",
    jd_text: "...",
    parsed_json: { skills: [...], experience_level: "senior", ... },
    vector_similarity: 85.5
  }
  ```

#### 2b. JD Validation & Error Handling

**Node 21: JD Match Found?**
- Conditional:
  - YES (job_id non-empty): Proceed to match scoring (Node 24).
  - NO (job_id empty): Build error response (Node 22).

**Node 22–23: Error Response**
- Returns 404:
  ```json
  {
    "error": "empty_jd_match",
    "message": "No JD record was found in Postgres for the provided job_id or similarity search",
    "candidate_id": "cand@example.com",
    "request_id": "req-1234567"
  }
  ```

#### 2c. Match Scoring

**Node 24: Match Comparison Gemini**
- Calls Gemini with structured prompt:
  ```
  Compare the JD and resume and return STRICT JSON only:
  {
    "match_score": 0–100,
    "skill_overlap": ["skill1", "skill2"],
    "skill_gap": ["missing_skill"],
    "match_explanation": "string",
    "skill_score": 0–100,
    "experience_score": 0–100,
    "semantic_score": 0–100
  }
  
  Scoring rules:
  - skill_score: overlap between required and present skills (0–100)
  - experience_score: years_experience alignment (0–100)
  - semantic_score: overall semantic fit (0–100)
  - match_score = 0.40 * skill_score + 0.30 * experience_score + 0.30 * semantic_score
  ```
- LLM analyses both structured data and free text.
- Returns breakdown for explainability.

**Node 25: Match Result Contract**
- Parses Gemini JSON; validates schema.
- **Fallback logic** if Gemini fails or returns invalid JSON:
  ```javascript
  {
    match_score: 50,
    skill_overlap: [],
    skill_gap: resume_profile.skills.slice(0, 5),
    match_explanation: 'Fallback match based on resume skills and JD similarity.',
    skill_score: 50,
    experience_score: 50,
    semantic_score: 50
  }
  ```
- Outputs: `match_result` object with all components + flags.

---

## STAGE 3: Dynamic Question Generation

### Overview

Based on JD + resume profile + skill gaps, the workflow generates 5–8 tailored screening questions covering:
- Skill validation for gaps.
- Experience deep-dive.
- Commitment and interest.
- Availability and intent.

### Nodes 26–28

#### 3a. Question Generation

**Node 26: Question Generator Gemini**
- Calls Gemini with detailed prompt:
  ```
  Generate 5 to 8 highly specific screening questions based on:
  - JD requirements: {{ job_context.title }}, skills: {{ job_context.parsed_json.required_skills }}
  - Candidate experience gaps: {{ match_result.skill_gap.join(', ') }}
  - Candidate resume: {{ resume_profile.current_title }}, {{ resume_profile.years_experience }} years
  
  Include question types:
  1. Skill validation for gaps (e.g., specific tech they claim but JD emphasizes)
  2. Experience deep-dive (relevant project from resume)
  3. Commitment & interest (why this role now?)
  4. Availability & intent (timeline, flexibility)
  
  Return STRICT JSON:
  {
    "questions": [
      {"question": "...", "type": "skill_validation|experience_deep_dive|commitment_interest|availability_intent", "reason": "..."}
    ]
  }
  ```
- Tailors questions to specific resume + JD combination.
- Returns up to 8 questions with reasoning.

#### 3b. Question Validation

**Node 27: Question Contract**
- Validates question count: must be 5–8.
- **Fallback** if <5 or parsing fails: Uses hardcoded 4-question bank:
  ```javascript
  const fallbackQuestions = [
    { 
      question: "Describe hands-on experience with [missing_skill]...", 
      type: 'skill_validation' 
    },
    { 
      question: "Walk through most relevant project from resume...", 
      type: 'experience_deep_dive' 
    },
    { 
      question: "Why are you interested in this role now?...", 
      type: 'commitment_interest' 
    },
    { 
      question: "Realistic availability window to start?...", 
      type: 'availability_intent' 
    }
  ];
  ```
- Ensures at least one question addresses commitment and one addresses availability.

#### 3c. Evaluation Seeding

**Node 28: Seed Evaluation Record**
- INSERT into `recruitment_evaluations`:
  ```sql
  INSERT INTO recruitment_evaluations 
    (candidate_id, job_id, candidate_name, match_score, match_explanation, 
     skill_overlap, skill_gap, questions, recommended, updated_at) 
  VALUES (...)
  ON CONFLICT (candidate_id, job_id) DO UPDATE SET 
    match_score = EXCLUDED.match_score,
    questions = EXCLUDED.questions,
    updated_at = now()
  RETURNING *;
  ```
- Creates a record with match_score, questions.
- Sets interest_score = NULL (to be filled after response processing).
- Idempotent: Updates existing record for (candidate_id, job_id) pair.

---

## STAGE 4: Email Automation

### Overview

After questions are generated, the workflow:
1. Builds personalized HTML email with candidate name, job title, question list.
2. Constructs response link with candidate_id and job_id as query parameters.
3. Sends email via Gmail or SMTP.

### Nodes 29–31

#### 4a. Email Payload Construction

**Node 29: Build Email Payload**
- Constructs response link:
  ```
  https://your-n8n-url/webhook/recruitment/v2?
    event_type=candidate_response
    &candidate_id=john%40example.com
    &job_id=job-123
  ```
- Builds HTML email:
  ```html
  <html>
    <body>
      <p>Hi John Doe,</p>
      <p>Thanks for your application for <strong>Senior Backend Engineer</strong>.</p>
      <p>Please complete the short follow-up form here:</p>
      <p><a href='https://...response_link...'>response_link</a></p>
      <p>Questions:</p>
      <ol>
        <li><strong>Q1:</strong> Describe hands-on experience with...</li>
        <li><strong>Q2:</strong> Walk through most relevant project...</li>
        ...
      </ol>
      <p>Best,<br/>Recruiting Automation Agent</p>
    </body>
  </html>
  ```
- Outputs: `email_subject`, `email_html`, `response_link`.

#### 4b. Email Sending

**Node 30: Send Candidate Email**
- Integrated with Gmail OAuth or SMTP.
- Sends `email_html` to `resume_profile.email`.
- Requires credentials: `gmailOAuth2` (n8n credential).

#### 4c. Resume Intake Response

**Node 31: Resume Intake Response**
- Returns 200 OK:
  ```json
  {
    "status": "questions_sent",
    "candidate_name": "John Doe",
    "candidate_id": "john@example.com",
    "job_id": "job-123",
    "match_score": 75,
    "questions_sent": 5,
    "response_link": "https://..."
  }
  ```

**Node 32: Respond Resume Intake**
- Sends the above JSON to the webhook caller with HTTP 200.

---

## STAGE 5: Candidate Response Processing (candidate_response event)

### Overview

When candidate submits form (via response_link), the webhook receives `event_type=candidate_response` with `answers` payload. The workflow:
1. Validates form is complete (all answer fields non-empty).
2. Loads existing evaluation record from Postgres.
3. Passes candidate responses to interest scoring (next stage).

### Nodes 33–37

#### 5a. Response Validation

**Node 33: Response Payload Valid?**
- Checks: `answers` object or array is non-empty.
- Outputs: `response_complete` boolean flag.

**Node 34: Response Complete?**
- Conditional:
  - YES: Proceed to interest scoring (Node 38).
  - NO: Return 400 error (Node 35).

**Nodes 35–36: Error Response**
- Returns 400:
  ```json
  {
    "error": "incomplete_form_submission",
    "message": "candidate response answers are required",
    "request_id": "req-...",
    "candidate_id": "john@example.com",
    "job_id": "job-123"
  }
  ```

#### 5b. Context Loading

**Node 37: Load Evaluation Context**
- SQL query:
  ```sql
  SELECT candidate_id, job_id, candidate_name, match_score, match_explanation, 
         skill_overlap, skill_gap, questions, responses, interest_score, 
         interest_explanation, final_score, intent_level, recommended
  FROM recruitment_evaluations 
  WHERE candidate_id = ? AND job_id = ? 
  ORDER BY updated_at DESC 
  LIMIT 1;
  ```
- Retrieves previously-stored match_score, questions, and other context.
- Used by next stage to compute final ranking.

---

## STAGE 6: Interest Scoring Engine

### Overview

The workflow now:
1. Calls Gemini to analyze candidate's form responses.
2. Computes interest_score (weighted combination of intent clarity, engagement depth, role alignment).
3. Combines match_score + interest_score into final_score.
4. Determines if candidate is "recommended".
5. Persists final evaluation in Postgres.

### Nodes 38–41

#### 6a. Interest Scoring

**Node 38: Interest Scoring Gemini**
- Calls Gemini with detailed prompt:
  ```
  Evaluate the candidate's form responses and return STRICT JSON only:
  {
    "interest_score": 0–100,
    "interest_explanation": "string",
    "intent_level": "high|medium|low",
    "intent_clarity": 0–100,
    "engagement_depth": 0–100,
    "role_alignment": 0–100
  }
  
  Scoring rules:
  - intent_clarity (40%): How clear is their interest? (0=vague, 100=explicit "yes")
  - engagement_depth (30%): Quality and specificity of answers? (0=generic, 100=detailed & relevant)
  - role_alignment (30%): Do answers show fit for {{ job_title }}? (0=misaligned, 100=perfect fit)
  - interest_score = 0.40 * intent_clarity + 0.30 * engagement_depth + 0.30 * role_alignment
  
  Candidate responses:
  {{ JSON.stringify(answers) }}
  
  JD context:
  {{ JSON.stringify(job_context) }}
  ```
- Analyzes candidate's answers for signals of interest, commitment, fit.
- Returns breakdown for explainability + intent_level classification.

#### 6b. Interest Result Validation

**Node 39: Interest Result Contract**
- Parses Gemini JSON; validates schema.
- **Fallback logic** if Gemini fails or parsing fails:
  ```javascript
  {
    interest_score: 50,
    interest_explanation: 'Could not fully evaluate response.',
    intent_level: 'medium',
    intent_clarity: 50,
    engagement_depth: 50,
    role_alignment: 50
  }
  ```

#### 6c. Final Ranking

**Node 40: Final Ranking Engine**
- Combines match_score (from Postgres, stage 2) + interest_score (from stage 6):
  ```javascript
  const matchScore = Number(stored_match_score || 0);
  const interestScore = Number(interest_result.interest_score || 0);
  const finalScore = Math.round(matchScore * 0.60 + interestScore * 0.40);
  const recommended = finalScore >= 75 && matchScore >= 60 && interestScore >= 55;
  ```
- **Recommendation thresholds**:
  - final_score ≥ 75 (both weights contribute significantly)
  - match_score ≥ 60 (technical fit acceptable)
  - interest_score ≥ 55 (candidate shows reasonable interest)
- Outputs final ranking object.

#### 6d. Final Persistence

**Node 41: Store Final Evaluation**
- UPDATE `recruitment_evaluations`:
  ```sql
  INSERT INTO recruitment_evaluations 
    (candidate_id, job_id, candidate_name, match_score, interest_score, 
     final_score, match_explanation, interest_explanation, responses, 
     intent_level, recommended, updated_at) 
  VALUES (...)
  ON CONFLICT (candidate_id, job_id) DO UPDATE SET 
    interest_score = EXCLUDED.interest_score,
    final_score = EXCLUDED.final_score,
    responses = EXCLUDED.responses,
    intent_level = EXCLUDED.intent_level,
    recommended = EXCLUDED.recommended,
    updated_at = now()
  RETURNING *;
  ```
- Marks evaluation complete with full results.
- Idempotent: Re-running updates the record.

---

## Output & Response

### Node 42: Respond Final Output

Returns 200 OK with final evaluation JSON:

```json
{
  "candidate_name": "John Doe",
  "candidate_id": "john@example.com",
  "job_id": "job-123",
  "match_score": 75,
  "interest_score": 65,
  "final_score": 72,
  "match_explanation": "Strong technical fit with Python and FastAPI experience. Gap: Kubernetes not listed in resume.",
  "interest_explanation": "Candidate shows genuine interest and clear understanding of role requirements. High engagement in responses. Available to start in 2 weeks.",
  "recommended": true,
  "intent_level": "high",
  "skill_overlap": ["Python", "FastAPI", "PostgreSQL", "AWS"],
  "skill_gap": ["Kubernetes"],
  "responses": {
    "Q1": "I have 3 years of production experience with Python and FastAPI...",
    "Q2": "Most relevant project was a real-time order processing system...",
    "Q3": "I'm interested because this role aligns with my career goals...",
    "Q4": "I can start in 2 weeks with proper notice..."
  },
  "updated_at": "2024-04-26T10:35:00Z"
}
```

---

## Scoring Logic Summary

### Match Score Formula

$$\text{match\_score} = 0.40 \times \text{skill\_score} + 0.30 \times \text{experience\_score} + 0.30 \times \text{semantic\_score}$$

Where:
- **skill_score** (0–100): Overlap between JD required skills and resume-listed skills.
- **experience_score** (0–100): Alignment of candidate's years of experience with JD requirements.
- **semantic_score** (0–100): Overall semantic fit (pgvector similarity + contextual analysis).

### Interest Score Formula

$$\text{interest\_score} = 0.40 \times \text{intent\_clarity} + 0.30 \times \text{engagement\_depth} + 0.30 \times \text{role\_alignment}$$

Where:
- **intent_clarity** (0–100): How explicitly candidate expresses interest (vague → explicit).
- **engagement_depth** (0–100): Quality and specificity of answers (generic → detailed & relevant).
- **role_alignment** (0–100): Evidence candidate understands and fits the role (misaligned → perfect fit).

### Final Score Formula

$$\text{final\_score} = 0.60 \times \text{match\_score} + 0.40 \times \text{interest\_score}$$

Where:
- **Recommendation**: `final_score >= 75 && match_score >= 60 && interest_score >= 55`

---

## Error Handling & Fallbacks

| Scenario | HTTP Code | Response | Fallback Action |
|----------|-----------|----------|-----------------|
| Missing `resume_text` + no binary PDF | 400 | `{ error: 'missing_resume_data' }` | Reject with error |
| No matching JD in Postgres DB | 404 | `{ error: 'empty_jd_match' }` | Reject with error |
| Gemini resume parsing fails | 200 | Proceeds with fallback | Uses skill bank + regex for extraction |
| Gemini match scoring fails | 200 | Proceeds with fallback | match_score=50, skill_overlap=[], skill_gap=[all_required] |
| Gemini question generation fails | 200 | Proceeds with fallback | Uses hardcoded 4-question bank (skill, project, commitment, availability) |
| Gemini interest scoring fails | 200 | Proceeds with fallback | interest_score=50, intent_level='medium' |
| Empty form responses | 400 | `{ error: 'incomplete_form_submission' }` | Reject with error |
| Invalid `event_type` | 400 | Validation error | Reject with error |

### Deterministic Fallback Details

**Resume Profile Fallback**:
```javascript
{
  candidate_name: candidate_name_from_payload || 'Unknown Candidate',
  email: email_from_payload || '',
  phone: phone_from_payload || '',
  skills: hardcodedSkillBank.filter(skill => resumeText.includes(skill)),
  years_experience: parseInt(resumeText.match(/(\d+)\+?\s+years?/)?.[1] || 3),
  projects: [],
  current_title: '',
  summary: 'Parsed by fallback profile extractor'
}
```

**Match Score Fallback**:
```javascript
{
  match_score: 50,
  skill_overlap: [],
  skill_gap: resume_profile.skills.slice(0, 5),
  match_explanation: 'Fallback match based on resume skills and JD similarity.',
  skill_score: 50,
  experience_score: 50,
  semantic_score: 50
}
```

**Question Generation Fallback** (if <5 questions returned):
```javascript
[
  { question: "Describe hands-on experience with [skill_gap]...", type: 'skill_validation' },
  { question: "Walk through most relevant project from your resume...", type: 'experience_deep_dive' },
  { question: "Why are you interested in this role now?", type: 'commitment_interest' },
  { question: "What is your realistic availability to start?", type: 'availability_intent' }
]
```

**Interest Score Fallback**:
```javascript
{
  interest_score: 50,
  interest_explanation: 'Could not fully evaluate response.',
  intent_level: 'medium',
  intent_clarity: 50,
  engagement_depth: 50,
  role_alignment: 50
}
```

---

## Postgres Data Model

### recruitment_jds

Stores Job Descriptions with embeddings.

```sql
CREATE TABLE recruitment_jds (
  job_id TEXT PRIMARY KEY,
  title TEXT,
  jd_text TEXT NOT NULL,
  parsed_json JSONB,        -- { "roles": [...], "skills": [...], "experience_level": "...", ... }
  jd_embedding VECTOR(16),  -- 16D embedding of jd_text
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### recruitment_resumes

Stores Resume Data with embeddings.

```sql
CREATE TABLE recruitment_resumes (
  candidate_id TEXT PRIMARY KEY,
  candidate_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  resume_text TEXT NOT NULL,
  parsed_json JSONB,           -- { "skills": [...], "years_experience": N, "projects": [...], ... }
  resume_embedding VECTOR(16), -- 16D embedding of resume_text
  source TEXT DEFAULT 'webhook', -- 'webhook', 'drive', 'email', etc.
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### recruitment_evaluations

Core evaluation record: matches candidate to JD + scoring results.

```sql
CREATE TABLE recruitment_evaluations (
  evaluation_id BIGSERIAL PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  candidate_name TEXT,
  match_score NUMERIC(5,2),              -- 0–100
  interest_score NUMERIC(5,2),           -- 0–100
  final_score NUMERIC(5,2),              -- 0–100
  match_explanation TEXT,                 -- "Strong fit with Python..." or fallback
  interest_explanation TEXT,              -- "High engagement, clear interest..." or fallback
  skill_overlap JSONB,                   -- ["Python", "FastAPI", ...]
  skill_gap JSONB,                       -- ["Kubernetes", ...]
  questions JSONB,                       -- [{ "question": "...", "type": "...", "reason": "..." }, ...]
  responses JSONB,                       -- { "Q1": "answer", "Q2": "answer", ... }
  intent_level TEXT,                     -- 'high', 'medium', 'low'
  recommended BOOLEAN DEFAULT false,      -- true if final_score >= 75 && match >= 60 && interest >= 55
  email_sent BOOLEAN,
  email_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(candidate_id, job_id)           -- Enforces 1 evaluation per (candidate, job) pair
);
```

---

## Key Features

### 1. Explainability
Every score includes:
- `*_explanation` field (human-readable summary).
- Component breakdown (`skill_score`, `experience_score`, `semantic_score`, etc.).
- Skill overlap/gap arrays showing evidence.

**Example**:
```json
{
  "match_score": 75,
  "match_explanation": "Strong technical fit with Python and FastAPI experience. Gap: Kubernetes not listed.",
  "skill_score": 85,
  "experience_score": 70,
  "semantic_score": 68,
  "skill_overlap": ["Python", "FastAPI", "PostgreSQL"],
  "skill_gap": ["Kubernetes"]
}
```

### 2. Modularity
Each stage:
- Validates its input schema.
- Normalizes output to a standard contract.
- Provides deterministic fallback if LLM fails.
- No dependency on subsequent stages' success.

### 3. Idempotency
All Postgres writes use upsert logic:
- `INSERT ... ON CONFLICT (candidate_id, job_id) DO UPDATE ...`
- Re-running with same candidate_id and job_id updates the record, not duplicates.

### 4. Resilience
LLM failures don't crash the workflow:
- Gemini response parsing wrapped in `safeParse()` function.
- If parsing fails, fallback JSON is used.
- Workflow returns 200 OK with fallback values.
- Logs indicate fallback was used (via `contract_valid` flag).

### 5. Traceability
Every workflow execution generates:
- Unique `request_id` (e.g., `req-1234567-abcdef`).
- `candidate_id`, `job_id`, `timestamp`.
- Postgres records with `created_at`, `updated_at`, `updated_at`.
- Audit trail for all evaluations.

### 6. Deterministic Embeddings
16-dimensional vectors generated via hash-based token frequency:
- **Pros**: Fast, no external API calls, deterministic, good enough for MVP.
- **Cons**: Lower semantic quality than Gemini/OpenAI embeddings.
- **Upgrade path**: Replace `makeVector()` with Gemini embeddings API call (adds ~500ms latency but higher accuracy).

---

## Deployment & Setup

### Prerequisites

1. **n8n Instance**
   - Self-hosted or n8n Cloud.
   - Access to create workflows, credentials, and test webhooks.

2. **Postgres / NeonDB**
   - Database server with pgvector extension support.
   - Connection string (e.g., `postgresql://user:pass@host:5432/dbname`).

3. **Google Gemini API**
   - API key for `gemini-2.0-flash` model.
   - Enable Generative Language API in Google Cloud Console.

4. **Gmail OAuth (for email sending)**
   - Google Cloud project with Gmail API enabled.
   - OAuth 2.0 credentials (Client ID, Client Secret).
   - Or alternative: SMTP credentials for any mail server.

### Setup Steps

#### 1. Create n8n Credentials

In n8n UI, create credentials:

- **NeonDB / Postgres**:
  - Type: Postgres
  - Host: `neon-prod-xxx.neon.tech` (or your DB host)
  - Port: `5432`
  - User: `username`
  - Password: `password`
  - DB: `dbname`
  - SSL: Enable for NeonDB
  - Save as: "NeonDB"

- **Google Gemini API**:
  - Type: Google PaLM API / Gemini
  - API Key: `AIza...` (from Google Cloud)
  - Save as: "YOUR_GEMINI_API"

- **Gmail OAuth** (optional, for email sending):
  - Type: Gmail OAuth2
  - Client ID: `xxx.apps.googleusercontent.com`
  - Client Secret: `xxxx`
  - Save as: "YOUR_GMAIL_OAUTH_CREDENTIAL"

#### 2. Import V2.json Workflow

1. Open n8n UI.
2. Click **+ New** → **Workflow**.
3. Click **Menu** (three dots) → **Import from JSON**.
4. Select `V2.json`.
5. n8n will prompt you to map credentials:
   - Map "NeonDB" to your created Postgres credential.
   - Map "YOUR_GEMINI_API" to your Gemini API credential.
   - Map "YOUR_GMAIL_OAUTH_CREDENTIAL" to Gmail credential (if using email).
6. Save the workflow.

#### 3. Test the Workflow

**Resume Upload Event** (test via curl or Postman):

```bash
curl -X POST "https://your-n8n-url/webhook/recruitment/v2" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "resume_applied",
    "candidate_id": "john.doe@example.com",
    "candidate_name": "John Doe",
    "email": "john.doe@example.com",
    "phone": "+1-234-567-8900",
    "job_id": "job-backend-001",
    "resume_text": "John Doe, Python, FastAPI, 5 years experience, AWS, Docker, PostgreSQL..."
  }'
```

**Expected Response** (200 OK):

```json
{
  "status": "questions_sent",
  "candidate_name": "John Doe",
  "candidate_id": "john.doe@example.com",
  "job_id": "job-backend-001",
  "match_score": 75,
  "questions_sent": 5,
  "response_link": "https://your-n8n-url/webhook/recruitment/v2?event_type=candidate_response&candidate_id=john.doe%40example.com&job_id=job-backend-001"
}
```

**Candidate Response Event** (candidate submits form):

```bash
curl -X POST "https://your-n8n-url/webhook/recruitment/v2?event_type=candidate_response&candidate_id=john.doe@example.com&job_id=job-backend-001" \
  -H "Content-Type: application/json" \
  -d '{
    "answers": {
      "Q1": "I have 3 years of production experience with Python and FastAPI...",
      "Q2": "Most relevant project was a real-time order processing system...",
      "Q3": "I am interested in this role because...",
      "Q4": "I can start in 2 weeks with proper notice..."
    }
  }'
```

**Expected Response** (200 OK):

```json
{
  "candidate_name": "John Doe",
  "candidate_id": "john.doe@example.com",
  "job_id": "job-backend-001",
  "match_score": 75,
  "interest_score": 72,
  "final_score": 74,
  "match_explanation": "...",
  "interest_explanation": "...",
  "recommended": true,
  "intent_level": "high",
  "skill_overlap": ["Python", "FastAPI", "PostgreSQL", "AWS"],
  "skill_gap": ["Kubernetes"],
  "updated_at": "2024-04-26T10:35:00Z"
}
```

#### 4. Seeding Initial JD Data

Before testing, populate `recruitment_jds` table with job descriptions:

```sql
INSERT INTO recruitment_jds (job_id, title, jd_text, parsed_json, jd_embedding) 
VALUES (
  'job-backend-001',
  'Senior Backend Engineer',
  'We are looking for a Senior Backend Engineer with experience in Python, FastAPI, AWS, and PostgreSQL...',
  '{"skills": ["Python", "FastAPI", "AWS", "Docker", "PostgreSQL"], "min_years_experience": 5, "roles": ["Backend"], "experience_level": "senior"}',
  '[0.1, 0.2, 0.3, 0.15, 0.25, 0.1, 0.05, 0.12, 0.08, 0.14, 0.09, 0.11, 0.13, 0.07, 0.06, 0.09]'::vector(16)
);
```

**Note**: The JD embedding can be computed using the same `makeVector()` function, or you can provide zero vectors and let the workflow update them later.

#### 5. Optional: Configure Email Sending

If using Gmail:
1. Ensure the n8n workflow has "Send Candidate Email" node enabled.
2. Gmail OAuth credential must be configured.
3. The email address used must be the one authenticated in OAuth flow.

If using SMTP:
1. Replace the Gmail node with an SMTP node.
2. Configure SMTP host, port, username, password.
3. Ensure "Send Candidate Email" node is connected properly.

#### 6. Monitor & Troubleshoot

- **n8n Execution Logs**: Click workflow → "Executions" tab to view all runs.
- **Error Details**: Failed nodes show error messages with exact failure points.
- **Postgres Logs**: Query `recruitment_evaluations` to verify records are being persisted.
- **Fallback Flags**: Look for `*_contract_valid: false` to identify fallback usage.

---

## Next Steps

### Immediate Production Deployment

1. Configure all credentials (Postgres, Gemini, Gmail).
2. Seed initial JDs into `recruitment_jds` table.
3. Import V2.json and test end-to-end flow.
4. Set up monitoring and error alerting.

### Optional Enhancements

1. **Upgrade Embeddings**:
   - Replace `makeVector()` with Gemini embeddings API or OpenAI embeddings.
   - Higher semantic accuracy, adds ~500ms latency per candidate.

2. **Native Form Integration**:
   - Replace webhook query param response link with n8n `formTrigger` node.
   - Provides better UI, built-in validation, form response tracking.

3. **SQL Migration Scripts**:
   - Generate ready-to-run migration files for table creation, indexes, constraints.
   - Automate database setup across environments.

4. **Enhanced Logging**:
   - Add request trace IDs, stage execution timings, cost tracking.
   - Build dashboard for monitoring candidate funnel (resume → questions sent → responses → final ranking).

5. **Integration with ATS**:
   - Export recommended candidates to external ATS (Lever, Greenhouse, etc.).
   - Webhook callbacks to update candidate status in real-time.

---

## Support & Troubleshooting

### Common Issues

**Issue**: "No JD record was found"
- **Cause**: `recruitment_jds` table is empty or job_id doesn't exist.
- **Fix**: Seed JD data or provide valid job_id in request.

**Issue**: Gemini API returns errors
- **Cause**: API key invalid, quota exceeded, or API not enabled.
- **Fix**: Check Google Cloud Console; verify API is enabled; check rate limits.

**Issue**: Resume parsing returns generic fallback values
- **Cause**: Gemini request failed or returned invalid JSON.
- **Fix**: Check Gemini logs; increase timeout; review resume format.

**Issue**: Email not sent
- **Cause**: Gmail OAuth not configured or quota exceeded.
- **Fix**: Re-authenticate OAuth; check Gmail API quota; verify email address.

---

## License

This workflow is part of the Screener AI v2 project. See [LICENSE](LICENSE) for details.

---

**Version**: 2.0  
**Last Updated**: April 26, 2024  
**Status**: Production-Ready
