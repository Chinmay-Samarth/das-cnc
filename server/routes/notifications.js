/**
 * Notifications API — Admin (MD) inbox
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const {
  evaluateAttendanceAlerts,
  getNotificationSettings,
  updateNotificationSettings,
} = require('../services/attendanceAlertEngine');
const { evaluateTomorrowDeliveryStockAlerts } = require('../services/inventoryAlertEngine');
const { evaluateSalesInvoiceOverdueAlerts } = require('../services/salesInvoiceAlertEngine');
const { evaluateProductionAlerts } = require('../services/productionAlertEngine');
const { evaluateReorderAlerts } = require('../services/reorderAlertEngine');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function verifyEmployeeAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }
    req.user = jwt.verify(authHeader.slice(7), JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function isAdmin(user) {
  const level = String(user?.job_description || user?.accessLevel || '').toUpperCase();
  return level === 'ADMIN';
}

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error('Notifications route error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
    }
  };
}

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

router.use(verifyEmployeeAuth);

router.get(
  '/unread-count',
  wrap(async (req, res) => {
    if (!isAdmin(req.user)) {
      return res.json({ count: 0 });
    }
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('audience', 'admin')
      .eq('status', 'unread');
    if (error) throw error;
    res.json({ count: count || 0 });
  })
);

router.get(
  '/settings',
  wrap(async (req, res) => {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const settings = await getNotificationSettings();
    res.json({ settings });
  })
);

router.put(
  '/settings',
  wrap(async (req, res) => {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const settings = await updateNotificationSettings(
      { attendance_pct_threshold: req.body?.attendance_pct_threshold },
      req.user?.sub || null
    );
    // Re-run eval so new threshold can create alerts promptly
    try {
      await evaluateAttendanceAlerts();
    } catch (err) {
      console.error('Alert eval after settings update failed:', err);
    }
    res.json({ settings });
  })
);

router.post(
  '/evaluate',
  wrap(async (req, res) => {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const attendance = await evaluateAttendanceAlerts();
    const inventory = await evaluateTomorrowDeliveryStockAlerts();
    const reorder = await evaluateReorderAlerts();
    const production = await evaluateProductionAlerts();
    const invoices = await evaluateSalesInvoiceOverdueAlerts();
    res.json({ attendance, inventory, reorder, production, invoices });
  })
);

router.get(
  '/',
  wrap(async (req, res) => {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    let query = supabase
      .from('notifications')
      .select('*')
      .eq('audience', 'admin')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(Math.min(200, Number(req.query.limit) || 100));

    if (req.query.category) query = query.eq('category', req.query.category);
    if (req.query.priority) query = query.eq('priority', Number(req.query.priority));
    if (req.query.status === 'unread') query = query.eq('status', 'unread');
    else if (req.query.status === 'read') query = query.eq('status', 'read');
    else if (req.query.status === 'dismissed') query = query.eq('status', 'dismissed');
    else query = query.in('status', ['unread', 'read']); // hide dismissed by default

    const { data, error } = await query;
    if (error) throw error;
    res.json({ notifications: data || [] });
  })
);

router.post(
  '/read-all',
  wrap(async (req, res) => {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('notifications')
      .update({ status: 'read', read_at: now })
      .eq('audience', 'admin')
      .eq('status', 'unread')
      .select('id');
    if (error) throw error;
    res.json({ updated: (data || []).length });
  })
);

router.post(
  '/:id/read',
  wrap(async (req, res) => {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    if (!isValidUUID(req.params.id)) {
      return res.status(400).json({ error: 'Invalid notification id' });
    }
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('notifications')
      .update({ status: 'read', read_at: now })
      .eq('id', req.params.id)
      .eq('audience', 'admin')
      .neq('status', 'dismissed')
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Notification not found' });
    res.json({ notification: data });
  })
);

router.post(
  '/:id/dismiss',
  wrap(async (req, res) => {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    if (!isValidUUID(req.params.id)) {
      return res.status(400).json({ error: 'Invalid notification id' });
    }
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('notifications')
      .update({ status: 'dismissed', dismissed_at: now, read_at: now })
      .eq('id', req.params.id)
      .eq('audience', 'admin')
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Notification not found' });
    res.json({ notification: data });
  })
);

module.exports = router;
