<p align="center">
  <img src="docs/assets/logo.svg" alt="AgentBridge logo" width="120" />
</p>

<h1 align="center">AgentBridge</h1>

<div align="center">

[<kbd>English</kbd>](README.md) · [<kbd>العربية</kbd>](README.ar.md)

</div>

AgentBridge turns OpenAPI specifications into TypeScript MCP servers. From a dashboard running on your own computer, you can upload a specification, follow generation and checks, review the result, and download the output. A command-line tool is also available if you prefer working in a terminal.

**License:** [Apache-2.0](LICENSE) · **How it runs:** locally on your computer

**Start from zero:** [Windows installation guide](docs/install-local.en.md) → [illustrated step-by-step user guide](docs/user-guide.en.md). You do not need to bring an external API service, enter an API key, or type a workspace ID to open the local dashboard. The `open` command starts the required internal components for you.

## What is AgentBridge?

It supports `OpenAPI 3.0/3.1` documents in JSON or YAML. AgentBridge analyzes operations, proposes MCP tools, generates server code, and shows the check results. A signed certificate is issued **only when the output meets policy requirements and the required evidence is present**; otherwise, the reasons for rejection remain available for review.

A certificate records a decision about a particular generated artifact under a particular policy. It does not certify the source API or replace your review of the generated server before using it.

## Product Type: a Self-Hosted Web Platform

The main experience is a **web dashboard that runs on your machine and opens in a browser**. It is not a native desktop or mobile app. A CLI is available for developers who do not need the dashboard.

The single-user installer opens the dashboard directly. Programmatic and other operating modes retain their own authentication controls; the local browser shortcut is limited to your computer.

## The Problem It Solves

An OpenAPI document describes an API, but it does not decide which operations should become agent tools, what permissions those tools need, or whether generated code behaves as intended. AgentBridge provides a repeatable path from specification to generated MCP server, with check results and a recorded decision that a developer can inspect.

## Workflow: From OpenAPI to MCP

1. Parse the specification and validate its structure and limits.
2. Analyze API operations and propose MCP tools tied to their source operations.
3. Generate the server and its tool manifest.
4. Run static checks; when configured, run live checks in a restricted Docker container.
5. Request human review when policy requires it, then record the decision and evidence. Missing required live evidence cannot produce a granted certificate.

![OpenAPI specification, generated MCP server, checks, and decision](docs/architecture/diagrams/svg/03-openapi-pipeline.svg)

The [orchestration document](docs/orchestration.md) contains the implementation detail behind this overview.

## Wiring diagrams

The [diagram guide](docs/architecture/diagrams/README.md) explains all 14 diagrams, the data flows, and the trust boundaries. Start with the [system context](docs/architecture/diagrams/svg/01-system-context.svg), the workflow above, and the [static website versus running platform](docs/architecture/diagrams/svg/14-website-vs-platform.svg). The static website describes the project; the dashboard and services run from your local installation.

## What You Can Do

- Parse OpenAPI 3.0/3.1 JSON and YAML and generate a TypeScript MCP server.
- Produce static check results and, when the required Docker environment is available, live check results.
- Sign a certificate for an eligible run and expose a limited verification response from an API instance you operate.
- Follow runs and results in a browser dashboard, or use the CLI with the built-in mock model provider.
- Keep local installation data across restarts and provide commands for status, stop, update, database backup, and restore.

## Architecture

`apps/` contains the Fastify API, Next.js dashboard, and CLI. `packages/` contains parsing, analysis, generation, hardening, orchestration, and supporting modules. The full local installation uses PostgreSQL with pgvector and Redis; live checks run separately inside a restricted Docker container.

![System components and trust boundaries](docs/architecture/diagrams/svg/01-system-context.svg)

See the [architecture document](docs/architecture.md) and [diagram guide](docs/architecture/diagrams/README.md) for component boundaries and data paths.

## Security Model and Limits

The single-user installer binds services to `127.0.0.1` by default and generates installation secrets locally. Its automatic browser session assumes that other processes running as the same operating-system user are trusted; **do not expose this mode on a network**. The live-check container has restrictions, but its isolation also depends on the host running Docker correctly.

