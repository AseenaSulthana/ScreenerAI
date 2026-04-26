# Setup and Installation Guide

## Quick Start (5 minutes)

### Option 1: Desktop n8n (Easiest)

1. **Download & Install n8n Desktop**
   - Visit [n8n.io](https://n8n.io) and download the Desktop app
   - Install and launch

2. **Set Environment Variables**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Import Workflow**
   - In n8n UI: **Workflows** → **Import from File**
   - Select `workflows/talent-scout-main.json`
   - Click **Import**

4. **Configure Credentials**
   - Click on each credential node in the workflow
   - Select or create credentials for:
     - Google Gemini API
     - Google Drive OAuth
     - Google Sheets OAuth
   - Save each

5. **Test**
   - Right-click the JD Submission webhook node
   - Copy the webhook URL
   - Use `curl` or Postman to POST test data (see **Testing** section)

---

## Option 2: Docker Compose (Recommended for Demo)

### Prerequisites
- Docker & Docker Compose installed
- Google credentials (JSON or OAuth tokens)

### Steps

1. **Clone and Navigate**
   ```bash
   cd hackathon-talent-agent
   ```

2. **Create Environment File**
   ```bash
   cp .env.example .env
   # Edit .env with your Google API keys, IDs, etc.
   ```

3. **Start Services**
   ```bash
   docker-compose up -d
   ```
   - n8n will be available at `http://localhost:5678`
   - Wait 30–40 seconds for health check to pass

4. **Verify Running**
   ```bash
   docker-compose logs n8n
   # Should see: "Server is now ready"
   ```

5. **Access n8n UI**
   - Open browser: `http://localhost:5678`
   - First time: create admin user and password
   - Skip any tutorials

6. **Import Workflow**
   - **Workflows** → **Import from File**
   - Select `workflows/talent-scout-main.json`
   - Click **Import**

7. **Configure Google Credentials**
   - In n8n, navigate to **Credentials** (gear icon)
   - Click **New credential**
   - Add your Google Gemini, Drive, and Sheets credentials
   - Save and update the workflow nodes to use these

8. **Activate Workflow**
   - Open the imported workflow
   - Click the **Activate** toggle (top right)
   - Status should show "Active"

---

## Manual Setup (Option 3: From Source)

If you want to run n8n locally without Docker:

1. **Install Node.js 18+**
   ```bash
   node --version  # Should be 18+
   ```

2. **Install n8n**
   ```bash
   npm install -g n8n
   ```

3. **Start n8n**
   ```bash
   export WEBHOOK_TUNNEL_URL=http://localhost:5678/
   n8n start
   ```
   - Opens http://localhost:5678 automatically

4. **Follow steps 2–8 from Docker Compose option above**

---

## Google Cloud Setup

### Enable Required APIs

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Enable these APIs:
   - **Gemini API** (Google AI for Developers)
   - **Google Drive API**
   - **Google Sheets API**

### Get Credentials

#### Option A: Service Account (Recommended for Production)

1. **Create Service Account**
   - IAM & Admin → Service Accounts
   - Create new service account
   - Grant roles: `Editor` (or more restrictive: `Drive Editor`, `Sheets Editor`)

2. **Download Key**
   - Service Accounts → select your account
   - Keys → Add Key → Create new JSON key
   - Save as `google-credentials.json`

3. **Share Drive/Sheets**
   - In Google Drive/Sheets, share with the service account email
   - Grant Editor access

#### Option B: OAuth 2.0 (For Personal Use)

1. **Create OAuth Credentials**
   - APIs & Services → Credentials
   - Create OAuth 2.0 Client ID → Desktop App
   - Download JSON

2. **In n8n**
   - Add credential
   - Select Google Sheets / Google Drive / Gemini
   - Follow authentication flow in browser

### Get API Keys/IDs

**Google Gemini API Key**:
- Google AI Studio: [aistudio.google.com](https://aistudio.google.com)
- Click "Get API key"
- Copy and save

**Google Drive Folder ID** (for resumes):
- Create or select folder in Google Drive
- Open folder in browser
- URL: `https://drive.google.com/drive/folders/[FOLDER_ID]`
- Copy the ID

**Google Sheets ID** (for candidate registry + output):
- Create new spreadsheet
- Create tabs: `candidates`, `jobs`, `shortlist_output`, `outreach_state`
- URL: `https://docs.google.com/spreadsheets/d/[SHEETS_ID]/edit`
- Copy the ID

### Set Up Google Sheets Tabs

In your main Google Sheet, create these tabs (sheets):

1. **candidates** (Input)
   - Columns: `id`, `name`, `email`, `phone`, `skills`, `years_experience`, `current_title`, `current_company`, `location`, `resume_drive_file_id`, `created_at`
   - Pre-populate with candidate data or leave empty (workflow can discover from Drive)

2. **jobs** (Reference)
   - Columns: `job_id`, `title`, `must_have_skills`, `nice_to_have_skills`, `location`, `min_years`, `submitted_at`
   - For idempotency checking

3. **shortlist_output** (Output)
   - Columns: `job_id`, `request_id`, `rank`, `candidate_name`, `candidate_email`, `composite_score`, `match_score`, `interest_score`, `status`, `matched_skills`, `missing_skills`, `confidence`, `reasoning`, `created_at`
   - Workflow appends results here

4. **outreach_state** (Optional, for multi-turn conversation logging)
   - Columns: `conversation_id`, `candidate_id`, `job_id`, `turn_number`, `message_from_agent`, `message_from_candidate`, `inferred_intent`, `confidence`, `timestamp`

---

## Configuration (.env file)

See `.env.example` for all options. Key variables:

```bash
# Required
GOOGLE_GEMINI_API_KEY=sk-...
GOOGLE_DRIVE_FOLDER_ID=1abc...
GOOGLE_SHEETS_ID=1xyz...

# Optional (defaults provided)
OUTREACH_ENABLED=true
INTEREST_CONFIDENCE_THRESHOLD=0.70
EXECUTION_TIMEOUT_MS=300000
SHORTLIST_DEFAULT_SIZE=10
```

---

## Testing the Workflow

### 1. Get Webhook URL

In n8n:
1. Open the workflow
2. Right-click the **JD Submission Webhook** node
3. Copy "Test URL" or production URL

### 2. Submit Test JD

Using `curl`:

```bash
curl -X POST http://localhost:5678/webhook/talent-scout/job-description \
  -H "Content-Type: application/json" \
  -d @samples/input/job-description-sample.json
```

Or using Postman:
1. Create new POST request
2. Paste webhook URL
3. Body → Raw → JSON
4. Paste content from `samples/input/job-description-sample.json`
5. Send

### 3. Monitor Execution

In n8n:
- Workflow opens automatically
- Watch nodes execute (green = success, red = error)
- Check **Executions** tab for history

### 4. View Results

**Google Sheets**:
- Open your Google Sheet
- Check `shortlist_output` tab
- Rows should appear with candidate rankings

**Webhook Response** (if you look at the request output):
- Returns JSON matching `samples/output/shortlist-response-sample.json`

---

## Troubleshooting

### Issue: "Invalid Credentials"

**Solution**:
- Verify credentials are shared/accessible
- For OAuth: re-authenticate and grant all permissions
- For Service Account: ensure JSON key is valid and account email is shared on Drive/Sheets

### Issue: "Folder Not Found"

**Solution**:
- Double-check `GOOGLE_DRIVE_FOLDER_ID` in `.env`
- Ensure folder exists and is shared with service account
- Try using Gemini to list folder contents

### Issue: "Gemini API Rate Limit Exceeded"

**Solution**:
- Reduce `BATCH_SIZE_CANDIDATES` in `.env`
- Add delays between calls using n8n's **Wait** node
- Upgrade Gemini API quotas in Google Cloud Console

### Issue: Workflow Execution Times Out

**Solution**:
- Increase `EXECUTION_TIMEOUT_MS` in `.env` (e.g., 600000 = 10 min)
- Reduce number of candidates being processed
- Check Google API quotas

### Issue: "No Candidates Found"

**Solution**:
- Verify `GOOGLE_DRIVE_FOLDER_ID` points to correct folder
- Upload test PDF resume to the folder
- Check `candidates` sheet is populated (if using Sheets source)
- Review workflow **Merge & Normalize Candidates** node for errors

### Issue: n8n Container Won't Start

**Solution**:
```bash
# Check logs
docker-compose logs n8n

# Remove and restart
docker-compose down -v
docker-compose up -d

# Or use production profile with PostgreSQL
docker-compose --profile production up -d
```

---

## Next Steps

1. **Customize Prompts**: Edit Gemini prompts in workflow nodes for your use case
2. **Extend Scoring**: Modify rubric weights in configuration
3. **Add Outreach**: Implement multi-turn webhook loop for real interaction
4. **Deploy**: Move to n8n Cloud or enterprise setup
5. **Integrate**: Connect to your ATS via webhook callbacks

---

## Support

- **n8n Docs**: https://docs.n8n.io/
- **Troubleshooting**: See `docs/troubleshooting.md`
- **Issues**: File GitHub issue with logs

---

**Last Updated**: 2025-04-25
