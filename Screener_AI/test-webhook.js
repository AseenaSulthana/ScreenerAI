#!/usr/bin/env node

/**
 * Test Script for Talent Scout Webhook
 * 
 * Usage:
 *   node test-webhook.js --url http://localhost:5678/webhook/talent-scout/job-description
 *   node test-webhook.js --url <webhook-url> --sample <sample-file>
 *   node test-webhook.js --url <webhook-url> --custom <custom-jd.json>
 * 
 * Examples:
 *   node test-webhook.js
 *   node test-webhook.js --url http://n8n.example.com/webhook/talent-scout/job-description
 *   node test-webhook.js --url http://localhost:5678/webhook/talent-scout/job-description --sample samples/input/job-description-sample.json
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const config = {
  url: 'http://localhost:5678/webhook/talent-scout/job-description',
  sampleFile: 'samples/input/job-description-sample.json',
  timeout: 60000, // 60 seconds
  verbose: false
};

// Parse CLI args
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) {
    config.url = args[i + 1];
    i++;
  } else if (args[i] === '--sample' && args[i + 1]) {
    config.sampleFile = args[i + 1];
    i++;
  } else if (args[i] === '--custom' && args[i + 1]) {
    config.sampleFile = args[i + 1];
    i++;
  } else if (args[i] === '--timeout' && args[i + 1]) {
    config.timeout = parseInt(args[i + 1], 10) * 1000;
    i++;
  } else if (args[i] === '--verbose' || args[i] === '-v') {
    config.verbose = true;
  }
}

/**
 * Load sample job description
 */
function loadSample() {
  const samplePath = path.join(__dirname, config.sampleFile);
  try {
    const content = fs.readFileSync(samplePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`❌ Failed to load sample file: ${samplePath}`);
    console.error(`   Error: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Generate a test JD payload
 */
function generateTestPayload() {
  const timestamp = new Date().toISOString();
  const jobId = `test-job-${Date.now()}`;
  
  return {
    job_id: jobId,
    title: 'Senior Backend Engineer',
    jd_text: `
      We are seeking a Senior Backend Engineer with 5+ years of experience.
      
      Required Skills:
      - Expert-level Python development
      - PostgreSQL and SQL optimization
      - AWS infrastructure (EC2, RDS, S3, Lambda)
      - REST API design and implementation
      - Docker containerization
      - CI/CD pipelines
      
      Nice to Have:
      - Kubernetes orchestration
      - Terraform Infrastructure as Code
      - Apache Kafka
      - Machine Learning integrations
      
      Responsibilities:
      - Design and implement scalable backend systems
      - Mentor junior engineers
      - Collaborate with product and frontend teams
      - Optimize database performance
      - Implement monitoring and alerting
      
      Location: Remote (US timezones preferred)
      Compensation: $150K - $200K + equity
    `,
    must_have_skills: ['Python', 'PostgreSQL', 'AWS', 'REST APIs', 'Docker', 'CI/CD'],
    nice_to_have_skills: ['Kubernetes', 'Terraform', 'Kafka', 'GraphQL'],
    location: 'Remote',
    min_years_experience: 5,
    seniority_level: 'senior',
    shortlist_size: 10,
    outreach_enabled: false
  };
}

/**
 * Send webhook request
 */
function sendWebhook(payload) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(config.url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'talent-scout-test-client/1.0'
      },
      timeout: config.timeout
    };
    
    if (config.verbose) {
      console.log('\n📡 Request Details:');
      console.log(`   Method: ${options.method}`);
      console.log(`   URL: ${config.url}`);
      console.log(`   Timeout: ${config.timeout / 1000}s`);
    }
    
    const req = protocol.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            body: parsed
          });
        } catch (err) {
          resolve({
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            body: data
          });
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${config.timeout / 1000}s`));
    });
    
    const payloadJson = JSON.stringify(payload);
    if (config.verbose) {
      console.log('\n📦 Request Payload:');
      console.log(JSON.stringify(payload, null, 2));
    }
    
    req.write(payloadJson);
    req.end();
  });
}

/**
 * Format response for display
 */
