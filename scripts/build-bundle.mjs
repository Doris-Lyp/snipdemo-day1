import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleDir = path.join(root, "bundle");
const frontendDir = path.join(root, "frontend");
const frontendBuildDir = path.join(
  frontendDir,
  "dist",
  "snip-frontend",
  "browser",
);
const push = process.argv.slice(2).includes("--push");

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}.`);
  }
}

function git(args, cwd = root, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed with ${result.status}.`);
  }
  return result.stdout?.trim() ?? "";
}

function isDirty(cwd) {
  return git(["status", "--porcelain", "--untracked-files=all"], cwd, {
    capture: true,
  }).length > 0;
}

function hasStagedChanges(cwd) {
  const result = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new Error(`git diff --cached --quiet failed with ${result.status}.`);
}

function commitIfChanged(cwd, message) {
  git(["add", "-A"], cwd);
  if (!hasStagedChanges(cwd)) {
    console.log(`No changes to commit in ${path.relative(root, cwd)}.`);
    return false;
  }
  git(
    [
      "-c",
      "user.name=github-actions[bot]",
      "-c",
      "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "commit",
      "-m",
      message,
      "--trailer",
      "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
      "--trailer",
      "Co-authored-by: OpenBot <335604065+openbotgit[bot]@users.noreply.github.com>",
    ],
    cwd,
  );
  return true;
}

if (process.argv.slice(2).some((arg) => arg !== "--push")) {
  throw new Error("Usage: node scripts/build-bundle.mjs [--push]");
}

if (git(["branch", "--show-current"], root, { capture: true }) !== "main") {
  throw new Error("Run this script from the main branch checkout.");
}
if (isDirty(root)) {
  throw new Error("The main checkout has uncommitted changes; commit or clean them first.");
}
if (!fs.existsSync(bundleDir)) {
  throw new Error("The bundle submodule is missing; initialize it before building.");
}
if (isDirty(bundleDir)) {
  throw new Error("The bundle checkout has local changes; preserve them and retry after cleaning it.");
}

run("git", ["submodule", "update", "--init", "--remote", "backend", "frontend", "cli"]);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(npm, ["install"], frontendDir);
run(npm, ["run", "build"], frontendDir);
if (!fs.existsSync(path.join(frontendBuildDir, "index.html"))) {
  throw new Error(`Angular build output is missing: ${path.join(frontendBuildDir, "index.html")}`);
}

const publicDir = path.join(bundleDir, "public");
fs.rmSync(publicDir, { recursive: true, force: true });
fs.mkdirSync(publicDir, { recursive: true });
fs.cpSync(frontendBuildDir, publicDir, { recursive: true });
fs.copyFileSync(path.join(root, "backend", "server.js"), path.join(bundleDir, "server.js"));
fs.copyFileSync(path.join(root, "cli", "cli.js"), path.join(bundleDir, "cli.js"));
fs.writeFileSync(path.join(bundleDir, ".env"), "PUBLIC_DIR=./public\n");
fs.writeFileSync(
  path.join(bundleDir, "package.json"),
  `${JSON.stringify({ name: "snip-bundle", private: true, scripts: { start: "bun server.js" } }, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(bundleDir, "Dockerfile"),
  [
    "FROM oven/bun:1-alpine",
    "WORKDIR /app",
    "COPY . .",
    "ENV PORT=3000",
    "EXPOSE 3000",
    "CMD [\"bun\", \"server.js\"]",
    "",
  ].join("\n"),
);
fs.writeFileSync(
  path.join(bundleDir, ".dockerignore"),
  [".git", ".gitmodules", "node_modules", "*.log", ""].join("\n"),
);
fs.writeFileSync(
  path.join(bundleDir, "railway.json"),
  `${JSON.stringify({ build: { builder: "DOCKERFILE" } }, null, 2)}\n`,
);

commitIfChanged(bundleDir, "Build generated Snip bundle");
commitIfChanged(root, "Bump generated bundle submodule");

if (push) {
  run("git", ["push", "origin", "HEAD:bundle"], bundleDir);
  run("git", ["push", "origin", "main"], root);
}

console.log("Bundle build complete.");
