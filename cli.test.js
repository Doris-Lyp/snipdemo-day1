"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const http = require("node:http");
const { once, EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { main, launchBrowser } = require("./cli.js");

const link = {
  code: "Ab12Cd",
  url: "https://example.com/a?x=1&y=2",
  shortUrl: "http://localhost:3000/Ab12Cd",
  hits: 0,
  createdAt: "2026-11-12T08:00:00.000Z",
};

async function mockApi(handler, action) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await action(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function invoke(args, options = {}) {
  let out = "";
  let err = "";
  const code = await main(args, {
    env: {},
    stdout: { write: (text) => { out += text; } },
    stderr: { write: (text) => { err += text; } },
    ...options,
  });
  return { code, out, err };
}

function run(executable, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: __dirname,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (data) => { out += data; });
    child.stderr.on("data", (data) => { err += data; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, out, err }));
  });
}

test("help is offline; argument and API-origin failures never send requests", async () => {
  const options = { fetchImpl: () => { throw new Error("Unexpected request"); } };
  for (const args of [[], ["help"], ["--help"], ["-h"]]) {
    const result = await invoke(args, { ...options, env: { SNIP_API: "bad" } });
    assert.equal(result.code, 0);
    assert.match(result.out, /Usage: snip/);
    assert.equal(result.err, "");
  }
  for (const args of [
    ["unknown"], ["help", "extra"], ["add"], ["add", "ftp://example.com"],
    ["add", "invalid"], ["add", "https://example.com", "extra"],
    ["ls", "extra"], ["open"], ["open", "../bad"], ["open", "abcde"],
  ]) {
    const result = await invoke(args, options);
    assert.equal(result.code, 1, JSON.stringify(args));
    assert.equal(result.out, "");
    assert.match(result.err, /^snip: /);
  }
  for (const base of ["", "invalid", "file:///tmp", "http://user:pass@example.com", "https://example.com/api"]) {
    const result = await invoke(["ls"], { ...options, env: { SNIP_API: base } });
    assert.equal(result.code, 1);
    assert.match(result.err, /SNIP_API/);
  }
});

test("add sends trimmed JSON and prints only the returned short URL", async () => {
  await mockApi(async (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/api/links");
    assert.equal(req.headers["content-type"], "application/json");
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { url: link.url });
    res.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify(link));
  }, async (base) => {
    const result = await run(process.execPath, ["cli.js", "add", `  ${link.url}  `], { SNIP_API: base });
    assert.deepEqual(result, { code: 0, out: `${link.shortUrl}\n`, err: "" });
  });
});

test("ls handles empty and populated tables with wide hit counts", async () => {
  let links = [];
  await mockApi((req, res) => {
    assert.equal(req.url, "/api/links");
    res.end(JSON.stringify(links));
  }, async (base) => {
    const options = { env: { SNIP_API: base } };
    assert.deepEqual(await invoke(["ls"], options), { code: 0, out: "No links yet.\n", err: "" });
    links = [link, { ...link, code: "Zz1234", hits: 123456 }];
    const result = await invoke(["ls"], options);
    assert.equal(result.code, 0);
    assert.equal(result.out, `CODE      HITS  URL\nAb12Cd       0  ${link.url}\nZz1234  123456  ${link.url}\n`);
  });
});

test("open asks once without following redirect and launches Location", async () => {
  let requests = 0;
  const opened = [];
  await mockApi((req, res) => {
    requests++;
    assert.equal(req.url, `/${link.code}`);
    res.writeHead(302, { Location: link.url }).end();
  }, async (base) => {
    const result = await invoke(["open", link.code], {
      env: { SNIP_API: base },
      openBrowser: async (target) => { opened.push(target); },
    });
    assert.deepEqual(result, { code: 0, out: "", err: "" });
  });
  assert.equal(requests, 1);
  assert.deepEqual(opened, [link.url]);
});

