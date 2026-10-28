# Browser checks

With Node.js, Playwright, and Microsoft Edge installed:

```powershell
node --test tests/leaderboard.test.cjs
```

If Playwright is supplied by the Codex runtime, set `NODE_PATH` to its bundled `node_modules` directory first. Set `BROWSER_CHANNEL` to use another installed Playwright browser channel.

Tests serve the website locally, mock evaluation-service requests, and exercise the demo fixture. No submissions go to a real evaluation service. Checks cover required profile/contact fields, phone/WeChat switching and validation, request bodies, contact privacy, status polling, records, and responsive layout. Screenshots are written to `.cache/browser-checks/`; set `TEST_ARTIFACTS` to override the output directory.
