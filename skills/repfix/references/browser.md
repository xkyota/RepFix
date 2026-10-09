# Browser reproduction with Playwright

Use the project's installed Playwright test runner and browser versions. Identify the route, interaction, browser, viewport, data, and expected observable outcome. Inspect screenshots, but convert the reported problem into an interaction or visual assertion. Use semantic locators and Playwright's web-first assertions instead of fixed sleeps. Keep retries off during evidence collection.

Check the existing package scripts and Playwright configuration before adapting this example. If browsers or dependencies are missing, resolve them only within the user's authorization; otherwise report `BLOCKED`. Do not treat a browser launch failure as a reproduction of the application bug.

```sh
# With REPFIX and SESSION set as in commands.md:
node "$REPFIX" run --session "$SESSION" --phase reproduce --name checkout \
  --approval "Reviewed local browser test; user authorized the repair and tests" \
  --context "chromium;1280x720;seed-v1" \
  -- node node_modules/@playwright/test/cli.js test tests/checkout.spec.ts \
  --project chromium --workers 1 --retries 0 --trace on \
  --output .repfix/playwright-output --reporter line
```

Repeat the exact command, context, and working directory with `--phase verify` after the source fix. Pin the test and relevant Playwright config with `init --oracle`; do not rewrite expected screenshots as a fix. Before the next run overwrites the Playwright output folder, inspect and attach relevant screenshots and `trace.zip` files to the session. Add evidence IDs to the causal finding. Output paths under `.repfix/` are excluded from project fingerprints.

Use an isolated test account and synthetic fixtures. Traces contain network traffic, DOM snapshots, and source files; review them for credentials, cookies, tokens, private URLs, and user data. `attach --reviewed` acknowledges manual privacy review; it does not sanitize binary content. View traces locally using the installed Playwright CLI (`show-trace`); do not upload evidence automatically. Screenshot masks and disabled tracing are appropriate where private content cannot be isolated; disclose the resulting evidence gap.

For a project without Playwright Test, a small standalone script using its installed `playwright` library can create a fresh browser context, exercise the interaction, assert the result, and exit nonzero on failure. Capture console errors, failed requests, screenshot, and a trace when safe. Use `finally` to stop tracing and close the browser on success and failure. Save output under `.repfix/`. See the runnable browser example in this repository's `examples/browser/`.

The CLI accepts any test command; it does not interpret Playwright reporter formats. The agent must inspect executed test counts, assertion failures, unexpected skips, flaky retries, and artifact relevance. A command that lists tests or takes an unasserted screenshot is not a successful verification.

Official references: [Playwright tracing](https://playwright.dev/docs/trace-viewer), [test CLI](https://playwright.dev/docs/test-cli), [assertions](https://playwright.dev/docs/test-assertions).
