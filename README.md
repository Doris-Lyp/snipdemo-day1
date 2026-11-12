# Snip backend

A zero-dependency Bun API for the Snip URL shortener. Links are held in memory
and are cleared when the server restarts.

## Run

```sh
bun start
```

The server listens on port `3000` by default. Configure `PORT` to change it.
`BASE_URL` controls the origin in returned `shortUrl` values. If it is unset,
the server uses `https://$RAILWAY_PUBLIC_DOMAIN` when available, otherwise
`http://localhost:$PORT`.

Set `PUBLIC_DIR` to serve existing static files as well; `/` serves
`index.html`. A matching static file takes precedence over a short code.

## API

- `POST /api/links` with `{"url":"https://example.com"}` creates a link and
  returns `201` with `{code,url,shortUrl,hits,createdAt}`. Invalid JSON or a
  non-HTTP(S) URL returns `400` with an `error` field.
- `GET /api/links` returns all links in the same shape.
- `GET /:code` redirects to the original URL with `302` and increments `hits`;
  unknown codes return `404`.

CORS is open for browser clients.
