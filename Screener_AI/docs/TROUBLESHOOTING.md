# Troubleshooting Guide

## Common Issues and Solutions

### 1. Authentication & Credentials

#### Error: "Invalid Google Credentials"

**Symptoms**: Workflow nodes fail with 401 or 403 error

**Diagnosis**:
```bash
# Check if credentials file exists and is valid JSON
jq . google-credentials.json

# Verify service account email
grep "client_email" google-credentials.json
```

**Solutions**:
- **For OAuth**: Re-authenticate in n8n → Settings → Credentials → edit and click "Re-authenticate"
- **For Service Account**: 
  - Regenerate JSON key from Google Cloud Console
  - Share the service account email on your Drive/Sheets
  - Wait 1 minute for permissions to propagate

#### Error: "Unauthorized: insufficient permission"

**Solutions**:
- Grant service account `Editor` role on the sheet/folder
- Or more specific: `roles/drive.editor`, `roles/sheets.editor`

---

### 2. Workflow Execution Issues

#### Error: "Webhook not triggered"

**Diagnosis**:
- Check if workflow is **Activated** (toggle should be ON)
- Verify webhook URL is correct (copy from test URL in node)
- Check n8n is running: `curl http://localhost:5678/api/health`

**Solution**:
```bash
# Restart n8n
docker-compose restart n8n

# Or if running locally
pkill -f "n8n start"
n8n start
```

#### Error: "Node execution timeout"

**Symptoms**: Nodes show "Execution timeout" after 60+ seconds

**Causes**:
- Gemini API slow response
- Large file downloads from Drive
- Google Sheets quota exceeded
- Network latency

**Solutions**:
- Increase timeout in `.env`: `EXECUTION_TIMEOUT_MS=600000` (10 min)
- Reduce batch size: `BATCH_SIZE_CANDIDATES=5`
- Check Google API quotas in Cloud Console
- Split large workflows into multiple smaller workflows

#### Error: "Batch processing not working"

**Diagnosis**: Check the **Split in Batches** node configuration
- Batch size should match `BATCH_SIZE_CANDIDATES` env var

**Solution**:
```json
// In the Split in Batches node, set:
{
  "batchSize": 10  // or whatever your env var says
}
```

---

### 3. Google API Issues

#### Error: "Quota exceeded for Google Drive"

**Symptoms**: Workflow fails after 5-10 executions

**Solutions**:
- Add delay between operations using n8n **Wait** node (500ms)
- Reduce concurrent API calls
- Check quotas in Google Cloud Console
- Request quota increase

#### Error: "File not found in Google Drive"

**Diagnosis**:
```bash
# Verify folder ID is correct
# URL: https://drive.google.com/drive/folders/YOUR_FOLDER_ID

# Verify file exists and is accessible
# In Drive UI, right-click file → Share → Verify service account has access
```

**Solutions**:
- Check `GOOGLE_DRIVE_FOLDER_ID` in `.env` is correct
- Ensure folder is shared with service account email
- Verify file is not in Trash

#### Error: "The resource does not exist"

**Likely Cause**: Wrong Sheet ID or tab name

**Diagnosis**:
```bash
# Verify sheet exists
# URL: https://docs.google.com/spreadsheets/d/SHEET_ID/edit

# Check tab name matches workflow configuration
# Open sheet and verify tab names: "candidates", "jobs", "shortlist_output"
```

**Solution**:
- Correct `GOOGLE_SHEETS_ID` in `.env`
- Ensure all required tabs exist in the sheet
- Match tab names exactly (case-sensitive)

---

### 4. Gemini API Issues

#### Error: "INTERNAL: An internal error has occurred"

**Cause**: Gemini API temporary issue or malformed prompt

**Solution**:
- Retry the workflow (often transient)
- Check prompt formatting in Gemini node
- Review prompt variables are being populated correctly

#### Error: "Quota exceeded: daily limit"

**Symptoms**: After many executions, Gemini calls start failing

**Solution**:
- Check your Gemini API quotas: https://aistudio.google.com
- Upgrade to paid plan if needed
- Or wait for daily quota reset (usually UTC midnight)

#### Error: "Invalid JSON response from Gemini"

**Cause**: LLM output parser expects JSON but receives plain text

**Solution**:
- Add stricter prompt instruction: "Return ONLY valid JSON, no other text"
- Use **Output Parser (Structured)** node after Gemini
- Add code node to validate and fix JSON before parsing

---

### 5. Data and Processing Issues

#### Problem: "No candidates discovered"

**Diagnosis**:
1. Check Google Drive folder contains PDFs
   ```bash
   # List files in Drive via n8n debug
   # Or open folder in browser and verify files exist
   ```
2. Check candidates Sheets tab is populated
3. Review **Merge & Normalize Candidates** node in workflow

