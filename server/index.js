/**
 * DasCNC Backend — Entry Point
 */
 
require('dotenv').config();
const http = require('http');
const express    = require('express');
const cron       = require('node-cron');
const { markAbsentees } = require('./services/attendanceEngine');
const { syncBiometricData } = require('./services/biometricSync');
const { evaluateAttendanceAlerts } = require('./services/attendanceAlertEngine');
const { evaluateTomorrowDeliveryStockAlerts } = require('./services/inventoryAlertEngine');
const { evaluateSalesInvoiceOverdueAlerts } = require('./services/salesInvoiceAlertEngine');
const { evaluateProductionAlerts } = require('./services/productionAlertEngine');
const { evaluateReorderAlerts } = require('./services/reorderAlertEngine');
const { evaluatePredictiveReorder } = require('./services/predictiveReorderEngine');
const cors = require('cors');
const { initSocket, attachConnectionHandlers } = require('./socket');
 
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
app.use('/api/masters', require('./routes/masters/boms'));
app.use('/api/masters', require('./routes/masters/inspectionPlans'));
app.use('/api/masters', require('./routes/masters/activityFlows'));
app.use('/api/masters', require('./routes/masters'));
app.use('/api/invoices', require('./routes/invoices'))
app.use('/api/sales-invoices', require('./routes/salesInvoices'));
app.use('/api/suppliers', require('./routes/supplier'));
app.use('/api/customers', require('./routes/customers'))
app.use('/api/girn', require('./routes/girn'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/search', require('./routes/search'));
app.use('/api/work-centers', require('./routes/workCenters'));
app.use('/api/blanket-pos', require('./routes/blanketPos'));
app.use('/api/purchase-orders', require('./routes/purchaseOrders'));
app.use('/api/tool-instances', require('./routes/toolInstances'));
app.use('/api/delivery-schedules', require('./routes/deliverySchedules'));
app.use('/api/production', require('./routes/production'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/leave-requests', require('./routes/leaveRequests'));
app.use('/api/dispatch-shortfall-approvals', require('./routes/dispatchShortfallApprovals'));
app.use('/api/girn-approvals', require('./routes/girnApprovals'));
app.use('/api/admin', require('./routes/adminDashboard'));
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

cron.schedule('*/5 * * * *', async () => {
  console.log('Fetching Biometric Data...');
  try {
    await syncBiometricData();
  } catch (err) {
    console.log('Failed to Fetch Data', err);
  }
});

// Admin inbox alerts: attendance + inventory + production + invoice
cron.schedule('*/20 * * * *', async () => {
  console.log('Evaluating admin alerts...');
  try {
    await evaluateAttendanceAlerts();
  } catch (err) {
    console.error('Attendance alert evaluation failed:', err);
  }
  try {
    await evaluateTomorrowDeliveryStockAlerts();
  } catch (err) {
    console.error('Inventory delivery alert evaluation failed:', err);
  }
  try {
    await evaluateReorderAlerts();
  } catch (err) {
    console.error('Reorder alert evaluation failed:', err);
  }
  try {
    await evaluatePredictiveReorder();
  } catch (err) {
    console.error('Predictive reorder evaluation failed:', err);
  }
  try {
    await evaluateProductionAlerts();
  } catch (err) {
    console.error('Production alert evaluation failed:', err);
  }
  try {
    await evaluateSalesInvoiceOverdueAlerts();
  } catch (err) {
    console.error('Sales invoice overdue alert evaluation failed:', err);
  }
}, {
  timezone: process.env.TIMEZONE || 'Asia/Kolkata'
});

// Run once shortly after boot so the inbox is not empty until the first cron tick
setTimeout(() => {
  evaluateAttendanceAlerts()
    // .then((result) => console.log('Initial attendance alerts:', result.created))
    .catch((err) => console.error('Initial attendance alert evaluation failed:', err));
  evaluateTomorrowDeliveryStockAlerts()
    // .then((result) => console.log('Initial inventory delivery alerts:', result.created))
    .catch((err) => console.error('Initial inventory delivery alert evaluation failed:', err));
  evaluateReorderAlerts()
    .catch((err) => console.error('Initial reorder alert evaluation failed:', err));
  evaluatePredictiveReorder()
    .catch((err) => console.error('Initial predictive reorder evaluation failed:', err));
  evaluateProductionAlerts()
    // .then((result) => console.log('Initial production alerts:', result.created))
    .catch((err) => console.error('Initial production alert evaluation failed:', err));
  evaluateSalesInvoiceOverdueAlerts()
    // .then((result) => console.log('Initial sales invoice overdue alerts:', result.created))
    .catch((err) => console.error('Initial sales invoice overdue alert evaluation failed:', err));
}, 8000);
const PORT = process.env.PORT || 3001;
const server = http.createServer(app);
const io = initSocket(server);
attachConnectionHandlers(io);

server.listen(PORT, () => {
  console.log(`DasCNC API running on port ${PORT}`);
});