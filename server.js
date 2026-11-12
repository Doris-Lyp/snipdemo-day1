const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const links = new Map();
const codeAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

function getBaseUrl() {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const configuredUrl =
    process.env.BASE_URL ||
    (railwayDomain
      ? `https://${railwayDomain.replace(/^https?:\/\//i, "")}`
      : `http://localhost:${port}`);

  let url;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("BASE_URL or RAILWAY_PUBLIC_DOMAIN must be a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("BASE_URL must use HTTP or HTTPS.");
  }

  return url.origin;
}

const baseUrl = getBaseUrl();
const publicDirectory = process.env.PUBLIC_DIR
  ? path.resolve(process.cwd(), process.env.PUBLIC_DIR)
  : null;

if (publicDirectory && !fs.statSync(publicDirectory).isDirectory()) {
  throw new Error("PUBLIC_DIR must point to a directory.");
}

const publicRoot = publicDirectory ? fs.realpathSync(publicDirectory) : null;

function corsHeaders(extraHeaders = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extraHeaders,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

function createCode() {
  let code = "";
  while (code.length < 6) {
    for (const byte of randomBytes(16)) {
      if (byte < 248) code += codeAlphabet[byte % codeAlphabet.length];
      if (code.length === 6) break;
    }
  }
  return code;
}

function createUniqueCode() {
  let code;
  do {
    code = createCode();
  } while (links.has(code));
  return code;
}

function findPublicFile(requestPath) {
  if (!publicRoot) return null;

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const relativePath =
    decodedPath === "/" ? "index.html" : `.${decodedPath}`;
  const candidatePath = path.resolve(publicRoot, relativePath);

  let realPath;
  try {
    realPath = fs.realpathSync(candidatePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }

  const relativeToRoot = path.relative(publicRoot, realPath);
  if (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    return null;
  }

  return fs.statSync(realPath).isFile() ? realPath : null;
}

Bun.serve({
  hostname: "0.0.0.0",
  port,
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const requestPath = requestUrl.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (requestPath === "/api/links") {
      if (request.method === "GET") {
        return jsonResponse(Array.from(links.values()));
      }

      if (request.method === "POST") {
        let body;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: "Request body must be valid JSON." }, 400);
        }

        if (!body || typeof body.url !== "string") {
          return jsonResponse({ error: "A URL is required." }, 400);
        }

        const originalUrl = body.url.trim();
        let parsedUrl;
        try {
          parsedUrl = new URL(originalUrl);
        } catch {
          return jsonResponse({ error: "URL must be a valid HTTP or HTTPS URL." }, 400);
        }

        if (
          (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
          !parsedUrl.hostname
        ) {
          return jsonResponse({ error: "URL must be a valid HTTP or HTTPS URL." }, 400);
        }

        const code = createUniqueCode();
        const link = {
          code,
          url: originalUrl,
          shortUrl: `${baseUrl}/${code}`,
          hits: 0,
          createdAt: new Date().toISOString(),
        };
        links.set(link.code, link);
        return jsonResponse(link, 201);
      }

      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    if (request.method === "GET") {
      const publicFile = findPublicFile(requestPath);
      if (publicFile) {
        const file = Bun.file(publicFile);
        return new Response(file, {
          headers: corsHeaders({
            "Content-Type": file.type || "application/octet-stream",
          }),
        });
      }

      const match = /^\/([0-9A-Za-z]{6})$/.exec(requestPath);
      if (match) {
        const link = links.get(match[1]);
        if (!link) return new Response("Not found", { status: 404, headers: corsHeaders() });

        link.hits += 1;
        return new Response(null, {
          status: 302,
          headers: corsHeaders({ Location: link.url }),
        });
      }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders() });
  },
});

console.log(`Snip backend listening on port ${port}`);
