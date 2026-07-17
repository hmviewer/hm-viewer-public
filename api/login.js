const {
  authenticate,
  clearLoginFailures,
  createSessionToken,
  isLoginLimited,
  logAccess,
  recordLoginFailure,
  setSessionCookie,
} = require("../_lib/auth");
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

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
    res.statusCode = 500;
    res.json({ error: "Auth environment variables are not configured" });
    return;
  }

  const body = typeof req.body === "object" && req.body ? req.body : await readBody(req);
  if (await isLoginLimited(req, body.username)) {
    res.statusCode = 429;
    res.json({ authenticated: false, error: "로그인 실패 횟수가 많습니다. 잠시 후 다시 시도해주세요." });
    return;
  }

  const user = await authenticate(body.username, body.password);
  if (!user) {
    const failureCount = await recordLoginFailure(req, body.username);
    if (failureCount >= 5) {
      res.statusCode = 429;
      res.json({ authenticated: false, error: "로그인 실패 횟수가 많습니다. 잠시 후 다시 시도해주세요." });
      return;
    }

    res.statusCode = 401;
    res.json({ authenticated: false });
    return;
  }

  await clearLoginFailures(req, body.username);
  setSessionCookie(res, createSessionToken(user));
  await logAccess(req, user, "login");
  res.statusCode = 200;
  res.json({ authenticated: true, user });
};