The certificate reports the outcome of defined checks on a specific artifact, not absolute safety. If you configure an external model provider, specification content may be sent to that provider and usage may incur charges. Read the [security design](docs/security.md) before processing sensitive specifications or changing network exposure.

## Getting Started Locally

For the supported single-machine path, use Windows 10/11, a running Docker Desktop installation, Node.js 22.13 or newer, the `pnpm` version specified in [`package.json`](package.json), Git, and at least 5 GB of free disk space.

```powershell
git clone https://github.com/D0shi-Eng/AgentBridge.git
cd AgentBridge
deploy\local\agentbridge.cmd setup
deploy\local\agentbridge.cmd open
```

`setup` creates local configuration, secrets, persistent stores, and the sandbox image. `open` starts stopped services if needed and opens `http://127.0.0.1:3411/app`. The default mock provider needs no external model key.

Use the [Windows installation guide](docs/install-local.en.md) for prerequisites and troubleshooting, and the [illustrated user guide](docs/user-guide.en.md) for uploading a specification and reading its result. Keep `runtime/`, backups, and generated secrets out of Git and public reports.

## Try the CLI — no keys, no services

To try the pipeline without starting the dashboard or database:

```powershell
pnpm install --frozen-lockfile
pnpm exec tsx apps/cli/src/main.ts --spec tests/fixtures/mini-petstore.yaml --out ./ab-out
```

This example uses the built-in mock provider and no external service. Without live-check evidence, an otherwise completed run is expected to record a **rejection**, not a granted certificate. The output directory contains the generated artifacts and decision record. Live checks have additional Docker prerequisites; see the [security design](docs/security.md).

## Operating the Local Platform

The recommended local route is the `deploy/local/` package above. It starts the dashboard, API, PostgreSQL, Redis, and sandbox support on one Windows machine. Use `deploy\local\agentbridge.cmd status` to check services and `stop` to shut them down. The [installation guide](docs/install-local.en.md) covers update, backup, restore, and exactly what a database backup contains.

The supplied launcher is designed for a single computer and binds to its loopback interface. It does not publish your dashboard to other people; each user runs their own installation.

## Optional Live Integration Tests

Some test suites require real infrastructure, including PostgreSQL, Redis, or Docker. They may skip with a recorded reason when those prerequisites are absent. Read the pass, failure, and skip counts from your own run; a green default suite does not mean every conditional integration scenario ran.

## Repository Layout

- `apps/` — API, web dashboard, and CLI.
- `packages/` — product and shared modules.
- `deploy/local/` — local installation and maintenance commands.
- `docker/` — sandbox build and runtime files.
- `docs/` — guides, security notes, and architecture diagrams.
- `tests/` — test suites and synthetic fixtures.
- `website/` — an informational static site, not the running platform.

## Configuration Variables

The reference is [`.env.example`](.env.example). Local setup starts with `LLM_PROVIDER=mock`, which needs no third-party model key. If you choose a network model provider, supply your own key **only in local configuration** and review its data-handling terms and cost. Never commit secrets, runtime data, or backups.

## Testing and Verification

From the repository root, after the prerequisites are installed:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The [CI workflow](.github/workflows/ci.yml) also checks documentation, dependencies, licenses, secrets, and build outputs. A past CI result does not substitute for testing your own installation; conditional live tests must be read separately.

## Contributing and Security Reporting

To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md). For security reports, consult [SECURITY.md](SECURITY.md) before contacting maintainers, and do not post details of an unpatched vulnerability in a public issue.

## Operating Boundaries

- The supplied one-command installation targets Windows. Linux CI checks the source; it does not establish that the Windows installer runs on Linux.
- Live checks need a working Docker host. The container’s restrictions do not replace host security or review of the generated server.
- External model providers need your own keys and may charge for usage; the mock provider avoids provider charges but does not model every real response.
- The bundled backup command covers PostgreSQL data. Confirm how you will preserve other files and configuration before relying on it as a complete disaster-recovery plan.
- AgentBridge is not a managed online service: each installation keeps its own data on its owner's computer. The [installation guide](docs/install-local.en.md) covers local setup, and the [security design](docs/security.md) explains its technical boundaries.

## License

The repository is licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and bundled assets.
