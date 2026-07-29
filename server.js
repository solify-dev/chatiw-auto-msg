const express = require('express');
require('dotenv').config();

const { runMessagingJob } = require('./index');

const PORT = Number(process.env.API_PORT || 3000);
const app = express();
app.use(express.json());

/** @type {null | Record<string, any>} */
let currentJob = null;
let running = false;

app.get('/health', (_req, res) => {
  res.json({ ok: true, running, job: currentJob });
});

app.get('/api/status', (_req, res) => {
  res.json({
    running,
    job: currentJob,
  });
});

/**
 * POST /api/message
 * Body: { "username": "teosun", "age": 30, "message": "hello" }  // message optional
 */
app.post('/api/message', (req, res) => {
  const username = String(req.body?.username || req.body?.nickname || '').trim();
  const age = String(req.body?.age ?? '').trim();
  const message = req.body?.message != null ? String(req.body.message) : undefined;

  if (!username) {
    return res.status(400).json({ ok: false, error: 'username is required' });
  }
  if (!age || !/^\d{1,3}$/.test(age)) {
    return res.status(400).json({ ok: false, error: 'age must be a number (e.g. 30)' });
  }
  if (running) {
    return res.status(409).json({
      ok: false,
      error: 'a messaging job is already running',
      job: currentJob,
    });
  }

  const jobId = `job_${Date.now()}`;
  currentJob = {
    id: jobId,
    username,
    age,
    status: 'starting',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    totalSent: 0,
    proxiesUsed: 0,
    sentTo: [],
    error: null,
  };
  running = true;

  res.status(202).json({
    ok: true,
    message: 'messaging started',
    job: currentJob,
  });

  (async () => {
    try {
      currentJob.status = 'running';
      const result = await runMessagingJob({
        username,
        age,
        message,
        onProgress: (progress) => {
          currentJob = {
            ...currentJob,
            ...progress,
            id: jobId,
            status: 'running',
            sentTo: progress.sentTo || currentJob.sentTo || [],
          };
        },
      });
      currentJob = {
        ...currentJob,
        ...result,
        id: jobId,
        status: result.status || 'completed',
        finishedAt: result.finishedAt || new Date().toISOString(),
        sentTo: result.sentTo || currentJob.sentTo || [],
      };
    } catch (err) {
      currentJob = {
        ...currentJob,
        status: 'failed',
        error: err.message || String(err),
        finishedAt: new Date().toISOString(),
      };
      console.error('[api] job failed:', err.message || err);
    } finally {
      running = false;
    }
  })();
});

app.listen(PORT, () => {
  console.log(`Chat automation API listening on http://127.0.0.1:${PORT}`);
  console.log(`  POST /api/message  { "username": "...", "age": 30 }`);
  console.log(`  GET  /api/status`);
  console.log(`  GET  /health`);
});
