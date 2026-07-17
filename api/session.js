const { getSessionUser } = require("../_lib/auth");
const { setSecurityHeaders } = require("../_lib/http");

module.exports = function handler(req, res) {
  setSecurityHeaders(res);
  const user = getSessionUser(req);
  res.statusCode = 200;
  res.json({ authenticated: Boolean(user), user });
};
