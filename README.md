# Snip

Snip is a tiny URL shortener: one Bun API serves both an Angular web client and
a zero-dependency Node CLI. The backend uses an in-memory map, so restarting it
clears all links by design.

## Shared API

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/api/links` | `{ "url": "https://…" }` | `201 { code, url, shortUrl, hits, createdAt }`; `400 { error }` for invalid input |
| GET | `/api/links` | — | `200` array of link records |
| GET | `/:code` | — | `302` to the original URL and increments hits; `404` if unknown |

## Branches and layout

Each component has its own orphan branch with files at its root. `main` mounts
the `backend`, `frontend`, and `cli` branches as submodules, pinning exact
commits. The `bundle` submodule is generated release output, not a source branch
to edit by hand.

Clone with submodules populated:

```sh
git clone --recurse-submodules https://github.com/Doris-Lyp/snipdemo-day1
```

A plain clone leaves the submodule folders empty. If you already cloned:

```sh
git submodule update --init --recursive
```

## Run locally

Use three terminals from the `main` checkout:

```sh
cd backend && bun start
```

```sh
cd frontend && npm install && npm start
```

```sh
cd cli && node cli.js ls
```

The backend listens on port 3000 by default; Angular uses its development proxy
to reach it. Set `SNIP_API` to use another backend origin with the CLI.

## Updating and releasing

Commit and push source changes from inside that component's submodule branch,
then update the pinned commit on `main`:

```sh
git submodule update --remote backend
git add backend
git commit -m "Bump backend submodule"
git push
```

Replace `backend` with `frontend` or `cli` as appropriate. Build and publish
generated release output with:

```sh
node scripts/build-bundle.mjs
node scripts/build-bundle.mjs --push
```

The script updates source submodules, builds the frontend, assembles and commits
the bundle, then updates the bundle pointer on `main`. Without `--push`, it
does not push either branch. Running it again with unchanged sources is a safe
no-op. The hourly/manual GitHub Actions workflow rebuilds the bundle; the Docker
workflow publishes the pinned bundle as a GHCR image. It also listens for a
successful bundle workflow run because GitHub suppresses push-triggered
workflows for commits made with the default `GITHUB_TOKEN`.
