import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import jwt from "jsonwebtoken";
import sql from "mssql";
import crypto from "node:crypto";
import fs from "node:fs";

dotenv.config();

const app = express();

const port = Number(process.env.PORT || 3001);
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const jwtSecret = process.env.JWT_SECRET || "linkonx-tools-web-dev-secret";
const authCookieName = "linkonx_qd_session";
const mssqlConnectionString =
  process.env.MSSQL_CONNECTION_STRING ||
  "Data Source=192.168.0.111,1433;Initial Catalog=LINKON;User ID=linkon;Password=p@ssw0rd!2;Encrypt=False;TrustServerCertificate=True";
const qmfTable = process.env.QMF_TABLE || "dbo.LinkOnX_QueryDeveloperQmf";
const authUserTable = process.env.AUTH_USER_TABLE || "dbo.QSECUSRDEF";
const securityKey = loadSecurityKey();
const isProduction = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
const loginRateLimitEnabled = isProduction
  ? parseBoolean(process.env.LOGIN_RATE_LIMIT_ENABLED, true)
  : false;
const parsedQmfTable = parseSchemaTable(qmfTable);
const parsedAuthUserTable = parseSchemaTable(authUserTable);

let dbPool = null;

app.use(
  cors({
    origin: clientOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: "8mb" }));
app.use(cookieParser());

const loginLimiter = new Map();

app.get("/api/health", async (_req, res) => {
  const pool = await getDbPool();
  await pool.request().query("SELECT 1 AS ok");
  res.json({
    ok: true,
    service: "linkonx-tools-web-api",
    db: "mssql",
    pid: process.pid,
    env: isProduction ? "production" : "debug",
    loginRateLimitEnabled,
  });
});

app.post("/api/auth/login", async (req, res) => {
  const loginId = String(req.body?.id ?? req.body?.username ?? "").trim();
  const password = String(req.body?.password || "");
  const factory = String(req.body?.factory ?? "").trim();
  const key = `${req.ip || "unknown"}:${factory.toUpperCase()}:${loginId.toLowerCase()}`;
  const attempt = loginLimiter.get(key);

  if (!factory || !loginId || !password) {
    return res.status(400).json({ message: "Factory, ID and password are required." });
  }

  if (
    loginRateLimitEnabled &&
    attempt &&
    attempt.count >= 5 &&
    Date.now() - attempt.updatedAt < 5 * 60 * 1000
  ) {
    return res.status(429).json({ message: "Too many login attempts. Try again later." });
  }

  const pool = await getDbPool();
  const userQuery = `
SELECT TOP (1)
  FACTORY,
  USER_ID,
  USER_NAME,
  PASSWORD,
  DELETE_FLAG,
  EXPIRE_DATE
FROM ${quotedAuthUserTable()}
WHERE LTRIM(RTRIM(USER_ID)) = @userId
  AND LTRIM(RTRIM(FACTORY)) = @factory
  AND ISNULL(NULLIF(LTRIM(RTRIM(DELETE_FLAG)), N''), N'N') NOT IN (N'Y', N'1')
`;
  const result = await pool
    .request()
    .input("userId", sql.NVarChar(20), loginId)
    .input("factory", sql.NVarChar(10), factory)
    .query(userQuery);

  if (!result.recordset?.length) {
    if (loginRateLimitEnabled) {
      loginLimiter.set(key, {
        count: attempt ? attempt.count + 1 : 1,
        updatedAt: Date.now(),
      });
    }
    return res.status(401).json({ message: "Invalid username or password." });
  }

  const account = result.recordset[0];
  if (isExpiredAccount(account.EXPIRE_DATE)) {
    return res.status(403).json({ message: "Account expired. Contact administrator." });
  }

  const encryptedInput = encryptLegacyPassword(password, securityKey);
  const dbPassword = String(account.PASSWORD || "").trim();
  const isMatched =
    constantTimeEquals(dbPassword, encryptedInput) || constantTimeEquals(dbPassword, password);

  if (!isMatched) {
    if (loginRateLimitEnabled) {
      loginLimiter.set(key, {
        count: attempt ? attempt.count + 1 : 1,
        updatedAt: Date.now(),
      });
    }
    return res.status(401).json({ message: "Invalid username or password." });
  }

  loginLimiter.delete(key);

  const userFactory = String(account.FACTORY || "").trim();
  const userId = String(account.USER_ID || loginId).trim();
  const userName = String(account.USER_NAME || userId).trim();

  const token = jwt.sign(
    {
      sub: userId,
      factory: userFactory,
      userName,
      role: "query-developer",
    },
    jwtSecret,
    { expiresIn: "8h" },
  );

  res.cookie(authCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 8 * 60 * 60 * 1000,
  });

  return res.json({
    id: userId,
    username: userId,
    userName,
    factory: userFactory,
    role: "query-developer",
  });
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(authCookieName);
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({
    id: req.user.sub,
    username: req.user.sub,
    userName: req.user.userName || req.user.sub,
    factory: req.user.factory || "",
    role: req.user.role,
  });
});

