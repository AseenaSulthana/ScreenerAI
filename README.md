# 🚀 AI-Powered Talent Scouting & Engagement Agent

## 🔍 Overview

Recruiters spend significant time manually screening resumes and assessing candidate interest. This project solves that by building an **AI-driven hiring agent** that:

* Parses job descriptions
* Discovers relevant candidates using vector search
* Evaluates candidate-job fit (Match Score)
* Assesses candidate intent and motivation (Interest Score)
* Produces a **ranked shortlist with explainability**

This system transforms hiring from a manual filtering task into a **data-driven decision pipeline**.

---

## ⚡ Key Features

### ✅ 1. Job Description Intelligence

* Extracts structured hiring requirements:

  * Required & preferred skills
  * Experience level
  * Tools & technologies
* Uses RAG over a vector database (`hrjd_pg`)

---

### ✅ 2. Candidate Discovery (RAG-Based)

* Retrieves top relevant candidates using **PGVector similarity search**
* Eliminates manual resume filtering

---

### ✅ 3. Match Scoring Engine

Each candidate is scored out of 100 based on:

| Criteria             | Weight |
| -------------------- | ------ |
| Skills Match         | 40%    |
| Experience Relevance | 30%    |
| Project Quality      | 20%    |
| Tool Alignment       | 10%    |

✔ Combines **deterministic logic + LLM reasoning**

---

### ✅ 4. Interest Scoring (Simulated Engagement)

* Evaluates candidate intent using response data
* Measures:

  * Motivation
  * Role understanding
  * Alignment with company
  * Commitment level

---

### ✅ 5. Final Ranking Engine

Final Score is computed as:

final_score = (0.7 × match_score) + (0.3 × interest_score)

Outputs a **ranked shortlist of candidates**

---

## 🧠 System Architecture

### 🔄 Pipeline Flow

1. Job Description Input
2. JD Parsing (RAG + LLM)
3. Candidate Discovery (Vector Search)
4. Resume Evaluation (Match Score)
5. Interest Evaluation (Response Analysis)
6. Final Scoring & Ranking
7. Output (JSON / Webhook / File)

---

### 🏗️ Tech Stack

* **Workflow Engine:** n8n
* **Database:** PostgreSQL + PGVector (NeonDB)
* **LLM:** Gemini (Google)
* **Embeddings:** Gemini Embeddings
* **Reranking:** Cohere Reranker
* **Storage:** Google Drive (for JD ingestion)

---

## 📊 Sample Input

```json
{
  "job_description": "Looking for a Python ML engineer with SQL and AI experience..."
}
```

---

## 📤 Sample Output

```json
{
  "job": {
    "role": "ML Engineer",
    "required_skills": ["python", "ml", "sql"],
    "experience": "2+ years"
  },
  "candidates": [
    {
      "candidate_id": "C1",
      "match_score": 82,
      "interest_score": 75,
      "final_score": 79,
      "matched_skills": ["python", "ml"],
      "missing_skills": ["sql"],
      "strengths": ["Strong ML projects"],
      "weaknesses": ["Limited SQL exposure"],
      "summary": "Good ML alignment with minor gaps"
    }
  ]
}
```

---

## ⚙️ Setup Instructions

### 1. Clone Repository

```bash
git clone <your-repo-url>
cd talent-agent
```

---

### 2. Setup Environment

* Install n8n
* Configure:

  * PostgreSQL (NeonDB)
  * Gemini API Key
  * Cohere API Key

---

### 3. Database Tables

Create vector tables:

* `hrjd_pg`
* `hrresume_pg`
* `response_pg`

Each table should contain:

* `content`
* `embedding`
* `metadata`

---

### 4. Import Workflow

* Open n8n
* Import the provided JSON workflow
* Update credentials
* Activate webhook

---

### 5. Run the System

Send POST request:

```bash
POST /webhook/talent-agent
```

---

## 🎥 Demo

👉 [Demo Video Link Here]

---

## 🧩 Design Decisions

### Why RAG?

* Ensures decisions are grounded in actual data
* Avoids hallucination

---

### Why Hybrid Scoring?

* Pure LLM scoring is inconsistent
* Pure rules lack flexibility
* Hybrid = accuracy + reasoning

---

### Why Separate Vector Stores?

* JD, Resume, and Responses have different semantic structures
* Improves retrieval quality

---

## ⚠️ Limitations

* Interest scoring is simulated if response data is missing
* Depends on embedding quality
* Requires consistent chunking strategy

---

## 🚀 Future Improvements

* Real-time conversational outreach (chat agent)
* Multi-candidate comparison dashboard
* Feedback loop for continuous learning
* ATS integration

---

## 📌 Submission Details

* GitHub Repo: <link>
* Demo Video: <link>
* Live URL: <link>

---

## 👨‍💻 Author

Built for Deccan AI Hackathon

---

## 🧠 Final Note

This system is not just a pipeline—it is a **decision engine** that automates candidate evaluation with explainability and scalability.
