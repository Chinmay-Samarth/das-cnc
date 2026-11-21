/**
 * Near-realtime biometric sync without a device push/webhook API.
 *
 * Approach: adaptive polling of DownloadLastPunchData (old live path).
 * - Plant hours: fast poll (default 30s) so punches appear within ~one interval
 * - Off hours: slow poll (default 5 min) to spare the vendor API
 * - Overlap lock: never run two syncs at once
 * - Boot: sync once immediately after start
 * - Slower DownloadInOutPunchData double-check for punch-out + lunch only
 *
 * Env:
 *   BIOMETRIC_SYNC_INTERVAL_MS       plant-hours interval (default 30000)
 *   BIOMETRIC_SYNC_OFFHOURS_MS       off-hours interval (default 300000)
 *   BIOMETRIC_INOUT_RECHECK_MS       INOUT double-check interval (default 600000)
 *   BIOMETRIC_SYNC_PLANT_START_HOUR  local hour inclusive (default 6)
 *   BIOMETRIC_SYNC_PLANT_END_HOUR    local hour exclusive (default 22)
 *   TIMEZONE                         plant timezone (default Asia/Kolkata)
 */

const { syncBiometricData, recheckInOutPunchData } = require('./biometricSync');

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const PLANT_INTERVAL_MS = envInt('BIOMETRIC_SYNC_INTERVAL_MS', 30_000);
const OFFHOURS_INTERVAL_MS = envInt('BIOMETRIC_SYNC_OFFHOURS_MS', 5 * 60_000);
const INOUT_RECHECK_MS = envInt('BIOMETRIC_INOUT_RECHECK_MS', 10 * 60_000);
const PLANT_START_HOUR = envInt('BIOMETRIC_SYNC_PLANT_START_HOUR', 6);
const PLANT_END_HOUR = envInt('BIOMETRIC_SYNC_PLANT_END_HOUR', 22);

let running = false;
let timer = null;
let inoutTimer = null;
let lastStartedAt = null;
let lastFinishedAt = null;
let lastResult = null;
let lastError = null;
let lastInOutRecheck = null;
let tickCount = 0;

function plantHourNow() {
  const hourStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    hour12: false,
  }).format(new Date());
  return Number(hourStr);
}

function plantDateYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isPlantHours() {
  const hour = plantHourNow();
  if (!(PLANT_START_HOUR < PLANT_END_HOUR)) {
    // Cross-midnight window, e.g. 20–6
    return hour >= PLANT_START_HOUR || hour < PLANT_END_HOUR;
  }
  return hour >= PLANT_START_HOUR && hour < PLANT_END_HOUR;
}

function currentIntervalMs() {
  return isPlantHours() ? PLANT_INTERVAL_MS : OFFHOURS_INTERVAL_MS;
}

async function runBiometricSyncTick(reason = 'poll') {
  if (running) {
    return { skipped: true, reason: 'overlap' };
  }
  running = true;
  lastStartedAt = new Date().toISOString();
  tickCount += 1;
  try {
    const result = await syncBiometricData();
    lastResult = {
      at: new Date().toISOString(),
      reason,
      message: result?.message || null,
      punchCount: result?.punchCount ?? 0,
      retriableFailures: result?.retriableFailures ?? 0,
      cursorAdvancedTo: result?.cursorAdvancedTo ?? null,
    };
    lastError = null;
    if (result?.punchCount > 0) {
      console.log(
        `[biometric-poller] ${reason}: ${result.punchCount} punch(es); cursor=${result.cursorAdvancedTo}`
      );
    }
    return result;
  } catch (err) {
    lastError = err?.message || String(err);
    console.error(`[biometric-poller] ${reason} failed:`, lastError);
    throw err;
  } finally {
    lastFinishedAt = new Date().toISOString();
    running = false;
  }
}

/**
 * Double-check today's punch-out / lunch via DownloadInOutPunchData only.
 * Does not replace live LastPunchData sync.
 */
