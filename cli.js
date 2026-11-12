#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");

const usage = `Usage: snip <command>

  add <url>    Create a short link for an HTTP(S) URL
  ls           List codes, hit counts, and original URLs
  open <code>  Open a six-character short code in your browser
  help         Show this help

Environment: SNIP_API (default http://localhost:3000)
Requests time out after 10 seconds.
`;

function httpUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
    throw new Error(`${label} must be a valid HTTP(S) URL.`);
  }
  return url;
}

function parseArgs(args) {
  const [command, value, ...extra] = args;
  if (!command || ["help", "--help", "-h"].includes(command)) {
    if (args.length > 1) throw new Error("Help takes no arguments.");
    return { command: "help" };
  }
  if (!["add", "ls", "open"].includes(command)) {
    throw new Error(`Unknown command: ${command}. Run snip help.`);
  }
  if (extra.length || (command === "ls" ? value !== undefined : !value)) {
    throw new Error(`Usage: snip ${command}${command === "ls" ? "" : command === "add" ? " <url>" : " <code>"}`);
  }
  if (command === "add") httpUrl(value.trim(), "URL");
  if (command === "open" && !/^[A-Za-z0-9]{6}$/.test(value)) {
    throw new Error("Code must contain exactly six letters or digits.");
  }
  return { command, value: command === "add" ? value.trim() : value };
}

async function request(base, path, options, fetchImpl, timeoutMs) {
  const { expectedStatus, ...requestOptions } = options;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchImpl(new URL(path, base), {
      ...requestOptions,
      redirect: "manual",
      signal,
    });
    if (response.status !== expectedStatus) {
      const body = await response.text();
      let detail = body.trim();
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.error === "string") detail = parsed.error;
      } catch {
        // Redirect misses can be plain text; preserve the server's error.
      }
      throw new Error(`API returned ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    if (expectedStatus === 302) return response;
    try {
      return await response.json();
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error("API returned invalid JSON.");
    }
  } catch (error) {
    if (signal.aborted) throw new Error(`API request timed out after ${timeoutMs / 1000} seconds.`);
    if (error instanceof TypeError) {
      throw new Error(`Cannot reach API at ${base.origin}: ${error.message}`);
    }
    throw error;
  }
}

function checkLink(link) {
  if (
    !link || typeof link !== "object" ||
    typeof link.code !== "string" || !/^[A-Za-z0-9]{6}$/.test(link.code) ||
    typeof link.url !== "string" || typeof link.shortUrl !== "string" ||
    !Number.isSafeInteger(link.hits) || link.hits < 0 ||
    typeof link.createdAt !== "string" || !Number.isFinite(Date.parse(link.createdAt))
  ) {
    throw new Error("API returned an invalid link record.");
  }
  httpUrl(link.url, "API original URL");
  httpUrl(link.shortUrl, "API short URL");
}

function launchBrowser(target, platform = process.platform, spawnImpl = spawn) {
  const url = httpUrl(target, "Redirect Location").href.replace(/"/g, "%22");
  let executable;
  let args;
  const options = { stdio: "ignore" };
  if (platform === "win32") {
    executable = process.env.ComSpec || "cmd.exe";
    args = ["/d", "/v:off", "/s", "/c", 'start "" "%SNIP_BROWSER_URL%"'];
    options.windowsVerbatimArguments = true;
    // Keep untrusted URL text out of the command itself.
    options.env = { ...process.env, SNIP_BROWSER_URL: url };
  } else if (platform === "darwin") {
    executable = "open";
    args = [url];
  } else if (platform === "linux") {
    executable = "xdg-open";
    args = [url];
  } else {
    throw new Error(`Browser launching is not supported on ${platform}.`);
  }
  return new Promise((resolve, reject) => {
    const child = spawnImpl(executable, args, options);
    child.once("error", (error) => reject(new Error(`Cannot launch browser: ${error.message}`)));
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Browser launcher failed (exit ${code}).`));
    });
  });
}

async function main(args = process.argv.slice(2), dependencies = {}) {
  const {
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
    fetchImpl = globalThis.fetch,
    openBrowser = launchBrowser,
    timeoutMs = 10000,
  } = dependencies;
  try {
    const { command, value } = parseArgs(args);
    if (command === "help") {
      stdout.write(usage);
      return 0;
    }
    const base = httpUrl(env.SNIP_API ?? "http://localhost:3000", "SNIP_API");
    if (base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
      throw new Error("SNIP_API must be an HTTP(S) origin without credentials, path, query, or fragment.");
    }
    if (command === "add") {
      const link = await request(base, "/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value }),
        expectedStatus: 201,
      }, fetchImpl, timeoutMs);
      checkLink(link);
      stdout.write(`${link.shortUrl}\n`);
    } else if (command === "ls") {
      const links = await request(base, "/api/links", { expectedStatus: 200 }, fetchImpl, timeoutMs);
      if (!Array.isArray(links)) throw new Error("API returned an invalid links list.");
      links.forEach(checkLink);
      if (!links.length) {
        stdout.write("No links yet.\n");
      } else {
        const width = Math.max(4, ...links.map((link) => String(link.hits).length));
        stdout.write(`CODE    ${"HITS".padStart(width)}  URL\n`);
        for (const link of links) {
          stdout.write(`${link.code}  ${String(link.hits).padStart(width)}  ${link.url}\n`);
        }
      }
    } else {
      const response = await request(base, `/${value}`, { expectedStatus: 302 }, fetchImpl, timeoutMs);
      const location = response.headers.get("location");
      if (!location) throw new Error("API redirect has no Location header.");
      httpUrl(location, "Redirect Location");
      await openBrowser(location);
    }
    return 0;
  } catch (error) {
    stderr.write(`snip: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}

module.exports = { main, launchBrowser };