test("API errors, malformed replies, and unsafe redirects fail on stderr", async () => {
  const cases = [
    { args: ["ls"], status: 500, body: '{"error":"Database unavailable"}', error: /500: Database unavailable/ },
    { args: ["open", link.code], status: 404, body: "Not found", error: /404: Not found/ },
    { args: ["ls"], status: 200, body: "not json", error: /invalid JSON/ },
    { args: ["ls"], status: 200, body: "{}", error: /invalid links list/ },
    { args: ["ls"], status: 200, body: '[{"code":"bad"}]', error: /invalid link record/ },
    { args: ["add", link.url], status: 200, body: JSON.stringify(link), error: /API returned 200/ },
    { args: ["open", link.code], status: 302, body: "", error: /no Location/ },
    { args: ["open", link.code], status: 302, body: "", location: "file:///tmp/test", error: /HTTP\(S\)/ },
  ];
  for (const item of cases) {
    await mockApi((req, res) => {
      res.writeHead(item.status, item.location ? { Location: item.location } : {}).end(item.body);
    }, async (base) => {
      const result = await invoke(item.args, {
        env: { SNIP_API: base },
        openBrowser: () => { assert.fail("Must not launch browser"); },
      });
      assert.equal(result.code, 1);
      assert.equal(result.out, "");
      assert.match(result.err, item.error);
    });
  }
});

test("dead backend and request/body timeouts return exit 1", async () => {
  let deadBase;
  await mockApi((req, res) => res.end("[]"), async (base) => { deadBase = base; });
  const dead = await run(process.execPath, ["cli.js", "ls"], { SNIP_API: deadBase });
  assert.equal(dead.code, 1);
  assert.equal(dead.out, "");
  assert.match(dead.err, /Cannot reach API/);
  for (const flush of [false, true]) {
    await mockApi((req, res) => {
      if (flush) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write("[");
      }
    }, async (base) => {
      const result = await invoke(["ls"], { env: { SNIP_API: base }, timeoutMs: 40 });
      assert.equal(result.code, 1);
      assert.match(result.err, /timed out/);
    });
  }
});

test("platform launchers pass URL as data and expose launch failures", async () => {
  const target = 'https://example.com/?x=1&y=%PATH%!"quoted"';
  for (const platform of ["win32", "darwin", "linux"]) {
    let called = false;
    await launchBrowser(target, platform, (file, args, options) => {
      called = true;
      assert.equal(options.stdio, "ignore");
      if (platform === "win32") {
        assert.match(file, /cmd\.exe$/i);
        assert.deepEqual(args, ["/d", "/v:off", "/s", "/c", 'start "" "%SNIP_BROWSER_URL%"']);
        assert.equal(options.env.SNIP_BROWSER_URL, new URL(target).href.replace(/"/g, "%22"));
        assert.equal(options.windowsVerbatimArguments, true);
      } else {
        assert.equal(file, platform === "darwin" ? "open" : "xdg-open");
        assert.deepEqual(args, [new URL(target).href]);
        assert.equal(options.shell, undefined);
      }
      const child = new EventEmitter();
      process.nextTick(() => child.emit("close", 0));
      return child;
    });
    assert.ok(called);
  }
  for (const event of ["error", "close"]) {
    await assert.rejects(launchBrowser(link.url, "linux", () => {
      const child = new EventEmitter();
      process.nextTick(() => child.emit(event, event === "error" ? new Error("missing launcher") : 2));
      return child;
    }), /browser|Browser/);
  }
  assert.throws(() => launchBrowser(link.url, "unsupported"), /not supported/);
  const failure = await invoke(["open", link.code], {
    fetchImpl: async () => new Response(null, { status: 302, headers: { Location: link.url } }),
    openBrowser: async () => { throw new Error("Browser launch failed"); },
  });
  assert.equal(failure.code, 1);
  assert.match(failure.err, /Browser launch failed/);
});

test("shell wrappers forward arguments and preserve failure exit codes", async () => {
  const wrappers = process.platform === "win32"
    ? [
      [process.env.ComSpec || "cmd.exe", ["/d", "/c", ".\\snip.cmd"]],
      ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "snip.ps1")]],
    ]
    : [["sh", [path.join(__dirname, "snip")]]];
  for (const [file, args] of wrappers) {
    const help = await run(file, [...args, "help"]);
    assert.equal(help.code, 0, help.err);
    assert.match(help.out, /Usage: snip/);
    const invalid = await run(file, [...args, "open", "bad"]);
    assert.equal(invalid.code, 1);
    assert.equal(invalid.out, "");
    assert.match(invalid.err, /six letters or digits/);
    await mockApi(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      assert.deepEqual(JSON.parse(body), { url: "https://example.com/a" });
      res.writeHead(201).end(JSON.stringify(link));
    }, async (base) => {
      const added = await run(file, [...args, "add", "https://example.com/a"], { SNIP_API: base });
      assert.deepEqual(added, { code: 0, out: `${link.shortUrl}\n`, err: "" });
    });
  }
});
