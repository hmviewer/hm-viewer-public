const crypto = require("crypto");
const kv = require("./kv");

const cookieName = "season_session";
const maxAgeSeconds = 60 * 60 * 12;
const userIndexKey = "season:users";
const logKey = "season:access_logs";
const maxAccessLogs = 1000;
const loginLimitSeconds = 15 * 60;
const maxLoginFailures = 5;

function getSecret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
}

function getBootstrapAdmin() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "";
  return {
    username,
    password,
    user: {
      username,
      displayName: "관리자",
      role: "admin",
      createdAt: "환경변수",
      mustChangePassword: false,
      isBootstrapAdmin: true,
    },
  };
}

function sign(value) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const iterations = 210000;
  const hash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, "sha256").toString("base64url");
  return `pbkdf2:${iterations}:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [algorithm, iterations, salt, hash] = String(storedHash || "").split(":");
  if (algorithm !== "pbkdf2" || !iterations || !salt || !hash) return false;
  const candidate = crypto.pbkdf2Sync(String(password), salt, Number(iterations), 32, "sha256").toString("base64url");
  return safeEqual(candidate, hash);
}

function isValidPasswordText(password) {
  return /^[A-Za-z0-9]+$/.test(String(password || ""));
}

function userKey(username) {
  return `season:user:${String(username).trim().toLowerCase()}`;
}

function cleanUser(user) {
  if (!user) return null;
  const { passwordHash, ...publicUser } = user;
  return publicUser;
}

function isKvConfigError(error) {
  return String(error?.message || "").includes("Vercel KV environment variables are not configured");
}

async function optionalKvGet(key) {
  try {
    return await kv.get(key);
  } catch (error) {
    if (isKvConfigError(error)) return null;
    throw error;
  }
}

async function getUser(username) {
  const normalized = String(username || "").trim().toLowerCase();
  if (!normalized) return null;

  const storedUser = await optionalKvGet(userKey(normalized));
  if (storedUser) return storedUser;

  const bootstrap = getBootstrapAdmin();
  if (normalized === bootstrap.username.toLowerCase()) {
    return bootstrap.user;
  }

  return null;
}

async function createUser({ username, displayName, password, role }) {
  const normalized = String(username || "").trim().toLowerCase();
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(normalized)) {
    const error = new Error("아이디는 영문/숫자/._- 조합 3자 이상이어야 합니다.");
    error.statusCode = 400;
    throw error;
  }

  if (!password || String(password).length < 6) {
    const error = new Error("비밀번호는 6자 이상이어야 합니다.");
    error.statusCode = 400;
    throw error;
  }
  if (!isValidPasswordText(password)) {
    const error = new Error("비밀번호는 영문과 숫자만 사용할 수 있습니다.");
    error.statusCode = 400;
    throw error;
  }

  const existing = await getUser(normalized);
  if (existing) {
    const error = new Error("이미 존재하는 아이디입니다.");
    error.statusCode = 409;
    throw error;
  }

  const user = {
    username: normalized,
    displayName: String(displayName || normalized).trim(),
    role: role === "admin" ? "admin" : "user",
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    mustChangePassword: true,
  };

  await kv.set(userKey(normalized), user);
  await kv.sadd(userIndexKey, normalized);
  return cleanUser(user);
}

async function deleteUser(username, actor) {
  const normalized = String(username || "").trim().toLowerCase();
  const bootstrap = getBootstrapAdmin();

  if (!normalized) {
    const error = new Error("삭제할 사용자를 선택해주세요.");
    error.statusCode = 400;
    throw error;
  }

  if (normalized === String(actor?.username || "").toLowerCase()) {
    const error = new Error("현재 로그인한 계정은 삭제할 수 없습니다.");
    error.statusCode = 400;
    throw error;
  }

  if (normalized === bootstrap.username.toLowerCase() && !(await kv.get(userKey(normalized)))) {
    const error = new Error("기본 관리자 계정은 삭제할 수 없습니다.");
    error.statusCode = 400;
    throw error;
  }

  const user = await kv.get(userKey(normalized));
  if (!user) {
    const error = new Error("사용자를 찾을 수 없습니다.");
    error.statusCode = 404;
    throw error;
  }

  await kv.del(userKey(normalized));
  await kv.srem(userIndexKey, normalized);
  return cleanUser(user);
}

async function requestUserPasswordReset(username, actor) {
  const normalized = String(username || "").trim().toLowerCase();
  const bootstrap = getBootstrapAdmin();

  if (!normalized) {
    const error = new Error("암호 리셋할 사용자를 선택해주세요.");
    error.statusCode = 400;
    throw error;
  }

  if (normalized === String(actor?.username || "").toLowerCase()) {
    const error = new Error("현재 로그인한 계정은 내 계정에서 비밀번호를 변경해주세요.");
    error.statusCode = 400;
    throw error;
  }

  if (normalized === bootstrap.username.toLowerCase() && !(await kv.get(userKey(normalized)))) {
    const error = new Error("기본 관리자 계정은 먼저 내 계정에서 비밀번호를 변경한 뒤 관리할 수 있습니다.");
    error.statusCode = 400;
    throw error;
  }

  const user = await kv.get(userKey(normalized));
  if (!user) {
    const error = new Error("사용자를 찾을 수 없습니다.");
    error.statusCode = 404;
    throw error;
  }

  const nextUser = {
    ...user,
    passwordHash: hashPassword(crypto.randomBytes(18).toString("base64url")),
    mustChangePassword: true,
    passwordResetRequired: true,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.username || "",
  };

  await kv.set(userKey(normalized), nextUser);
  await kv.sadd(userIndexKey, normalized);
  return { user: cleanUser(nextUser) };
}

async function listUsers() {
  const bootstrap = getBootstrapAdmin();
  let users = [];
  try {
    const usernames = await kv.smembers(userIndexKey);
    users = await Promise.all((usernames || []).sort().map((username) => kv.get(userKey(username))));
  } catch (error) {
    if (!isKvConfigError(error)) throw error;
  }

  const storedUsers = users.filter(Boolean);
  const storedAdmin = storedUsers.find((user) => user.username === bootstrap.username.toLowerCase());
  const publicUsers = storedUsers.map(cleanUser);

  if (storedAdmin) return publicUsers;
  return [cleanUser(bootstrap.user), ...publicUsers];
}

async function updatePassword(username, currentPassword, newPassword) {
  const normalized = String(username || "").trim().toLowerCase();
  const bootstrap = getBootstrapAdmin();

  const user = await kv.get(userKey(normalized));
  const isBootstrapAdmin = normalized === bootstrap.username.toLowerCase();
  const canChangeBootstrapAdmin =
    isBootstrapAdmin && !user && bootstrap.password && safeEqual(currentPassword, bootstrap.password);

  const canResetWithoutCurrentPassword = Boolean(user?.passwordResetRequired);
  if (!canChangeBootstrapAdmin && !canResetWithoutCurrentPassword && (!user || !verifyPassword(currentPassword, user.passwordHash))) {
    const error = new Error("현재 비밀번호를 확인해주세요.");
    error.statusCode = 401;
    throw error;
  }

  if (!newPassword || String(newPassword).length < 6) {
    const error = new Error("새 비밀번호는 6자 이상이어야 합니다.");
    error.statusCode = 400;
    throw error;
  }
  if (!isValidPasswordText(newPassword)) {
    const error = new Error("비밀번호는 영문과 숫자만 사용할 수 있습니다.");
    error.statusCode = 400;
    throw error;
  }

  const nextUser = user || {
    username: normalized,
    displayName: bootstrap.user.displayName,
    role: "admin",
    createdAt: new Date().toISOString(),
  };

  nextUser.passwordHash = hashPassword(newPassword);
  nextUser.mustChangePassword = false;
  nextUser.passwordResetRequired = false;
  nextUser.updatedAt = new Date().toISOString();
  await kv.set(userKey(normalized), nextUser);
  await kv.sadd(userIndexKey, normalized);
  return cleanUser(nextUser);
}

async function authenticate(username, password) {
  const normalized = String(username || "").trim().toLowerCase();
  if (password && !isValidPasswordText(password)) return null;

  const user = await optionalKvGet(userKey(normalized));
  if (user) {
    if (user.passwordResetRequired && !password) {
      return cleanUser(user);
    }
    return verifyPassword(password, user.passwordHash) ? cleanUser(user) : null;
  }

  const bootstrap = getBootstrapAdmin();
  if (normalized === bootstrap.username.toLowerCase()) {
    return bootstrap.password && safeEqual(password, bootstrap.password) ? bootstrap.user : null;
  }

  return null;
}

function createSessionToken(user) {
  const payload = {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    passwordResetRequired: Boolean(user.passwordResetRequired),
    expiresAt: Date.now() + maxAgeSeconds * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function verifySessionToken(token) {
  if (!token || !getSecret()) return null;
  const [encoded, signature] = String(token).split(".");
  if (!encoded || !signature || !safeEqual(sign(encoded), signature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload.expiresAt || payload.expiresAt < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
}

function getSessionCookie(req) {
  return parseCookies(req.headers.cookie || "")[cookieName];
}

function getSessionUser(req) {
  return verifySessionToken(getSessionCookie(req));
}

function requireUser(req, res) {
  const user = getSessionUser(req);
  if (!user) {
    res.statusCode = 401;
    res.json({ error: "Unauthorized" });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    res.statusCode = 403;
    res.json({ error: "Forbidden" });
    return null;
  }
  return user;
}

function cookieOptions() {
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `HttpOnly${secure}; SameSite=Lax; Path=/`;
}

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `${cookieName}=${encodeURIComponent(token)}; ${cookieOptions()}; Max-Age=${maxAgeSeconds}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${cookieName}=; ${cookieOptions()}; Max-Age=0`);
}

function getClientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
}

function loginFailureKey(req, username) {
  const ip = getClientIp(req) || "unknown";
  const normalized = String(username || "").trim().toLowerCase() || "empty";
  return `season:login_fail:${ip}:${normalized}`;
}

async function isLoginLimited(req, username) {
  try {
    const count = Number(await kv.get(loginFailureKey(req, username)) || 0);
    return count >= maxLoginFailures;
  } catch (error) {
    if (isKvConfigError(error)) return false;
    throw error;
  }
}

async function recordLoginFailure(req, username) {
  try {
    const key = loginFailureKey(req, username);
    const count = await kv.incr(key);
    await kv.expire(key, loginLimitSeconds);
    return Number(count);
  } catch (error) {
    if (isKvConfigError(error)) return 0;
    throw error;
  }
}

async function clearLoginFailures(req, username) {
  try {
    await kv.del(loginFailureKey(req, username));
  } catch (error) {
    if (!isKvConfigError(error)) throw error;
  }
}

async function logAccess(req, user, action, detail = "") {
  const item = {
    at: new Date().toISOString(),
    username: user?.username || "",
    displayName: user?.displayName || "",
    action,
    detail,
    ip: getClientIp(req),
    userAgent: req.headers["user-agent"] || "",
  };
  try {
    await kv.lpush(logKey, item);
    await kv.ltrim(logKey, 0, maxAccessLogs - 1);
  } catch (error) {
    if (!isKvConfigError(error)) throw error;
    console.warn("Access log skipped because KV is not configured.");
  }
}

async function listAccessLogs() {
  return kv.lrange(logKey, 0, maxAccessLogs - 1);
}

module.exports = {
  authenticate,
  cleanUser,
  clearLoginFailures,
  clearSessionCookie,
  createSessionToken,
  createUser,
  deleteUser,
  getSessionUser,
  listAccessLogs,
  listUsers,
  logAccess,
  isLoginLimited,
  requireAdmin,
  requireUser,
  recordLoginFailure,
  requestUserPasswordReset,
  setSessionCookie,
  updatePassword,
};
