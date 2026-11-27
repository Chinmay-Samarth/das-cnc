/**
 * Notifications API — Admin inbox with per-user ledgers
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const {
  evaluateAttendanceAlerts,
  getNotificationSettings,
  updateNotificationSettings,
} = require('../services/attendanceAlertEngine');
const { evaluateTomorrowDeliveryStockAlerts } = require('../services/inventoryAlertEngine');
const { evaluateSalesInvoiceOverdueAlerts } = require('../services/salesInvoiceAlertEngine');
const { evaluatePurchaseInvoiceOverdueAlerts } = require('../services/purchaseInvoiceAlertEngine');
const {
  evaluatePurchaseInvoiceTallyUnsyncedAlerts,
  evaluateSalesInvoiceTallyUnsyncedAlerts,
} = require('../services/invoiceTallyAlertEngine');
const { evaluateProductionAlerts } = require('../services/productionAlertEngine');
const { evaluateReorderAlerts } = require('../services/reorderAlertEngine');
const { isAdminUser } = require('../utils/accessLevel');
const { purgeOpenedNotifications } = require('../services/notificationPurgeEngine');
const {
  listNotificationsForUser,
  unreadCountForUser,
  setUserNotificationStatus,
  markAllUnreadReadForUser,
  deleteOpenedForUser,
} = require('../services/notificationLedger');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

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
  return isAdminUser(user);
}

function employeeId(user) {
  return user?.sub || null;
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
    const count = await unreadCountForUser(employeeId(req.user));
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
      employeeId(req.user)
    );
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
    const purchaseOverdue = await evaluatePurchaseInvoiceOverdueAlerts();
    const purchaseTally = await evaluatePurchaseInvoiceTallyUnsyncedAlerts();
    const salesTally = await evaluateSalesInvoiceTallyUnsyncedAlerts();
    res.json({
      attendance,
      inventory,
      reorder,
      production,
      invoices,
      purchaseOverdue,
      purchaseTally,
      salesTally,
    });
  })
);

router.get(
  '/',
  wrap(async (req, res) => {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const notifications = await listNotificationsForUser(employeeId(req.user), {
      status: req.query.status || undefined,
      category: req.query.category || undefined,
      priority: req.query.priority || undefined,
      limit: Number(req.query.limit) || 100,
    });
    res.json({ notifications });
  })
);

router.post(
  '/read-all',
  wrap(async (req, res) => {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const result = await markAllUnreadReadForUser(employeeId(req.user));
    res.json(result);
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
    const notification = await setUserNotificationStatus(
      employeeId(req.user),
      req.params.id,
      'read'
    );
    res.json({ notification });
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
    const notification = await setUserNotificationStatus(
      employeeId(req.user),
      req.params.id,
      'dismissed'
    );
    res.json({ notification });
  })
);

router.post(
  '/purge-opened',
  wrap(async (req, res) => {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const olderThanDays = Math.min(365, Math.max(1, Number(req.body?.olderThanDays) || 30));
    const summary = await purgeOpenedNotifications({ olderThanDays });
    res.json({
      message: `Purged opened notifications older than ${olderThanDays} days`,
      ...summary,
    });
  })
);

/** Clear this admin's opened (read) items from their personal ledger only. */
router.post(
  '/delete-opened',
  wrap(async (req, res) => {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const result = await deleteOpenedForUser(employeeId(req.user));
    res.json(result);
  })
);

module.exports = router;
