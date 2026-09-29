<p align="center">
  <img src="docs/assets/logo.svg" alt="AgentBridge logo — شعار AgentBridge" width="132" />
</p>

# AgentBridge

<div align="center">

[<kbd>English</kbd>](README.md) · [<kbd>العربية</kbd>](README.ar.md)

</div>

> AgentBridge is an open-source TypeScript platform that converts OpenAPI 3.x specifications into reviewable MCP servers. It analyzes API operations, proposes agent-facing tools, generates server code, executes static and live checks in an isolated sandbox, supports human approval for sensitive tools, and produces signed, publicly verifiable evidence tied to an artifact fingerprint. The project is currently intended for local evaluation and engineering review; production operation is not supported in this version.

**License:** Apache-2.0 · **Status:** local evaluation and engineering review · **Production:** not supported in this version

---

## What is AgentBridge?

AgentBridge takes an OpenAPI specification as input and produces a complete, reviewable package: a TypeScript MCP (Model Context Protocol) server, a tool manifest, static and live security check results, and a signed certificate tied to the SHA-256 fingerprint of the generated artifacts.

- **Input:** an OpenAPI 3.x specification (YAML or JSON, up to 512 KB).
- **Output:** a generated MCP server, a tool manifest, a check report, a certificate with a public verification ID (`AB-…`), and a downloadable server package.
- **The certificate documents a specific policy run on a specific artifact version** — it does not replace an independent security review or your own production testing.

## Product Type: a Self-Hosted Web Platform

AgentBridge is a **web platform you host yourself**. It is **not** an Android or iOS app, and **not** a desktop application. The `apps/` directory means *runnable application modules*, not mobile apps:

- `apps/api` — the Fastify web server (REST + SSE).
- `apps/dashboard` — the Next.js web dashboard you open in a browser.
- `apps/cli` — a command-line tool that runs the same pipeline locally.

Two ways to use it:

1. **Web service**: run the API and the Dashboard on your own machine or server and use them from the browser.
2. **Developer CLI**: run the pipeline directly from a terminal against your own OpenAPI files.

Both modes run locally against your own infrastructure. Making this repository public does **not** start, host, or expose any service — no hosted instance of AgentBridge exists.

## The Problem It Solves

Vertical SaaS products (clinics, law firms, construction, schools) own real APIs, but those APIs are not directly usable by AI agents: someone has to hand-design agent-facing tools, wrap the endpoints safely, test for injection and leakage, and prove that what ships matches what was reviewed. Doing this ad hoc is slow, and doing it with unchecked auto-generation is dangerous.

AgentBridge turns that work into a deterministic, reviewable pipeline: every proposed tool cites its source operations, every generated server is attacked by a defined check suite before delivery, sensitive tools can require explicit human approval, and the final verdict is signed and publicly verifiable against the artifact fingerprint.

**Who benefits:** developers stop hand-writing glue code and get generated servers they can read line by line; companies get a repeatable path from "we have an API" to "an AI agent can use it safely", with an auditable trail of what was checked, and against which artifact version.

## Workflow: From OpenAPI to MCP

The pipeline is a deterministic DAG of eight stages with an internal repair loop (details in [`docs/orchestration.md`](docs/orchestration.md)):

1. **Ingestion** — parse and normalize the OpenAPI spec (JSON/YAML, internal `$ref` resolution, alias-bomb protection).
2. **Analysis** — classify every operation, scan for PII fields, score risk, and decide which endpoints are worth exposing as MCP tools.
3. **Tool design** — an agent proposes high-level tools, each with mandatory citations pointing back to the source operations.
4. **Generation** — deterministic TypeScript code generation; the same input always produces byte-identical output.
5. **Hardening** — thirteen static checks (HB-01…HB-13) and eight live checks (HD-01…HD-08) run against the actual generated server inside a restricted container.
6. **Evaluation** — an agent reviews each tool from the perspective of a consuming AI agent; a deterministic citation verifier rejects any claim not backed by the spec.
7. **Human review (HITL)** — sensitive tools can require explicit approval before certification.
8. **Certification** — final score 0–100; a score of at least 85 grants an "Agent-Ready Verified" certificate; any critical finding rejects the run outright. Snapshots are signed, so runs can be suspended and resumed without trusting intermediate state.