async function runInOutRecheckTick(reason = 'inout') {
  try {
    const today = plantDateYmd();
    const summary = await recheckInOutPunchData({
      fromDate: today,
      toDate: today,
      repair: true,
      lookbackDays: 3,
    });
    lastInOutRecheck = {
      at: new Date().toISOString(),
      reason,
      scanned: summary?.scanned ?? 0,
      missingOut: summary?.missingOut?.length ?? 0,
      eveningOutApplied: summary?.apply?.eveningOutApplied ?? 0,
      lunchBreakOutApplied: summary?.apply?.lunchBreakOutApplied ?? 0,
    };
    if (
      (summary?.apply?.eveningOutApplied || 0) > 0 ||
      (summary?.apply?.lunchBreakOutApplied || 0) > 0 ||
      (summary?.missingOut?.length || 0) > 0
    ) {
      console.log(
        `[biometric-poller] ${reason}: scanned=${summary.scanned} ` +
          `missingOut=${summary.missingOut?.length || 0} ` +
          `eveningOut=${summary.apply?.eveningOutApplied || 0} ` +
          `lunchOut=${summary.apply?.lunchBreakOutApplied || 0}`
      );
    }
    return summary;
  } catch (err) {
    console.error(`[biometric-poller] ${reason} failed:`, err?.message || err);
    lastInOutRecheck = {
      at: new Date().toISOString(),
      reason,
      error: err?.message || String(err),
    };
    return null;
  }
}

function scheduleNext() {
  if (timer) clearTimeout(timer);
  const wait = currentIntervalMs();
  timer = setTimeout(async () => {
    try {
      await runBiometricSyncTick(isPlantHours() ? 'plant-hours' : 'off-hours');
    } catch {
      /* logged in tick */
    }
    scheduleNext();
  }, wait);
  if (typeof timer.unref === 'function') timer.unref();
}

function scheduleInOutRecheck() {
  if (inoutTimer) clearTimeout(inoutTimer);
  inoutTimer = setTimeout(async () => {
    if (isPlantHours()) {
      await runInOutRecheckTick('inout-plant');
    }
    scheduleInOutRecheck();
  }, INOUT_RECHECK_MS);
  if (typeof inoutTimer.unref === 'function') inoutTimer.unref();
}

function startBiometricPoller() {
  if (timer) return getBiometricPollerStatus();

  console.log(
    `[biometric-poller] starting near-realtime poll ` +
      `(plant ${PLANT_START_HOUR}:00–${PLANT_END_HOUR}:00 ${TZ}: every ${PLANT_INTERVAL_MS}ms; ` +
      `off-hours: every ${OFFHOURS_INTERVAL_MS}ms; ` +
      `inout double-check: every ${INOUT_RECHECK_MS}ms)`
  );

  // Immediate catch-up after boot, then adaptive loop.
  setTimeout(() => {
    runBiometricSyncTick('boot')
      .catch(() => {})
      .finally(() => {
        runInOutRecheckTick('inout-boot').catch(() => {});
      });
  }, 2500);

  scheduleNext();
  scheduleInOutRecheck();
  return getBiometricPollerStatus();
}

function stopBiometricPoller() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (inoutTimer) clearTimeout(inoutTimer);
  inoutTimer = null;
}

function getBiometricPollerStatus() {
  return {
    running,
    plantHours: isPlantHours(),
    nextIntervalMs: currentIntervalMs(),
    plantIntervalMs: PLANT_INTERVAL_MS,
    offHoursIntervalMs: OFFHOURS_INTERVAL_MS,
    inoutRecheckIntervalMs: INOUT_RECHECK_MS,
    plantStartHour: PLANT_START_HOUR,
    plantEndHour: PLANT_END_HOUR,
    timezone: TZ,
    tickCount,
    lastStartedAt,
    lastFinishedAt,
    lastResult,
    lastInOutRecheck,
    lastError,
  };
}

module.exports = {
  startBiometricPoller,
  stopBiometricPoller,
  runBiometricSyncTick,
  runInOutRecheckTick,
  getBiometricPollerStatus,
  isPlantHours,
  currentIntervalMs,
};