app.get("/api/qmf/files", requireAuth, async (_req, res) => {
  const pool = await getDbPool();
  const query = `
SELECT
  FileName AS name,
  DATALENGTH(CONVERT(varbinary(max), Content)) AS size,
  UpdatedAt AS modifiedAt
FROM ${quotedTable()}
ORDER BY FileName ASC
`;
  const result = await pool.request().query(query);
  const files = (result.recordset || []).map((row) => ({
    name: row.name,
    size: Number(row.size || 0),
    modifiedAt: row.modifiedAt ? new Date(row.modifiedAt).toISOString() : null,
  }));
  res.json({ files });
});

app.get("/api/qmf/file", requireAuth, async (req, res) => {
  const fileName = safeQmfFileName(req.query.name);
  if (!fileName) {
    return res.status(400).json({ message: "Invalid qmf file name." });
  }

  const pool = await getDbPool();
  const query = `
SELECT
  FileName AS name,
  Content AS content
FROM ${quotedTable()}
WHERE FileName = @fileName
`;
  const result = await pool.request().input("fileName", sql.NVarChar(255), fileName).query(query);
  if (!result.recordset?.length) {
    return res.status(404).json({ message: "qmf file not found." });
  }
  return res.json(result.recordset[0]);
});

app.put("/api/qmf/file", requireAuth, async (req, res) => {
  const fileName = safeQmfFileName(req.query.name);
  const content = String(req.body?.content || "");

  if (!fileName) {
    return res.status(400).json({ message: "Invalid qmf file name." });
  }
  if (!content.trim()) {
    return res.status(400).json({ message: "qmf content is empty." });
  }

  const pool = await getDbPool();
  const upsert = `
IF EXISTS (SELECT 1 FROM ${quotedTable()} WHERE FileName = @fileName)
BEGIN
  UPDATE ${quotedTable()}
     SET Content = @content,
         UpdatedAt = SYSUTCDATETIME(),
         UpdatedBy = @updatedBy
   WHERE FileName = @fileName
END
ELSE
BEGIN
  INSERT INTO ${quotedTable()} (FileName, Content, UpdatedBy, UpdatedAt)
  VALUES (@fileName, @content, @updatedBy, SYSUTCDATETIME())
END
`;
  await pool
    .request()
    .input("fileName", sql.NVarChar(255), fileName)
    .input("content", sql.NVarChar(sql.MAX), content)
    .input("updatedBy", sql.NVarChar(100), req.user.sub || "unknown")
    .query(upsert);

  const selected = await pool
    .request()
    .input("fileName", sql.NVarChar(255), fileName)
    .query(
      `SELECT FileName, DATALENGTH(CONVERT(varbinary(max), Content)) AS Size, UpdatedAt FROM ${quotedTable()} WHERE FileName = @fileName`,
    );
  const row = selected.recordset?.[0];

  return res.json({
    ok: true,
    name: fileName,
    size: Number(row?.Size || 0),
    modifiedAt: row?.UpdatedAt ? new Date(row.UpdatedAt).toISOString() : null,
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: "Internal server error." });
});