![OpenAPI to MCP pipeline — AB-DIAG-03](docs/architecture/diagrams/svg/03-openapi-pipeline.svg)

### Certificates and verifiable evidence

- A granted certificate is signed (Ed25519) and carries the SHA-256 fingerprint of the exact generated artifacts, a 0–100 score, and the policy version that produced it.
- The public `GET /verify/:id` endpoint returns a strict whitelist of fields only — verification ID, score, grant decision, timestamp, artifact hash — and no tenant data.
- Key rotation and revocation are supported: previously issued certificates stay verifiable during a rotation window, and a revoked key id fails public verification with a documented reason.

## Wiring diagrams

| ID | What it shows | Status markers |
| --- | --- | --- |
| [AB-DIAG-01](docs/architecture/diagrams/README.md#ab-diag-01-system-context) | System context and trust boundaries | all IMPLEMENTED |
| [AB-DIAG-02](docs/architecture/diagrams/README.md#ab-diag-02-workspaces-and-dependency-directions) | Workspaces and dependency directions | all IMPLEMENTED |
| [AB-DIAG-03](docs/architecture/diagrams/README.md#ab-diag-03-openapi-to-certification-pipeline) | OpenAPI → certification pipeline | all IMPLEMENTED |
| [AB-DIAG-04](docs/architecture/diagrams/README.md#ab-diag-04-mcp-request-path) | MCP request path | all IMPLEMENTED |
| [AB-DIAG-05](docs/architecture/diagrams/README.md#ab-diag-05-agents-dag-repair-hitl-signed-snapshots) | Agents, DAG, repair, HITL, signed snapshots | all IMPLEMENTED |
| [AB-DIAG-06](docs/architecture/diagrams/README.md#ab-diag-06-memory-layers-l0l4) | Memory layers L0–L4 | all IMPLEMENTED |
| [AB-DIAG-07](docs/architecture/diagrams/README.md#ab-diag-07-oidcoauthpkce-and-workspace-identity) | OIDC/OAuth/PKCE and workspace identity | all IMPLEMENTED |
| [AB-DIAG-08](docs/architecture/diagrams/README.md#ab-diag-08-data-isolation-rls-redis-pgvector) | Data isolation (RLS, Redis, pgvector) | all IMPLEMENTED |
| [AB-DIAG-09](docs/architecture/diagrams/README.md#ab-diag-09-certificate-issuance-signing-revocation) | Certificate issuance, signing, revocation | external KMS `PLANNED` |
| [AB-DIAG-10](docs/architecture/diagrams/README.md#ab-diag-10-audit-chain-and-tamper-detection) | Audit chain and tamper detection | all IMPLEMENTED |
| [AB-DIAG-11](docs/architecture/diagrams/README.md#ab-diag-11-sandbox-boundaries) | Sandbox boundaries | egress policy `PLANNED` |
| [AB-DIAG-12](docs/architecture/diagrams/README.md#ab-diag-12-backuprestore-retention-deletion) | Backup/restore, retention, deletion | external KMS backups `PLANNED` |
| [AB-DIAG-13](docs/architecture/diagrams/README.md#ab-diag-13-data-stores-redis-and-pgvector) | Data stores: Redis and pgvector | all IMPLEMENTED |
| [AB-DIAG-14](docs/architecture/diagrams/README.md#ab-diag-14-static-website-vs-full-platform) | Static website vs. full platform | all IMPLEMENTED |

Mermaid sources and rendered SVGs (rendered locally, no external service) live in [`docs/architecture/diagrams/`](docs/architecture/diagrams/README.md), each with purpose, scope, inputs/outputs, trust boundaries, data paths, closed failure cases, and source references.

## Actual Capabilities

- **OpenAPI ingestion** — OpenAPI 3.0/3.1 in JSON or YAML, `$ref` resolution with depth limits, YAML alias-bomb protection, size cap of 512 KB.
- **Deterministic analysis** — endpoint classification, PII field detection (regex rule dictionaries), risk scoring, and MCP-worthiness filtering.
- **Tool design with citations** — every tool design carries JSON-Pointer citations; claims without a source are rejected.
- **Code generation** — full TypeScript MCP server per run: `package.json`, strict `tsconfig.json`, stdio `McpServer` bootstrap, one module per tool, a hardened upstream HTTP client, and a config reader that fails fast when required environment is missing.
- **Security hardening** — static checks for dynamic code execution, unsafe imports, embedded secrets, instruction injection in descriptions, missing schemas, error leakage, manifest honesty, unbounded `JSON.parse`, and non-HTTPS JWKS endpoints; live checks run the real server with an official MCP client against a local recorded upstream (discovery match, secret-leak containment, path-encoding, injection cleanliness, multi-call ordering, payload limits, rate behavior, OIDC issuer rejection).
- **Evaluation and citation verification** — deterministic verification that every tool claim maps to a real operation and parameter.
- **Certification and badge** — weighted score with a hard critical-finding rejection; deterministic SVG badge; public verification endpoint backed by a strict field whitelist.
- **Dashboard** — Next.js 15 control panel (Arabic/English, RTL-first) for uploading specs, watching the pipeline live via SSE, approving/rejecting at HITL, and downloading the certificate, badge, and server package.
- **REST API** — Fastify, multi-tenant with scrypt-hashed tenant keys, NDJSON + SSE run events, resumable runs, signed snapshots, ZIP package export, public `/verify/:id` endpoint, SSO/OIDC configuration, metrics and health endpoints.
- **Memory layers L0–L4** — working, episodic (Redis), semantic (PostgreSQL/Prisma), vector (pgvector), and a cross-run learning flywheel, each behind a port with an in-memory adapter for development and a live adapter for deployment.
- **Audit chain** — append-only hash-chain audit log with tamper detection at a precise position.
- **Enterprise SSO (OIDC)** — per-tenant OIDC configuration with HTTPS-only issuer/JWKS enforcement, PKCE authorization-code flow, and local verification without heavy JWT libraries.
- **CLI** — `@agentbridge/cli` runs the pipeline from the terminal.

## Status Matrix

Status reflects this repository's own automated tests (runnable locally); "Verified" means covered by those tests in this repository, not by an external audit.

| Capability | Status |
| --- | --- |
| OpenAPI ingestion and normalization | Implemented, Verified |
| Static analysis (classification / PII / risk / worthiness) | Implemented, Verified |
| Deterministic server generation | Implemented, Verified |
| Static hardening checks HB-01…HB-13 | Implemented, Verified |
| Live hardening checks HD-01…HD-08 in restricted container | Implemented, Verified (local sandbox; requires Docker) |
| Certification, badge, public `/verify` | Implemented, Verified |
| Orchestrator DAG, repair loop, HITL, signed snapshot resume | Implemented, Verified |
| Memory L0–L4 with in-memory and live adapters | Implemented, Verified (live adapters via conditional integration tests) |
| Hash-chain audit log | Implemented, Verified |
| Dashboard and REST API | Implemented, Verified |
| SSO/OIDC configuration and verification | Implemented, Verified (test IdP mock in automated runs) |
| LLM providers Anthropic/OpenAI with budget guard | Implemented (verified with simulated network; live network runs depend on owner keys) |
| Metrics and health endpoints | Implemented, Verified |
| Arabic/English interface | Implemented, Verified |
| External KMS provider beyond `local` | Planned — not implemented, not verified |
| npm publishing, managed cloud, hosted service | None of these exists today |
| Production deployment | Not supported in this version; not verified for production use |

## Architecture

Modular Monolith with hexagonal boundaries — every package in `packages/` is a unit with ports and adapters, extractable into a service later without rewriting:

![System context — AB-DIAG-01](docs/architecture/diagrams/svg/01-system-context.svg)

- `packages/spec-parser`, `analyzer`, `generator`, `hardening`, `evaluator`, `agents`, `orchestrator`, `llm`, `memory`, `infra`, `shared`.
- `apps/api` (Fastify), `apps/dashboard` (Next.js), `apps/cli`.
- Dependency rule: source dependencies point toward internal contracts only; the domain never depends on infrastructure. Determinism first: algorithms before model calls, and every LLM output passes Zod validation plus the truth layers before entering the system.

See [`docs/architecture.md`](docs/architecture.md) for the decision record (ADRs) and [`docs/architecture/diagrams/README.md`](docs/architecture/diagrams/README.md) for the full wiring diagrams.

## Security Model and Limits

Documented design: [`docs/security.md`](docs/security.md). Highlights:

- Platform secrets come from the environment only, validated by Zod at boot with fail-closed behavior; logs redact key-like patterns.
- Tenant API keys are stored as scrypt hashes; upstream credentials are AES-256-GCM encrypted envelopes.
- Generated servers follow the MCP security posture (OAuth 2.1 module with PKCE, `requiredScopes` enforcement) as documented in `docs/security.md` §3.
- Multi-tenant isolation is structural: every store call takes `tenantId`, plus row-level-security migrations and a restricted DB role for live deployments.
- Prompt-injection defense: spec content is passed as delimited data, injection patterns are scanned deterministically, agent outputs are schema-validated, and agents hold minimal toolsets.

### Isolation and human review

- Live checks execute inside a restricted container: read-only root filesystem, non-root user (`65532`), CPU/memory/PID caps, and network access programmatically confined to localhost (`assertLocalhostOnly`).
- Sensitive tools can require explicit human approval before certification (HITL): approval tickets are signed, tied to a specific run, and audited.
- **Limits (read before relying on any of this):** the certificate documents one policy run, not absolute safety; the sandbox depends on a correctly configured local Docker host; the general network-egress policy beyond JWKS is planned; the only implemented KMS provider is `local` (explicitly rejected in production mode); and no production deployment of this system exists.

## Getting Started Locally

> **Illustrated user guide:** sign-in, uploading a spec, watching the pipeline, and reading the signed evidence — with real screenshots: [docs/user-guide.en.md](docs/user-guide.en.md) (Arabic: [docs/user-guide.ar.md](docs/user-guide.ar.md)).
>
> **One-command install package:** [`deploy/local/`](deploy/local/) provisions the full platform (secrets, PostgreSQL, Redis, dashboard) on `127.0.0.1` — see [`docs/install-local.en.md`](docs/install-local.en.md) (Arabic: [`docs/install-local.ar.md`](docs/install-local.ar.md)).

Requirements: Node.js ≥ 22.13 and pnpm (`packageManager` is pinned in `package.json`).

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

The default configuration runs entirely on in-memory adapters with `LLM_PROVIDER=mock` — no external services and no API keys are needed.

Optional local infrastructure (PostgreSQL with pgvector and Redis) for development:

```bash
docker compose -f docker-compose.dev.yaml up -d
```

Run the dashboard and API for local evaluation:

```bash
pnpm --filter @agentbridge/dashboard dev
pnpm --filter @agentbridge/api dev
```

Both are development servers (`next dev` and `tsx watch`); each app also has a non-watch `start` script.

Copy `.env.example` to `.env` and fill values only where you intend to use them (see [Configuration Variables](#configuration-variables)).

## Try the CLI — no keys, no services

```bash
pnpm install
pnpm exec tsx apps/cli/src/main.ts --spec tests/fixtures/mini-petstore.yaml --out ./ab-out
```

The terminal prints all eight stage events; `./ab-out/` receives the generated MCP server, `certificate.json`, `badge.svg`, and `events.ndjson`. Exit codes: `0` granted certificate · `2` completed with a documented rejection · `1` failure. Without live evidence a run ends in a documented `LIVE_EVIDENCE_MISSING` rejection — fail-closed by design.

To make granting possible, the live checks execute for real inside the restricted Docker sandbox. Build the one-time runner image and pass `--live` (keep the output directory inside your checkout so the generated server can resolve its pinned dependencies):

```bash
pnpm --filter @agentbridge/shared build
pnpm --filter @agentbridge/hardening build
cp -r packages/shared/dist docker/sandbox-runner/shared-dist
cp -r packages/hardening/dist docker/sandbox-runner/hardening-dist
cp packages/shared/package.json docker/sandbox-runner/shared-package.json
cp packages/hardening/package.json docker/sandbox-runner/hardening-package.json
docker build -t agentbridge/sandbox-runner:isolated docker/sandbox-runner
pnpm exec tsx apps/cli/src/main.ts --spec tests/fixtures/mini-petstore.yaml --out ./ab-out-live --live
```

A granted certificate then carries the sandbox attestation (network `none`, non-root user, image digest). The runner image pins its own dependencies at build time; its Dockerfile points the in-image package entries at `dist`.

## Self-hosting the full platform (verified sequence)

Prerequisites: Docker, Node.js ≥ 22.13, pnpm. PostgreSQL with pgvector and Redis come from the dev compose file — development endpoints, not production servers.

```bash
pnpm install
pnpm --filter @agentbridge/infra exec prisma generate
docker compose -f docker-compose.dev.yaml up -d                  # PostgreSQL :5433 (pgvector) + Redis :6380
pnpm --filter @agentbridge/infra exec prisma migrate deploy      # on an empty database
```

1. **Restricted runtime role** (idempotent; the password exists only in this one command's environment):
   ```bash
   AB_APP_PASSWORD='<random ≥16 chars>' node scripts/prepare-restricted-role.mjs
   ```
2. **First workspace and key** — the raw key is written atomically to the file you name, never to stdout or logs:
   ```bash
   DATABASE_URL='postgresql://ab_app:<your password>@localhost:5433/agentbridge?options=-c role=agentbridge_app' \
   ADMIN_DATABASE_URL='postgresql://agentbridge:<your password>@localhost:5433/agentbridge' \
   pnpm exec tsx apps/cli/src/ops/ops-main.ts onboard-tenant --store live \
     --tenant <id> --name '<name>' --issuer https://<idp> --subject <sub> \
     --permissions "resource:read,pipeline:run,pipeline:review,artifact:read,flywheel:read,analytics:read" \
     --expires-in-days 30 --initial 1 --secret-output ./tenant.key
   ```
3. **Run the services** (secrets via the environment only; the three signing keys are Ed25519 PKCS#8 base64 — a generation one-liner is in `.env.example`):
   ```bash
   DATABASE_URL='<ab_app DSN from step 1 template>' REDIS_URL='redis://localhost:6380' PERSISTENCE=live \
   ENCRYPTION_KEY='<32-byte base64>' LLM_PROVIDER=mock \
   ORCH_SNAPSHOT_PRIVATE_KEY='…' CERT_SIGNING_PRIVATE_KEY='…' HITL_SIGNING_PRIVATE_KEY='…' \
   pnpm --filter @agentbridge/api start        # API on :3000
   pnpm --filter @agentbridge/dashboard dev    # dashboard on :3001 → open /app
   ```
4. **Sign in** on `/app` with your tenant id + raw key — the dashboard exchanges them for an opaque session cookie (`POST /auth/api-key/session`, origin-checked, CSRF-protected) — then upload a spec, watch the pipeline over SSE, and read the signed decision. The public `GET /verify/:id` exposes a strict field whitelist only.

Honest note: by default the runtime does not enable live probes, so platform runs end in the documented `LIVE_EVIDENCE_MISSING` rejection; the granted path is exercised by the CLI `--live` flow and the sandbox suites above. Deleted tenants keep a tombstone: their id is not reusable, and the first-admin bootstrap is a once-per-database event by design.

## Optional Live Integration Tests

Beyond the default test suite, the repository contains conditional live-integration suites — row-level security under a restricted database role, pgvector, SSE under concurrency, TLS behavior, backup/restore, retention and revocation — which skip themselves with a documented skip name when their infrastructure is absent, so CI and fresh clones stay green.

Point these suites at your own PostgreSQL/Redis instances via the documented environment variables; nothing in the tree requires a hosted service or external account.

## Repository Layout

```
apps/        api (Fastify), dashboard (Next.js), cli
packages/    spec-parser, analyzer, generator, hardening, evaluator,
             agents, orchestrator, llm, memory, infra, shared
docs/        architecture, repository layout, systems, agents, tools,
             security, memory, verification & evidence, orchestration,
             wiring diagrams (docs/architecture/diagrams)
docs/assets/ logo, monogram, social preview (original, Apache-2.0)
website/     static bilingual site (built locally; never deployed from CI)
scripts/     release checks: secret scanning, SBOM, license and link checks
tests/       e2e suites and fixtures (conditional live tests self-skip)
docker/      restricted sandbox image
```

Internal operating documents (working notes, internal reports, commercial notes) are deliberately not part of this tree.

## Configuration Variables

Reference: [`.env.example`](.env.example) (values are placeholders; never commit real values). Highlights:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV`, `PORT`, `LOG_LEVEL` | basic runtime settings |
| `PERSISTENCE` | `memory` (default, in-memory adapters) or `live` (PostgreSQL/Redis) |
| `DATABASE_URL`, `REDIS_URL` | live persistence endpoints (secrets via env only) |
| `ENCRYPTION_KEY` | AES-256-GCM key, 32 bytes base64; required outside development |
| `LLM_PROVIDER` | `mock` (default) / `anthropic` / `openai` |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | provider keys — secrets, env only |
| `LLM_MONTHLY_BUDGET_USD` | per-tenant monthly spend ceiling enforced before calls |
| `JWKS_ALLOWED_HOSTS` | trusted-operator allowlist for JWKS fetching (HTTPS/443 only) |
| `APP_ORIGIN`, `OIDC_REDIRECT_URI` | fixed browser origin and callback (never derived from headers) |
| `ORCH_SNAPSHOT_PRIVATE_KEY`, `CERT_SIGNING_PRIVATE_KEY`, `HITL_SIGNING_PRIVATE_KEY` | Ed25519 signing keys (base64 PKCS#8) for snapshots, certificates, HITL tickets |
| `CERT_SIGNING_VERIFY_PUBLIC_KEYS`, `CERT_SIGNING_REVOKED_KEY_IDS` | certificate key rotation and revocation |
| `KMS_PROVIDER` | `local` only today; external providers are `NOT_VERIFIED` |
| `RETENTION_POLICY_JSON` | per-data-class retention policy (fail-closed in production) |
| `ADMIN_DATABASE_URL` | operator connection for admin bootstrap (`agentbridge-ops`), never in argv |
| `METRICS_TOKEN` | protects `/metrics` (timing-safe comparison) |

## Testing and Verification

```bash
pnpm test        # unit + component + conditional integration suites
pnpm typecheck && pnpm lint
```

- Core packages (parser, analyzer, generator, plus llm/hardening/memory/infra/dashboard) enforce coverage floors (≥ 80%).
- Conditional integration tests start against your own PostgreSQL/Redis/pgvector and skip with documented names otherwise.
- Determinism is tested: identical input produces byte-identical generated servers, and independent runs reproduce the same artifact fingerprint and verification decision.
- A deliberately vulnerable fixture server scores zero and is auto-rejected by the certification gate.
- CI runs typecheck, lint, tests, builds, secret scanning, dependency audit, SBOM, license checks, Markdown link checks, Mermaid validation, and README language parity (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Contributing and Security Reporting

- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md) — docs before code, mandatory tests, TypeScript strict without `any`, Arabic comments explaining what/why, no new dependency without a documented ADR. Governance: [`GOVERNANCE.md`](GOVERNANCE.md). Code of conduct: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- Security: read [`SECURITY.md`](SECURITY.md) first. **No public security channel and no Private Vulnerability Reporting are enabled yet** (owner decision pending) — do not open public issues for undisclosed vulnerabilities, do not publish exploit details, and do not test against systems you do not own.

## Current Limitations and Risks

- **Production deployment is not supported in this version** — the declared production-readiness requirements are not complete, and nothing here is operated as a hosted service.
- No managed cloud, no SLA, no commercial offering, no pricing — anything claiming otherwise is not from this project.
- Live check suites require a correctly configured local Docker host; sandbox guarantees are conditional on that host's configuration.
- Network LLM providers require your own API keys and incur real cost; the default `mock` provider is deterministic and free.
- The project is developed primarily on Windows; CI covers Linux, but environment specifics (paths, Docker flavor) may differ.
- External KMS, general egress policy, and multi-region operation are planned and not implemented.
- The public verification endpoint exposes only whitelisted fields, but running it publicly is a deployment decision this repository does not make for you.

## License

Core code is licensed under [Apache-2.0](./LICENSE); see [`NOTICE`](./NOTICE) and [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for attribution and bundled assets, including the IBM Plex Sans Arabic and Inter fonts under SIL OFL 1.1. The logo, monogram, and social preview in `docs/assets/` are original project assets under the same license.

## Production Status

The system is intended for local evaluation and engineering review; production operation is not supported in this version. The repository is currently **private**, and any decision to open it publicly — or to host anything — belongs to the project owner. Opening the repository does not, by itself, start or expose any service.
