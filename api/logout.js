const { clearSessionCookie, getSessionUser, logAccess } = require("../_lib/auth");
const { setSecurityHeaders } = require("../_lib/http");

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  const user = getSessionUser(req);
  if (user) await logAccess(req, user, "logout");
  clearSessionCookie(res);
  res.statusCode = 200;
  res.json({ authenticated: false });
};
