// ============================================================
// I-Mote Firebase Edition — server.js
// ============================================================
// This Node.js server acts as a bridge between the Firebase
// Realtime Database and the web frontend (index.html).
// It serves the frontend and exposes a REST API that the
// frontend calls — the server then writes commands to Firebase
// which the ESP32 polls and executes.
//
// Install dependencies:
//   npm install express firebase-admin cors dotenv
//
// Run:
//   node server.js
// ============================================================

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase }         = require('firebase-admin/database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────
//  FIREBASE ADMIN INIT
//  Put your Firebase service account JSON
//  in the same folder as server.js and
//  name it serviceAccountKey.json
// ─────────────────────────────────────────
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({
  credential:  cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = getDatabase();
const DEVICE  = process.env.DEVICE_ID || 'imote_01';
const base    = () => db.ref(`/devices/${DEVICE}`);
const cmdRef  = () => base().child('command');

// ─────────────────────────────────────────
//  MIDDLEWARE
// ─────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Put your index.html inside a /public folder

// ─────────────────────────────────────────
//  HELPER — send a command to the ESP32
//  by writing to Firebase /command node.
//  The ESP32 polls this every second,
//  executes it, then clears it.
// ─────────────────────────────────────────
async function sendCommand(payload) {
  await cmdRef().set({ ...payload });
}

// ─────────────────────────────────────────
//  API — GET FULL CONFIG
//  Returns devices, commands, rules
//  that the ESP32 pushed to Firebase
// ─────────────────────────────────────────
app.get('/api/config', async (req, res) => {
  try {
    const snap = await base().child('config').once('value');
    const data = snap.val();
    if (!data) return res.json({ deviceCount: 0, devices: [], rules: [] });

    // Normalize devices into array form for the frontend
    const deviceCount = data.deviceCount || 0;
    const devices = [];
    for (let i = 0; i < deviceCount; i++) {
      const d = data.devices?.[i];
      if (!d) continue;
      const cmdCount = d.cmdCount || 0;
      const commands = [];
      for (let k = 0; k < cmdCount; k++) {
        commands.push(d.commands?.[k] || '');
      }
      devices.push({ name: d.name, commands });
    }

    // Normalize rules into array form
    const rules = [];
    for (let i = 0; i < 4; i++) {
      const r = data.rules?.[i];
      rules.push({
        active:    r?.active    ?? false,
        sensor:    r?.sensor    ?? 0,
        op:        r?.op        ?? 0,
        threshold: r?.threshold ?? 0,
        devIdx:    r?.devIdx    ?? 0,
        cmdIdx:    r?.cmdIdx    ?? 0,
      });
    }

    res.json({ deviceCount, devices, rules });
  } catch (err) {
    console.error('❌ /api/config error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
//  API — GET LIVE TELEMETRY
//  Returns latest sensor snapshot
// ─────────────────────────────────────────
app.get('/api/telemetry', async (req, res) => {
  try {
    const snap = await base().child('telemetry').once('value');
    const data = snap.val();
    if (!data) return res.json({ gas: 0, light: 0, temp: 0, humid: 0 });
    res.json(data);
  } catch (err) {
    console.error('❌ /api/telemetry error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
//  API — GET LATEST LOG
// ─────────────────────────────────────────
app.get('/api/log', async (req, res) => {
  try {
    const snap = await base().child('log').once('value');
    res.json({ log: snap.val() || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
//  API — GET LEARNING STATUS
// ─────────────────────────────────────────
app.get('/api/learn_status', async (req, res) => {
  try {
    const snap = await base().child('learn_status').once('value');
    res.json({ status: snap.val() || 'idle' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
//  API — BLAST IR
//  Body: { devIdx, cmdIdx }
// ─────────────────────────────────────────
app.post('/api/blast', async (req, res) => {
  try {
    const { devIdx, cmdIdx } = req.body;
    if (devIdx === undefined || cmdIdx === undefined)
      return res.status(400).json({ error: 'devIdx and cmdIdx required' });

    await sendCommand({ action: 'blast', devIdx, cmdIdx });
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ /api/blast error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
//  API — ADD DEVICE
//  Body: { name }
// ─────────────────────────────────────────
app.post('/api/add_device', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    await sendCommand({ action: 'add_device', name });
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ /api/add_device error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
//  API — DELETE DEVICE
//  Body: { idx }
// ─────────────────────────────────────────
app.post('/api/del_device', async (req, res) => {
  try {
    const { idx } = req.body;
    if (idx === undefined) return res.status(400).json({ error: 'idx required' });

    await sendCommand({ action: 'del_device', idx });
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ /api/del_device error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
//  API — START IR LEARNING
//  Body: { devIdx, cmdName }
// ─────────────────────────────────────────
app.post('/api/start_learn', async (req, res) => {
  try {
    const { devIdx, cmdName } = req.body;
    if (devIdx === undefined || !cmdName)
      return res.status(400).json({ error: 'devIdx and cmdName required' });

    // Reset learn_status before starting
    await base().child('learn_status').set('idle');
    await sendCommand({ action: 'start_learn', devIdx, cmdName });
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ /api/start_learn error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
//  API — CANCEL IR LEARNING
// ─────────────────────────────────────────
app.post('/api/cancel_learn', async (req, res) => {
  try {
    await sendCommand({ action: 'cancel_learn' });
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ /api/cancel_learn error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
//  API — ADD AUTOMATION RULE
//  Body: { sensor, op, threshold, devIdx, cmdIdx }
// ─────────────────────────────────────────
app.post('/api/add_rule', async (req, res) => {
  try {
    const { sensor, op, threshold, devIdx, cmdIdx } = req.body;
    if (sensor === undefined || op === undefined || threshold === undefined
        || devIdx === undefined || cmdIdx === undefined)
      return res.status(400).json({ error: 'All rule fields required' });

    await sendCommand({ action: 'add_rule', sensor, op, threshold, devIdx, cmdIdx });
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ /api/add_rule error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
//  API — DELETE RULE
//  Body: { idx }
// ─────────────────────────────────────────
app.post('/api/del_rule', async (req, res) => {
  try {
    const { idx } = req.body;
    if (idx === undefined) return res.status(400).json({ error: 'idx required' });

    await sendCommand({ action: 'del_rule', idx });
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ /api/del_rule error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
//  FIREBASE REALTIME LISTENERS (SSE)
//  The frontend connects to /stream and
//  receives live updates via Server-Sent
//  Events whenever Firebase data changes —
//  this replaces WebSocket from hotspot ver
// ─────────────────────────────────────────
app.get('/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // ── Telemetry listener ──
  const telRef = base().child('telemetry');
  const telListener = telRef.on('value', snap => {
    const d = snap.val();
    if (d) send('telemetry', d);
  });

  // ── Learn status listener ──
  const learnRef = base().child('learn_status');
  const learnListener = learnRef.on('value', snap => {
    const s = snap.val();
    if (s) send('learn_status', { status: s });
  });

  // ── Automation log listener ──
  const logRef = base().child('log');
  const logListener = logRef.on('value', snap => {
    const l = snap.val();
    if (l) send('log', { text: l });
  });

  // ── Config change listener ──
  const cfgRef = base().child('config');
  const cfgListener = cfgRef.on('value', snap => {
    const d = snap.val();
    if (d) send('config', d);
  });

  // Clean up all listeners when client disconnects
  req.on('close', () => {
    telRef.off('value',   telListener);
    learnRef.off('value', learnListener);
    logRef.off('value',   logListener);
    cfgRef.off('value',   cfgListener);
    console.log('🔌 SSE client disconnected.');
  });
});

// ─────────────────────────────────────────
//  CATCH-ALL — serve index.html
// ─────────────────────────────────────────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────
//  START SERVER
// ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 I-Mote server running at http://localhost:${PORT}`);
  console.log(`📡 Firebase connected to device: ${DEVICE}`);
});