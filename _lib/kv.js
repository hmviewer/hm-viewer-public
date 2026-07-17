const net = require("net");
const tls = require("tls");

async function command(args) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) return restCommand(url, token, args);

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) return redisCommand(redisUrl, args);

  throw new Error("Vercel KV environment variables are not configured");
}

async function restCommand(url, token, args) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || `KV command failed: ${args[0]}`);
  }
  return data.result;
}

function encodeResp(args) {
  return `*${args.length}\r\n${args
    .map((arg) => {
      const value = Buffer.from(String(arg));
      return `$${value.length}\r\n${value.toString()}\r\n`;
    })
    .join("")}`;
}

function parseLine(buffer, offset) {
  const end = buffer.indexOf("\r\n", offset);
  if (end === -1) return null;
  return { line: buffer.slice(offset, end).toString(), next: end + 2 };
}

function parseResp(buffer, offset = 0) {
  if (offset >= buffer.length) return null;

  const type = String.fromCharCode(buffer[offset]);
  if (type === "+" || type === "-" || type === ":") {
    const parsed = parseLine(buffer, offset + 1);
    if (!parsed) return null;
    if (type === "-") throw new Error(parsed.line);
    return {
      value: type === ":" ? Number(parsed.line) : parsed.line,
      next: parsed.next,
    };
  }

  if (type === "$") {
    const parsed = parseLine(buffer, offset + 1);
    if (!parsed) return null;
    const length = Number(parsed.line);
    if (length === -1) return { value: null, next: parsed.next };
    const start = parsed.next;
    const end = start + length;
    if (buffer.length < end + 2) return null;
    return { value: buffer.slice(start, end).toString(), next: end + 2 };
  }

  if (type === "*") {
    const parsed = parseLine(buffer, offset + 1);
    if (!parsed) return null;
    const length = Number(parsed.line);
    if (length === -1) return { value: null, next: parsed.next };

    const values = [];
    let next = parsed.next;
    for (let index = 0; index < length; index += 1) {
      const item = parseResp(buffer, next);
      if (!item) return null;
      values.push(item.value);
      next = item.next;
    }
    return { value: values, next };
  }

  throw new Error("Unsupported Redis response");
}

function redisCommand(redisUrl, args) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(redisUrl);
    const isTls = parsedUrl.protocol === "rediss:";
    const port = Number(parsedUrl.port || (isTls ? 6380 : 6379));
    const socket = isTls
      ? tls.connect({ host: parsedUrl.hostname, port, servername: parsedUrl.hostname })
      : net.connect({ host: parsedUrl.hostname, port });

    const commands = [];
    if (parsedUrl.password) {
      const password = decodeURIComponent(parsedUrl.password);
      const username = parsedUrl.username ? decodeURIComponent(parsedUrl.username) : "";
      commands.push(username ? ["AUTH", username, password] : ["AUTH", password]);
    }
    commands.push(args);

    let buffer = Buffer.alloc(0);
    let commandIndex = 0;
    let settled = false;

    function cleanup() {
      socket.removeAllListeners();
      socket.end();
      socket.destroy();
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function writeNext() {
      socket.write(encodeResp(commands[commandIndex]));
    }

    socket.on("connect", writeNext);
    socket.on("error", fail);
    socket.on("timeout", () => fail(new Error("Redis command timed out")));
    socket.setTimeout(10000);
    socket.on("data", (chunk) => {
      try {
        buffer = Buffer.concat([buffer, chunk]);
        const parsed = parseResp(buffer);
        if (!parsed) return;

        buffer = buffer.slice(parsed.next);
        commandIndex += 1;
        if (commandIndex < commands.length) {
          writeNext();
          return;
        }

        if (settled) return;
        settled = true;
        cleanup();
        resolve(parsed.value);
      } catch (error) {
        fail(error);
      }
    });
  });
}

function encode(value) {
  return JSON.stringify(value);
}

function decode(value) {
  if (value == null) return null;
  return typeof value === "string" ? JSON.parse(value) : value;
}

module.exports = {
  async get(key) {
    return decode(await command(["GET", key]));
  },
  async set(key, value) {
    return command(["SET", key, encode(value)]);
  },
  async del(key) {
    return command(["DEL", key]);
  },
  async incr(key) {
    return command(["INCR", key]);
  },
  async expire(key, seconds) {
    return command(["EXPIRE", key, seconds]);
  },
  async sadd(key, value) {
    return command(["SADD", key, value]);
  },
  async srem(key, value) {
    return command(["SREM", key, value]);
  },
  async smembers(key) {
    return command(["SMEMBERS", key]);
  },
  async lpush(key, value) {
    return command(["LPUSH", key, encode(value)]);
  },
  async ltrim(key, start, stop) {
    return command(["LTRIM", key, start, stop]);
  },
  async lrange(key, start, stop) {
    const values = await command(["LRANGE", key, start, stop]);
    return (values || []).map(decode);
  },
};