function formatResponse(response) {
  console.log('\n' + '='.repeat(60));
  console.log('📬 RESPONSE');
  console.log('='.repeat(60));
  
  // Status
  const statusColor = response.statusCode >= 200 && response.statusCode < 300 ? '✅' : '❌';
  console.log(`${statusColor} Status: ${response.statusCode} ${response.statusMessage}`);
  
  // Body
  if (response.body) {
    if (typeof response.body === 'object') {
      console.log('\n📋 Response Body:');
      console.log(JSON.stringify(response.body, null, 2));
      
      // Extract key info
      if (response.body.status) {
        console.log(`\n🎯 Status: ${response.body.status}`);
      }
      if (response.body.job_id) {
        console.log(`📌 Job ID: ${response.body.job_id}`);
      }
      if (response.body.request_id) {
        console.log(`🆔 Request ID: ${response.body.request_id}`);
      }
      if (response.body.candidates_evaluated !== undefined) {
        console.log(`👥 Candidates Evaluated: ${response.body.candidates_evaluated}`);
      }
      if (response.body.candidates_returned !== undefined) {
        console.log(`📊 Candidates Returned: ${response.body.candidates_returned}`);
      }
      if (response.body.execution_ms !== undefined) {
        console.log(`⏱️  Execution Time: ${response.body.execution_ms}ms`);
      }
    } else {
      console.log('📋 Response Body:');
      console.log(response.body);
    }
  }
  
  console.log('\n' + '='.repeat(60));
}

/**
 * Main function
 */
async function main() {
  console.log('\n🚀 Talent Scout Webhook Tester');
  console.log('='.repeat(60));
  console.log(`📍 Endpoint: ${config.url}`);
  console.log(`⏳ Timeout: ${config.timeout / 1000}s`);
  
  // Load or generate payload
  let payload;
  if (fs.existsSync(path.join(__dirname, config.sampleFile))) {
    console.log(`📂 Loading sample: ${config.sampleFile}`);
    payload = loadSample();
  } else {
    console.log('🎲 Generating random test payload...');
    payload = generateTestPayload();
  }
  
  console.log(`✨ Job ID: ${payload.job_id}`);
  console.log(`📝 Title: ${payload.title}`);
  console.log(`⏳ Sending webhook...\n`);
  
  try {
    const startTime = Date.now();
    const response = await sendWebhook(payload);
    const duration = Date.now() - startTime;
    
    formatResponse(response);
    
    console.log(`✅ Total time: ${duration}ms`);
    
    // Exit code based on status
    if (response.statusCode >= 200 && response.statusCode < 300) {
      console.log('✅ Test PASSED\n');
      process.exit(0);
    } else {
      console.log('❌ Test FAILED (non-2xx status)\n');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ ERROR');
    console.error('='.repeat(60));
    console.error(`Error Type: ${err.code || err.name}`);
    console.error(`Message: ${err.message}`);
    
    if (err.code === 'ECONNREFUSED') {
      console.error('\n💡 Tip: Is n8n running? Try:');
      console.error('   docker-compose up -d');
      console.error('   or');
      console.error('   n8n start');
    } else if (err.code === 'ENOTFOUND') {
      console.error('\n💡 Tip: Check the webhook URL is correct');
      console.error(`   Tried: ${config.url}`);
    }
    
    console.error('\n' + '='.repeat(60) + '\n');
    process.exit(1);
  }
}

// Show help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Talent Scout Webhook Test Client

Usage:
  node test-webhook.js [options]

Options:
  --url <url>           Webhook URL (default: http://localhost:5678/webhook/talent-scout/job-description)
  --sample <file>       Load sample JD file (default: samples/input/job-description-sample.json)
  --custom <file>       Alias for --sample
  --timeout <seconds>   Request timeout in seconds (default: 60)
  --verbose, -v         Print detailed request/response info
  --help, -h           Show this help message

Examples:
  node test-webhook.js
  node test-webhook.js --url http://localhost:5678/webhook/talent-scout/job-description
  node test-webhook.js --sample samples/input/job-description-sample.json --verbose
  node test-webhook.js --url http://n8n.example.com/webhook/talent-scout/job-description --timeout 120
  `);
  process.exit(0);
}

// Run
main();