await ensureDbReady();
await ensureSeedQmfFile();

app.listen(port, () => {
  console.log(`[LinkOnX.Tools.Web API] listening on http://localhost:${port}`);
  console.log(`[LinkOnX.Tools.Web API] mssql table: ${quotedTable()}`);
  console.log(`[LinkOnX.Tools.Web API] auth table: ${quotedAuthUserTable()}`);
});

function requireAuth(req, res, next) {
  const token = req.cookies?.[authCookieName];
  if (!token) {
    return res.status(401).json({ message: "Authentication required." });
  }

  try {
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid session." });
  }
}

async function getDbPool() {
  if (dbPool?.connected) return dbPool;
  if (dbPool && !dbPool.connected) {
    try {
      await dbPool.close();
    } catch {
      // ignore cleanup errors
    }
  }
  dbPool = await new sql.ConnectionPool(buildMssqlConfig(mssqlConnectionString)).connect();
  return dbPool;
}

async function ensureDbReady() {
  const pool = await getDbPool();
  const ddl = `
IF NOT EXISTS (
  SELECT 1
  FROM sys.tables t
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  WHERE s.name = @schemaName
    AND t.name = @tableName
)
BEGIN
  DECLARE @sql nvarchar(max) =
    N'CREATE TABLE ' + QUOTENAME(@schemaName) + N'.' + QUOTENAME(@tableName) + N'(
      [FileName] nvarchar(255) NOT NULL PRIMARY KEY,
      [Content] nvarchar(max) NOT NULL,
      [UpdatedBy] nvarchar(100) NOT NULL,
      [UpdatedAt] datetime2(0) NOT NULL CONSTRAINT ' + QUOTENAME('DF_' + @tableName + '_UpdatedAt') + N' DEFAULT SYSUTCDATETIME()
    )';
  EXEC sp_executesql @sql;
END
`;
  await pool
    .request()
    .input("schemaName", sql.NVarChar(128), parsedQmfTable.schema)
    .input("tableName", sql.NVarChar(128), parsedQmfTable.table)
    .query(ddl);
}

async function ensureSeedQmfFile() {
  const pool = await getDbPool();
  const seedFileName = "Sample.QueryDeveloper.qmf";
  const seedContent = `<?xml version="1.0"?>
<Q QF="QMF" QV="1.0.0.0" QD="LinkOn QueryDeveloper File">
  <QueryDeveloper>
    <System Name="MES" Provider="Oracle">
      <Module Name="OrderModule">
        <Function Name="GetOrderList" Description="Order lookup">
          <SqlGroup Name="SelectOrders" IsProcedure="false"><![CDATA[
SELECT ORDER_ID, ORDER_NO, STATUS
FROM TB_ORDER
WHERE STATUS = :STATUS
ORDER BY ORDER_ID DESC
          ]]></SqlGroup>
        </Function>
      </Module>
    </System>
  </QueryDeveloper>
</Q>
`;
  const seedQuery = `
IF NOT EXISTS (SELECT 1 FROM ${quotedTable()} WHERE FileName = @fileName)
BEGIN
  INSERT INTO ${quotedTable()} (FileName, Content, UpdatedBy, UpdatedAt)
  VALUES (@fileName, @content, N'system', SYSUTCDATETIME())
END
`;
  await pool
    .request()
    .input("fileName", sql.NVarChar(255), seedFileName)
    .input("content", sql.NVarChar(sql.MAX), seedContent)
    .query(seedQuery);
}

function safeQmfFileName(rawName) {
  const fileName = String(rawName || "").trim();
  if (!fileName) return null;
  if (!/^[a-zA-Z0-9._-]+\.qmf$/i.test(fileName)) return null;
  return fileName;
}

