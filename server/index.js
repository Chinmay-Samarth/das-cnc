/**
 * DasCNC Backend — Entry Point
 */
 
require('dotenv').config();
const express    = require('express');
const cron       = require('node-cron');
const { markAbsentees } = require('./services/attendanceEngine');
const {syncBiometricData} = require('./services/biometricSync')
const cors = require("cors")
 
const app = express();
app.use(express.json());

app.use(cors())
 
// CORS — restrict to your frontend domain in production
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-device-secret, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
  next();
});
 
// Routes
app.use('/api/auth', require('./login'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/components', require('./routes/components'));
app.use('/api/masters', require('./routes/masters'));
app.use('/api/invoices', require('./routes/invoices'))
app.use('/api/suppliers', require('./routes/supplier'));
app.use('/api/customers', require('./routes/customers'))
app.use('/api/girn', require('./routes/girn'));
// app.use('/api/machines',   require('./routes/machines'));    // next module
 
// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

// Manual biometric sync trigger for debugging
app.post('/api/sync/biometric', async (req, res) => {
  console.log('Manual biometric sync requested via POST');
  try {
    const result = await Promise.race([
      syncBiometricData()
    ]);
    return res.json({ status: 'ok', message: result.message, result });
  } catch (err) {
    console.error('Manual biometric sync failed:', err);
    return res.status(500).json({ status: 'error', message: err?.message || 'Sync failed' });
  }
});

app.get('/api/sync/biometric', async (req, res) => {
  console.log('Manual biometric sync requested via GET');
  try {
    const result = await Promise.race([
      syncBiometricData()
    ]);
    return res.json({ status: 'ok', message: result.message, result });
  } catch (err) {
    console.error('Manual biometric sync failed:', err);
    return res.status(500).json({ status: 'error', message: err?.message || 'Sync failed' });
  }
});
 
// ─────────────────────────────────────────────
// CRON JOBS
// Run daily absent sweep at 7:00am plant time
// Marks anyone with no punch as ABSENT
// ─────────────────────────────────────────────
cron.schedule('0 7 * * *', async () => {
  console.log('Running daily absent sweep...');
  try {
    await markAbsentees();
  } catch (err) {
    console.error('Absent sweep failed:', err);
  }
}, {
  timezone: process.env.TIMEZONE || 'Asia/Kolkata'
});

cron.schedule('*/5 * * * *', async () =>{
  console.log('Fetching Biometric Data...');
  try{
    await syncBiometricData();
  }catch (err){
    console.log("Failed to Fetch Data", err)
  } 
})

// console.log('Biometric sync cron job scheduled to run every minute');
 
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`DasCNC API running on port ${PORT}`);
});