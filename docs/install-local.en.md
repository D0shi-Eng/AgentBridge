# Local Install Guide — AgentBridge on Your Machine

> This guide runs the whole platform on a single local machine: a browser dashboard + API server + PostgreSQL (with pgvector) + Redis + live security checks inside an isolated container. Everything binds to `127.0.0.1` only — no port is exposed to the network.

## Requirements

| Requirement | Note |
| --- | --- |
| Windows 10/11 | Scripts run on PowerShell 5.1+ (nothing extra to install) |
| Docker Desktop | Must be running before `setup` and `start` — we never start it for you |
| Node.js ≥ 22.13 and pnpm | Matching the root `packageManager` |
| Git | For pull/update only |
| Disk | 5 GB free on the install drive |

## Install and Run

```powershell
git clone https://github.com/D0shi-Eng/AgentBridge.git AgentBridge
cd AgentBridge
deploy\local\agentbridge.cmd setup    # once: locally generated secrets + database + admin workspace
deploy\local\agentbridge.cmd start    # start everything (re-runnable, no data loss)
```

Then open the dashboard directly — no key screen:

```
deploy\local\agentbridge.cmd open
```

This opens your default browser at `http://127.0.0.1:3411/app` (starting services first if they are stopped). Or type the address yourself: opening `/app` directly is enough, with no workspace ID, API key, or token in the URL. The API service mentioned below is an internal component started by the package; you do not need to bring an external service or its key to open the dashboard.

> Default ports: API 3410, dashboard 3411, PostgreSQL 3412, Redis 3413 — all on `127.0.0.1`, configurable in `runtime\local.env` before `setup`. Note: the dashboard's `/api` proxy is baked at build time, so changing ports requires running `setup`/`update` again.

## Commands

Run the commands below from the repository root as `deploy\local\agentbridge.cmd <command>`. The bare `agentbridge` in the table is shorthand, not a command automatically added to PATH.

| Command | What it does |
| --- | --- |
| `agentbridge setup` | Idempotent first-time setup: separate folders, generated secrets, migrations, admin workspace, sandbox image build |
| `agentbridge start` | Starts PostgreSQL and Redis, then the API, then the dashboard — fails with a clear message if Docker is missing or a port is busy |
| `agentbridge status` | Component status (exit code 0 healthy / 1 degraded) |
| `agentbridge stop` | Stops everything; data stays in `runtime\data` |
| `agentbridge update` | Pulls source (fast-forward only) + builds + migrations + restart if it was running |
| `agentbridge backup [-Name x]` | Compressed `pg_dump` into `runtime\backups` with a SHA-256 manifest |
| `agentbridge restore -File <dump> -Yes` | Restore a backup (explicit confirmation required) — stops the API and restarts it after |

## Where does everything live? (inside the install folder, never pushed to Git)

| Path | Contents |
| --- | --- |
| `runtime\data\postgres` | Database files (live data) |
| `runtime\data\redis` | Redis data (appendonly) |
| `runtime\secrets` | Installation secrets, including a credential for advanced programmatic access — ACL-protected via icacls (current user and SYSTEM only); not needed to open the dashboard |
| `runtime\logs` | API and dashboard logs |
| `runtime\backups` | Backups and their manifests |
| `runtime\local.env` | Ports and machine settings — no secrets |

Docker's internal images stay in the default Docker Desktop store (WSL); this guide does not relocate that store or change global Docker settings.

## Common Errors

- **"Docker مثبت لكن الخدمة لا تعمل"** — open Docker Desktop, wait until it is ready, then re-run the command.
- **"المنفذ X مشغول"** — free the port or change ports in `runtime\local.env`, then re-run `setup`/`start`.
- **"التثبيت غير مكتمل"** — you skipped `setup`, or a file under `runtime\secrets` was deleted.
- **Start fails after an update** — check the last lines of `runtime\logs\api.err.log` or `docker logs agentbridge-local-postgres`.
- **A key-entry screen appears?** — that is not the expected single-user local experience. Check the local package configuration and run `deploy\local\agentbridge.cmd open`. Do not delete installation secrets to fix a display issue.

## Local-Mode Limits (stated honestly)

- **TLS:** traffic is local `http://127.0.0.1` — browsers treat it as a secure context, but this build is not meant to serve HTTPS across a network. The staging TLS mode is documented via `STAGING_HTTPS=1` and requires a local certificate plus a manual, documented trust install.
- **NODE_ENV=development:** production mode refuses to boot locally on purpose (no external KMS provider is approved yet) — the three signing keys here are stable and generated locally by `setup`.
- **Mock mode:** `LLM_PROVIDER=mock` needs no LLM key. To use a real provider, add `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` and change `LLM_PROVIDER` in `runtime\secrets\api.env`, then run `deploy\local\agentbridge.cmd stop` followed by `deploy\local\agentbridge.cmd start`.
- **Single owner workspace per machine:** the package provisions one owner workspace; multi-tenant operation is possible via `agentbridge-ops` but is outside this package's scope.
- **No hosted service:** there is no cloud server, no Pages, no public port — the machine stops, the platform stops.