function parseSchemaTable(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return { schema: "dbo", table: "LinkOnX_QueryDeveloperQmf" };
  }
  const split = normalized.split(".");
  const namePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (split.length === 1) {
    if (!namePattern.test(split[0])) {
      throw new Error(`Invalid table name: ${normalized}`);
    }
    return { schema: "dbo", table: split[0] };
  }
  if (split.length !== 2 || !namePattern.test(split[0]) || !namePattern.test(split[1])) {
    throw new Error(`Invalid schema.table name: ${normalized}`);
  }
  return {
    schema: split[0],
    table: split[1],
  };
}

function quotedTable() {
  return `[${parsedQmfTable.schema}].[${parsedQmfTable.table}]`;
}

function quotedAuthUserTable() {
  return `[${parsedAuthUserTable.schema}].[${parsedAuthUserTable.table}]`;
}

function buildMssqlConfig(connectionString) {
  const entries = parseConnectionString(connectionString);
  const dataSource = pickFirst(entries, ["data source", "server", "address", "addr", "network address"]);
  const database = pickFirst(entries, ["initial catalog", "database"]);
  const user = pickFirst(entries, ["user id", "uid", "user"]);
  const password = pickFirst(entries, ["password", "pwd"]);

  const hostPort = parseHostAndPort(dataSource);
  if (!hostPort.server) {
    throw new Error("Invalid MSSQL connection string: server/data source is missing.");
  }

  return {
    server: hostPort.server,
    port: hostPort.port,
    database,
    user,
    password,
    options: {
      encrypt: parseBoolean(pickFirst(entries, ["encrypt"]), false),
      trustServerCertificate: parseBoolean(pickFirst(entries, ["trustservercertificate"]), true),
      enableArithAbort: true,
    },
    pool: {
      min: 0,
      max: 10,
      idleTimeoutMillis: 30000,
    },
  };
}

function parseConnectionString(raw) {
  const map = new Map();
  String(raw || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const index = part.indexOf("=");
      if (index <= 0) return;
      const key = part.slice(0, index).trim().toLowerCase();
      const value = part.slice(index + 1).trim();
      map.set(key, value);
    });
  return map;
}

function pickFirst(entries, keys) {
  for (const key of keys) {
    if (entries.has(key)) return entries.get(key);
  }
  return undefined;
}

function parseHostAndPort(dataSource) {
  const source = String(dataSource || "").trim();
  if (!source) return { server: "", port: 1433 };

  if (source.startsWith("tcp:")) {
    return parseHostAndPort(source.slice(4));
  }

  if (source.includes(",")) {
    const [server, portRaw] = source.split(",");
    return {
      server: server.trim(),
      port: Number(portRaw || 1433) || 1433,
    };
  }

  if (source.includes(":")) {
    const [server, portRaw] = source.split(":");
    return {
      server: server.trim(),
      port: Number(portRaw || 1433) || 1433,
    };
  }

  return { server: source, port: 1433 };
}

function parseBoolean(value, fallback) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function encryptLegacyPassword(text, key) {
  const plainText = String(text || "");
  const passwordKey = String(key || "");
  const salt = Buffer.from(String(passwordKey.length), "ascii");
  const deriver = createPasswordDeriveBytes(passwordKey, salt, "sha1", 100);
  const secretKey = deriver.getBytes(32);
  const iv = deriver.getBytes(16);

  const cipher = crypto.createCipheriv("aes-256-cbc", secretKey, iv);
  cipher.setAutoPadding(true);
  const cryptorBytes = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return cryptorBytes.toString("base64");
}

