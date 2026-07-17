const { createSessionToken, requireUser, setSessionCookie, updatePassword } = require("../_lib/auth");
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

  if (req.method !== "PUT") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  const user = requireUser(req, res);
  if (!user) return;

  try {
    const body = typeof req.body === "object" && req.body ? req.body : await readBody(req);
    const updatedUser = await updatePassword(user.username, body.currentPassword, body.newPassword);
    setSessionCookie(res, createSessionToken(updatedUser));
    res.statusCode = 200;
    res.json({ user: updatedUser });
  } catch (error) {
    res.statusCode = error.statusCode || 500;
    res.json({ error: error.message || "비밀번호를 변경하지 못했습니다." });
  }
};
