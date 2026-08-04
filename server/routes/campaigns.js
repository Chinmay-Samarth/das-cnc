const express = require('express');
const jwt = require('jsonwebtoken');
const {
  previewHorizonWave,
  lockHorizonWave,
  listWaves,
  getWCCommand,
  postCommitmentProgress,
  closeCommitment,
  upsertWorkerEfficiency,
  getCoverageCalendar,
  listCommitmentTemplates,
  saveCommitmentTemplate,
  updateCommitmentQty,
  listCommitments,
  getCommitmentDetail,
  listManagedWorkCenters,
  mintLotFromCommitment,
} = require('../services/productionCampaignEngine');
const { broadcastProductionRealtime } = require('../socket/productionRealtime');

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

function isManager(user) {
  const level = String(user?.access_level || user?.accessLevel || '').toUpperCase();
  return ['SUPERVISOR', 'MANAGER', 'ADMIN'].includes(level);
}

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error('Campaign route error:', err);
      const body = { error: err.message || 'Internal server error' };
      if (err.warnings) body.warnings = err.warnings;
      if (err.ot_required) body.ot_required = true;
      res.status(err.status || 500).json(body);
    }
  };
}

router.use(verifyEmployeeAuth);

router.get(
  '/managed-work-centers',
  wrap(async (req, res) => {
    const workCenters = await listManagedWorkCenters(req.user?.sub);
    res.json({ work_centers: workCenters });
  })
);

router.post(
  '/waves/preview',
  wrap(async (req, res) => {
    const preview = await previewHorizonWave(req.body);
    res.json(preview);
  })
);

async function handleWaveLock(req, res) {
  if (!isManager(req.user)) return res.status(403).json({ error: 'Manager access required' });
  try {
    const result = await lockHorizonWave(req.body, req.user?.sub);
    broadcastProductionRealtime({ action: 'campaign_wave_locked', workCenterId: req.body.work_center_id });
    res.json(result);
  } catch (err) {
    if (err.status === 409 && err.warnings) {
      return res.status(409).json({ error: err.message, warnings: err.warnings });
    }
    throw err;
  }
}

router.post('/waves/lock', wrap(handleWaveLock));
router.post('/waves/release', wrap(handleWaveLock));

router.get(
  '/waves',
  wrap(async (req, res) => {
    const waves = await listWaves(req.query.work_center_id || null);
    res.json({ waves });
  })
);

router.get(
  '/work-centers/:id/command',
  wrap(async (req, res) => {
    const command = await getWCCommand(req.params.id, req.query.work_date || null);
    res.json(command);
  })
);

router.get(
  '/work-centers/:id/coverage',
  wrap(async (req, res) => {
    const calendar = await getCoverageCalendar(req.params.id, {
      horizonStart: req.query.horizon_start,
      horizonEnd: req.query.horizon_end,
    });
    res.json(calendar);
  })
);

router.get(
  '/commitments',
  wrap(async (req, res) => {
    const commitments = await listCommitments({
      from: req.query.from,
      to: req.query.to,
      work_center_id: req.query.work_center_id,
      status: req.query.status,
      search: req.query.search,
    });
    res.json({ commitments });
  })
);

router.get(
  '/commitments/:id',
  wrap(async (req, res) => {
    const detail = await getCommitmentDetail(req.params.id);
    res.json(detail);
  })
);

router.post(
  '/commitments/:id/progress',
  wrap(async (req, res) => {
    const result = await postCommitmentProgress(
      req.params.id,
      req.body,
      req.user?.sub,
      { isSupervisor: false }
    );
    const lotId = result?.minted_lot?.lot?.id || result?.advance?.lot?.id;
    broadcastProductionRealtime({
      action: lotId ? 'lot_created' : 'campaign_progress',
      workCenterId: result?.commitment?.work_center_id,
      lotId: lotId || undefined,
    });
    res.json({
      commitment: result.commitment,
      minted_lot: result.minted_lot || null,
      advance: result.advance || null,
    });
  })
);

router.post(
  '/commitments/:id/mint-lot',
  wrap(async (req, res) => {
    const result = await mintLotFromCommitment(
      req.params.id,
      req.body,
      req.user?.sub,
      { isSupervisor: false }
    );
    broadcastProductionRealtime({
      action: 'lot_created',
      workCenterId: result?.lot?.work_center_id || result?.from_work_center_id,
      lotId: result?.lot?.id,
    });
    res.json(result);
  })
);

router.post(
  '/commitments/:id/close',
  wrap(async (req, res) => {
    try {
      const result = await closeCommitment(req.params.id, req.user?.sub, {
        isSupervisor: false,
        force: req.body?.force === true,
      });
      const lotId = result?.minted_lot?.lot?.id || result?.advance?.lot?.id;
      broadcastProductionRealtime({
        action: lotId ? 'lot_created' : 'campaign_day_closed',
        workCenterId: result?.commitment?.work_center_id || result?.work_center_id,
        lotId: lotId || undefined,
      });
      res.json({
        commitment: result.commitment || result,
        minted_lot: result.minted_lot || null,
        advance: result.advance || null,
      });
    } catch (err) {
      if (err.status === 409 && (err.ot_required || err.message.includes('OT required'))) {
        return res.status(409).json({ error: err.message, ot_required: true });
      }
      throw err;
    }
  })
);

router.patch(
  '/commitments/:id',
  wrap(async (req, res) => {
    const result = await updateCommitmentQty(
      req.params.id,
      req.body.committed_qty,
      req.user?.sub,
      { isSupervisor: false }
    );
    res.json({ commitment: result });
  })
);

router.get(
  '/commitment-templates',
  wrap(async (req, res) => {
    const templates = await listCommitmentTemplates(req.query.work_center_id || null);
    res.json({ templates });
  })
);

router.post(
  '/commitment-templates',
  wrap(async (req, res) => {
    if (!isManager(req.user)) return res.status(403).json({ error: 'Manager access required' });
    const template = await saveCommitmentTemplate(req.body);
    res.json({ template });
  })
);

router.post(
  '/efficiency',
  wrap(async (req, res) => {
    const entry = await upsertWorkerEfficiency(req.body, req.user?.sub, { isSupervisor: false });
    res.json({ entry });
  })
);

module.exports = router;
