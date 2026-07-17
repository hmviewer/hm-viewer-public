const kv = require("../_lib/kv");
const { logAccess, requireAdmin, requireUser } = require("../_lib/auth");
const { setSecurityHeaders } = require("../_lib/http");

const stateKey = "season:app_state";
const backupKey = "season:state_backups";
const maxBackups = 30;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function isValidState(state) {
  return state && Array.isArray(state.seasons) && state.seasons.length > 0;
}

function getQuery(req) {
  if (req.query) return req.query;
  return Object.fromEntries(new URL(req.url || "/", "https://hm-viewer.vercel.app").searchParams);
}

function summarizeState(state) {
  return {
    currentSeasonId: state.currentSeasonId || "",
    seasons: (state.seasons || []).map((season) => ({
      id: season.id,
      season: season.season,
      roundCount: season.roundCount,
      members: season.members?.length || 0,
      entries: season.entries?.length || 0,
    })),
  };
}

function stripBackupState(backup) {
  if (!backup) return null;
  const { state, ...publicBackup } = backup;
  return publicBackup;
}

async function createStateBackup(previousState, admin, reason) {
  if (!isValidState(previousState)) return;

  const backup = {
    id: `backup-${Date.now()}`,
    at: new Date().toISOString(),
    username: admin.username,
    reason,
    summary: summarizeState(previousState),
    state: previousState,
  };

  await kv.lpush(backupKey, backup);
  await kv.ltrim(backupKey, 0, maxBackups - 1);
}

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method === "GET") {
    const query = getQuery(req);
    if (query.backups === "1") {
      const admin = requireAdmin(req, res);
      if (!admin) return;

      const backups = await kv.lrange(backupKey, 0, maxBackups - 1);
      res.statusCode = 200;
      res.json({ backups: (backups || []).map(stripBackupState).filter(Boolean) });
      return;
    }

    const user = requireUser(req, res);
    if (!user) return;

    const state = await kv.get(stateKey);
    res.statusCode = 200;
    res.json({ state: isValidState(state) ? state : null });
    return;
  }

  if (req.method === "PUT") {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    try {
      const body = typeof req.body === "object" && req.body ? req.body : await readBody(req);
      if (!isValidState(body.state)) {
        res.statusCode = 400;
        res.json({ error: "저장할 시즌 데이터가 올바르지 않습니다." });
        return;
      }

      const previousState = await kv.get(stateKey);
      if (isValidState(previousState) && JSON.stringify(previousState) !== JSON.stringify(body.state)) {
        await createStateBackup(previousState, admin, "저장 전 자동 백업");
      }

      const nextState = {
        ...body.state,
        updatedAt: new Date().toISOString(),
        updatedBy: admin.username,
      };

      await kv.set(stateKey, nextState);
      await logAccess(req, admin, "save_state", `${body.state.seasons.length} seasons`);
      res.statusCode = 200;
      res.json({ ok: true });
    } catch (error) {
      res.statusCode = error.statusCode || 500;
      res.json({ error: error.message || "시즌 데이터를 저장하지 못했습니다." });
    }
    return;
  }

  if (req.method === "POST") {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    try {
      const body = typeof req.body === "object" && req.body ? req.body : await readBody(req);
      const backupId = String(body.backupId || "");
      const backups = await kv.lrange(backupKey, 0, maxBackups - 1);
      const backup = (backups || []).find((item) => item.id === backupId);

      if (!backup || !isValidState(backup.state)) {
        res.statusCode = 404;
        res.json({ error: "복구할 백업을 찾지 못했습니다." });
        return;
      }

      const currentState = await kv.get(stateKey);
      await createStateBackup(currentState, admin, "복구 전 자동 백업");

      const restoredState = {
        ...backup.state,
        updatedAt: new Date().toISOString(),
        updatedBy: admin.username,
        restoredFrom: backup.id,
      };
      await kv.set(stateKey, restoredState);
      await logAccess(req, admin, "restore_state", `${backup.summary?.seasons?.[0]?.season || backup.id}`);

      res.statusCode = 200;
      res.json({ ok: true, state: restoredState });
    } catch (error) {
      res.statusCode = error.statusCode || 500;
      res.json({ error: error.message || "백업을 복구하지 못했습니다." });
    }
    return;
  }

  res.statusCode = 405;
  res.end("Method Not Allowed");
};
