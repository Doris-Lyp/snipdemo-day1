# Snip frontend

Angular 19 client for the shared Snip API. Requires Node 20+ (a version supported
by Angular 19) and npm.

```sh
npm install
npm start
```

Open http://localhost:4200 with the backend running on http://localhost:3000.
The development server proxies `/api` to that backend via `proxy.conf.json`.
Production uses relative `/api/links` requests, so the generated bundle works
on the same origin as its Bun server without hardcoded localhost URLs.

The reactive form accepts HTTP(S) URLs, displays inline API/network errors,
prevents duplicate submissions, and refreshes the table after creation. Refresh
links manually to see new redirect hits or changes made by the CLI. Links are
stored in backend memory and disappear on restart.

## Shared contract

- `POST /api/links` with `{ "url": "https://example.com" }` returns status 201 and
  `{ code, url, shortUrl, hits, createdAt }`; invalid input returns 400 `{ error }`.
- `GET /api/links` returns an array of the same records.
- `GET /:code` redirects with 302 and increments hits, or returns 404.

## Checks

```sh
npm run build
npm test -- --watch=false --browsers=ChromeHeadless
```

Tests use the Angular HTTP testing backend and require Chrome (set `CHROME_BIN`
if it is not detected). Build output must remain
`dist/snip-frontend/browser/index.html`; the bundle script depends on this path
and on the project name `snip-frontend`.

Source files live at the root of the independent `frontend` branch. After a
frontend commit and push, update the frontend submodule pointer on `main`
separately. Never edit generated `bundle` output.