function createPasswordDeriveBytes(password, salt, hashName, iterations) {
  const passwordBytes = Buffer.from(String(password || ""), "utf8");
  const saltBytes = salt ? Buffer.from(salt) : null;
  const hashAlgorithm = String(hashName || "sha1").toLowerCase();
  let prefix = 0;
  let extra = null;
  let extraCount = 0;
  let baseValue = null;

  return {
    getBytes(cb) {
      let ib = 0;
      const output = Buffer.alloc(cb);

      if (!baseValue) {
        baseValue = computeBaseValue(passwordBytes, saltBytes, hashAlgorithm, iterations);
      } else if (extra) {
        ib = extra.length - extraCount;
        if (ib >= cb) {
          extra.copy(output, 0, extraCount, extraCount + cb);
          if (ib > cb) extraCount += cb;
          else extra = null;
          return output;
        }

        // Preserve .NET Framework behavior, including the historical offset bug.
        extra.copy(output, 0, ib, ib + ib);
        extra = null;
      }

      const computed = computeBytes(baseValue, cb - ib, hashAlgorithm, () => {
        const bytes = buildHashPrefix(prefix);
        prefix += 1;
        return bytes;
      });
      computed.copy(output, ib, 0, cb - ib);
      if (computed.length + ib > cb) {
        extra = computed;
        extraCount = cb - ib;
      }
      return output;
    },
  };
}

function computeBaseValue(passwordBytes, saltBytes, hashName, iterations) {
  let value = hashBuffer(hashName, [passwordBytes, saltBytes || Buffer.alloc(0)]);
  for (let i = 1; i < iterations - 1; i += 1) {
    value = hashBuffer(hashName, [value]);
  }
  return value;
}

function computeBytes(baseValue, cb, hashName, nextPrefixBytes) {
  const hashSize = hashBuffer(hashName, [Buffer.alloc(0)]).length;
  const totalLength = Math.ceil(cb / hashSize) * hashSize;
  const result = Buffer.alloc(totalLength);
  let ib = 0;
  while (ib < cb) {
    const prefix = nextPrefixBytes();
    const hash = hashBuffer(hashName, [prefix, baseValue]);
    hash.copy(result, ib, 0, hashSize);
    ib += hashSize;
  }
  return result;
}

function buildHashPrefix(prefix) {
  if (prefix <= 0) return Buffer.alloc(0);
  if (prefix > 999) {
    throw new Error("PasswordDeriveBytes_TooManyBytes");
  }
  return Buffer.from(String(prefix), "ascii");
}

function hashBuffer(hashName, buffers) {
  const hash = crypto.createHash(hashName);
  for (const part of buffers) {
    if (!part || part.length === 0) continue;
    hash.update(part);
  }
  return hash.digest();
}

function isExpiredAccount(expireDateRaw) {
  const raw = String(expireDateRaw || "").trim();
  if (!raw) return false;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return false;

  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const hour = digits.length >= 10 ? Number(digits.slice(8, 10)) : 23;
  const minute = digits.length >= 12 ? Number(digits.slice(10, 12)) : 59;
  const second = digits.length >= 14 ? Number(digits.slice(12, 14)) : 59;
  const milli = digits.length >= 17 ? Number(digits.slice(14, 17)) : 999;
  if ([year, month, day, hour, minute, second, milli].some((value) => Number.isNaN(value))) {
    return false;
  }

  const expiresAt = new Date(year, month - 1, day, hour, minute, second, milli);
  if (Number.isNaN(expiresAt.getTime())) return false;
  return Date.now() > expiresAt.getTime();
}

function constantTimeEquals(left, right) {
  const leftText = String(left || "");
  const rightText = String(right || "");
  const leftBytes = Buffer.from(leftText, "utf8");
  const rightBytes = Buffer.from(rightText, "utf8");
  if (leftBytes.length !== rightBytes.length) return false;
  return crypto.timingSafeEqual(leftBytes, rightBytes);
}

function loadSecurityKey() {
  const fromEnv = String(process.env.SECURITY_KEY || "").trim();
  if (fromEnv) return fromEnv;

  const keyFile = String(process.env.SECURITY_KEY_FILE || "").trim();
  if (keyFile) {
    try {
      const raw = fs.readFileSync(keyFile, "utf8");
      const loaded = String(raw || "").trim();
      if (loaded) return loaded;
    } catch (error) {
      throw new Error(`SECURITY_KEY_FILE read failed: ${error.message}`);
    }
  }

  throw new Error("Missing security key. Set SECURITY_KEY or SECURITY_KEY_FILE.");
}