**Solutions**:
- Upload sample resumes to Drive folder
- Pre-populate candidates sheet with test data
- Check **Filter** nodes aren't filtering out all candidates

#### Problem: "Match scores all 50 (baseline)"

**Cause**: Gemini scoring not working, falling back to defaults

**Diagnosis**:
- Check Gemini node execution (look for errors)
- Verify prompt is being formatted correctly
- Check API key is valid

**Solution**:
- Review **Compute Match Score Details** node
- Check Gemini API errors in execution logs
- Validate API key in credentials

#### Problem: "Duplicate results appearing in Sheets"

**Cause**: Idempotency guard not working or flow re-triggered

**Solution**:
- Check **Check for Duplicate Job (Idempotency)** node
- Ensure `job_id` is unique in each request
- Clear old test data from `jobs` sheet if rerunning same job

---

### 6. Docker & Deployment Issues

#### Error: "Docker container won't start"

**Diagnosis**:
```bash
docker-compose logs n8n
```

**Common Causes & Solutions**:

| Error | Solution |
|-------|----------|
| `Port 5678 already in use` | Change port in docker-compose.yml: `"8080:5678"` |
| `Permission denied` | Run with sudo or add user to docker group |
| `Out of disk space` | Clean up: `docker system prune` |
| `Memory limit exceeded` | Increase Docker memory allocation |

#### Error: "Volume mount permission denied"

**Solution**:
```bash
# Fix ownership
sudo chown -R 1000:1000 ./workflows ./credentials

# Or use docker socket
docker-compose exec n8n id  # Check UID inside container
```

#### Error: "Can't connect to n8n from outside container"

**Solution**:
- Use `http://host.docker.internal:5678` instead of `localhost` on Mac/Windows
- On Linux, use `http://172.17.0.1:5678` or set `network_mode: host`

---

### 7. Testing & Debugging

#### How to Enable Debug Logging

```bash
# In .env file
DEBUG=true
LOG_LEVEL=debug

# Restart container
docker-compose restart n8n

# View logs
docker-compose logs -f n8n | grep -i error
```

#### How to Test Individual Nodes

In n8n UI:
1. Right-click node → **Test Node**
2. Review input and output
3. Check for error messages

#### How to Inspect Gemini Prompts

1. Right-click Gemini chain node → **Test Node**
2. Look at "Input" tab → see rendered prompt with variables filled
3. Compare to expected values

---

### 8. Performance Tuning

#### Workflow Too Slow

**Causes**:
- Too many candidates being processed
- Google API latency
- Gemini API slow response

**Solutions**:
1. **Reduce candidate batch size**:
   ```bash
   BATCH_SIZE_CANDIDATES=5  # Instead of 10
   ```

2. **Parallelize Google operations**:
   - Increase `PARALLEL_GEMINI_CALLS=5` (default 3)

3. **Use faster Gemini model**:
   - Change to `gemini-2.0-flash-lite` (already used)

4. **Cache JD parsing**:
   - Store parsed JD in Sheets to avoid re-parsing

5. **Monitor execution**:
   ```bash
   # Check Google API metrics
   # Google Cloud Console → APIs & Services → Metrics
   ```

---

### 9. Common Workflow Errors

| Error Message | Likely Cause | Fix |
|---------------|-------------|-----|
| `Cannot read property 'json' of undefined` | Input data not passed correctly | Check node connections and input setup |
| `Invalid file ID` | Drive ID format incorrect | Use regex: `/[-\w]{25,}/` to extract |
| `Sheet not found` | Tab name mismatch | Verify exact tab name in Sheets |
| `Gemini API key invalid` | Wrong or expired key | Regenerate from aistudio.google.com |
| `CORS error` | Browser security issue | Use curl/Postman instead of browser |

---

### 10. Quick Diagnostics Script

Run this to check setup:

```bash
#!/bin/bash

echo "=== n8n Health Check ==="
curl -s http://localhost:5678/api/health | jq .

echo "=== Google Credentials Valid? ==="
if [ -f "google-credentials.json" ]; then
  jq . google-credentials.json > /dev/null && echo "✓ Valid JSON"
else
  echo "✗ Missing google-credentials.json"
fi

echo "=== Environment Variables ==="
grep -E "^GOOGLE_|^EXECUTION_" .env

echo "=== Docker Status ==="
docker-compose ps

echo "=== Recent Errors ==="
docker-compose logs n8n | tail -20 | grep -i error
```

---

## Getting Help

1. **Check Logs**: Review n8n execution logs and Docker logs
2. **Isolate Issue**: Test individual nodes
3. **Search Issues**: Check GitHub issues for similar problems
4. **File Report**: Include:
   - n8n version
   - Workflow JSON (sanitized)
   - Error message
   - Env vars (sanitized)
   - Steps to reproduce

---

**Last Updated**: 2025-04-25
