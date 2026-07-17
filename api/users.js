const { createUser, deleteUser, listUsers, logAccess, requireAdmin, requestUserPasswordReset } = require("../_lib/auth");
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

  const admin = requireAdmin(req, res);
  if (!admin) return;

  if (req.method === "GET") {
    res.statusCode = 200;
    res.json({ users: await listUsers() });
    return;
  }

  if (req.method === "POST") {
    try {
      const body = typeof req.body === "object" && req.body ? req.body : await readBody(req);
      const user = await createUser(body);
      res.statusCode = 201;
      res.json({ user });
    } catch (error) {
      res.statusCode = error.statusCode || 500;
      res.json({ error: error.message || "사용자를 만들지 못했습니다." });
    }
    return;
  }

  if (req.method === "PATCH") {
    try {
      const body = typeof req.body === "object" && req.body ? req.body : await readBody(req);
      if (body.action !== "reset_password") {
        res.statusCode = 400;
        res.json({ error: "지원하지 않는 사용자 작업입니다." });
        return;
      }

      const result = await requestUserPasswordReset(body.username, admin);
      await logAccess(req, admin, "reset_user_password", result.user.username);
      res.statusCode = 200;
      res.json(result);
    } catch (error) {
      res.statusCode = error.statusCode || 500;
      res.json({ error: error.message || "암호 리셋을 설정하지 못했습니다." });
    }
    return;
  }

  if (req.method === "DELETE") {
    try {
      const url = new URL(req.url || "/api/users", `https://${req.headers.host || "localhost"}`);
      const username = url.searchParams.get("username");
      const user = await deleteUser(username, admin);
      await logAccess(req, admin, "delete_user", user.username);
      res.statusCode = 200;
      res.json({ user });
    } catch (error) {
      res.statusCode = error.statusCode || 500;
      res.json({ error: error.message || "사용자를 삭제하지 못했습니다." });
    }
    return;
  }

  res.statusCode = 405;
  res.end("Method Not Allowed");
};
