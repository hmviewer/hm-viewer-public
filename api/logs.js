const { getSessionUser, listAccessLogs, logAccess, requireAdmin } = require("../_lib/auth");
const { setSecurityHeaders } = require("../_lib/http");

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

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method === "POST") {
    const user = getSessionUser(req);
    if (!user) {
      res.statusCode = 401;
      res.json({ error: "Unauthorized" });
      return;
    }
    const body = typeof req.body === "object" && req.body ? req.body : await readBody(req);
    await logAccess(req, user, String(body.action || "click"), String(body.detail || ""));
    res.statusCode = 200;
    res.json({ ok: true });
    return;
  }

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  const admin = requireAdmin(req, res);
  if (!admin) return;

  res.statusCode = 200;
  res.json({ logs: await listAccessLogs() });
};
