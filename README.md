# Snip CLI

Zero-dependency Node 20+ client for the shared Snip API. Source files live at the
root of the independent `cli` branch, mounted as `cli/` by the `main` superproject.

```sh
node cli.js help
node cli.js add https://example.com
node cli.js ls
node cli.js open Ab12Cd
npm test
```

Use the `snip`, `snip.cmd`, or `snip.ps1` wrapper for your shell, or `npm link` to
install the package's `snip` command locally.

Set `SNIP_API` to the backend's HTTP(S) origin (default `http://localhost:3000`).
For PowerShell: `$env:SNIP_API = 'https://your-snip-host.example'`.
Requests time out after 10 seconds. Help succeeds without a backend; invalid
arguments, missing codes, network/API errors, and browser-launch failures write
to stderr and exit 1. Successful commands exit 0.

`add` posts `{url}` to `/api/links` and prints only the returned `shortUrl`.
`ls` displays code, hits, and original URL, or `No links yet.`. Records contain
`code`, `url`, `shortUrl`, `hits`, and ISO `createdAt`. Storage is temporary:
restarting the backend clears links.

`open` requests `/:code` without following its 302 redirect, then opens the
HTTP(S) Location in the default browser using Windows `start`, macOS `open`,
or Linux `xdg-open`. It requests the short code once, so it increments hits once.
The host must have a graphical browser and the corresponding launcher.

Tests use a local mock HTTP API and simulated platform launchers; actual browser
opening must also be checked on each supported host. The generated `bundle`
copies `cli.js` unchanged; keep it CommonJS and do not add `"type": "module"`.
