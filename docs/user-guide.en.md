# Illustrated User Guide — from OpenAPI to a signed certificate

> Real screenshots from the platform running locally after a full `deploy/local` install (see the [local install guide](install-local.en.md)). Every step here is repeatable on your own install.

## 1) Direct launch — no key screen

After `agentbridge start`, open in your browser:

```
http://127.0.0.1:3411/app
```

Opening the address directly is enough: the dashboard establishes the local session automatically — no workspace id, no API key, and no token in the URL or browser history. `agentbridge open` does the same and starts the services first if they are stopped, then opens your default browser at this address. The path listens on `127.0.0.1` only and is bound to your machine; the API-key sign-in card remains exclusively for multi-user/network mode.

## 2) Dashboard

The cards summarize state: total runs, active now, granted certificates, and the average score. The "new OpenAPI spec" form starts the pipeline: pick a project, then paste a YAML/JSON spec or upload a file (up to 512 KB — parsed as text, never executed).

![Dashboard](guide/images/02-dashboard.png)

## 3) Upload the spec

Paste the spec text into the box (or drag the file). The example here is the bundled `mini-petstore` fixture from `tests/fixtures/` in the repository.

![Upload spec](guide/images/03-upload-spec.png)

## 4) Run and watch the eight stages

"Start run" creates a run and opens its page: eight stages (ingest, normalize, analyze, tool design, server generation, hardening, evaluation, certification) stream their events live — including the live hardening checks inside an isolated container (no network, read-only, non-root).

![Run stages](guide/images/04-run-stages.png)

## 5) Decision and evidence

When the run completes, the decision card appears: the final score (threshold 85 for a grant), a public verification id `AB-…`, and downloads for the JSON certificate, the SVG badge (with a verification link), and the generated server package ZIP. Sensitive tools can be made to wait for explicit human approval before certification via the HITL checkbox.

![Decision and certificate](guide/images/05-certificate.png)

## 6) Public verification

Anyone — no account, no login — can open `/verify/<verification-id>` and see exactly the documented certificate decision: the score, issue time, and the SHA-256 fingerprint of the inspected artifacts. Any later change to those files breaks the match, so an inspected product cannot be silently "upgraded" after a grant.

![Public verification page](guide/images/06-verify-public.png)

## Notes

- The screenshots come from a real local instance; the sample data (the "Nour Clinic" project and the petstore spec) is demo content.
- Generation is deterministic: the same spec produces the same artifact fingerprint on every run.
- The local session has idle and absolute expiry like any session — expired? Open `/app` again and it is re-established automatically.
- API-key authentication is mandatory for any programmatic access — the only exception is the guarded automatic local session on `127.0.0.1` for single-machine installs (see security.md).
