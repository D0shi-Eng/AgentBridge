# Illustrated User Guide — from installation to result

English · [العربية](user-guide.ar.md)

This guide is for someone who wants to run AgentBridge on a Windows computer and complete a browser-based trial. The screenshots show the Arabic interface with sample data; labels, names, and results may differ on your machine. **You do not need an external API service, or a workspace ID or API key to open the local dashboard.** The application starts its own internal backend; you do not need to obtain one elsewhere.

## 1. Prepare your computer

You need a Windows 10/11 version supported by your tools and 5 GB of free space on the install drive. Install [Git](https://git-scm.com/install/windows), [Node.js](https://nodejs.org/en/download) `22.13` or newer, and [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) according to your machine's requirements. Open Docker Desktop and wait until its container engine is ready. After installing Node.js, install the `pnpm` version pinned in [`package.json`](../package.json):

```powershell
npm install --global pnpm@11.22.0
```

In a new PowerShell window, confirm that `git --version`, `node --version`, `pnpm --version`, and `docker info` work before continuing. If one fails, use that tool's official guide or the [AgentBridge installation guide](install-local.en.md). The default trial uses the built-in `mock` model provider and needs no third-party AI key.

## 2. Install and open the dashboard

Open PowerShell in the directory where you want the installation, then run these commands in order:

```powershell
git clone https://github.com/D0shi-Eng/AgentBridge.git
cd AgentBridge
deploy\local\agentbridge.cmd setup
deploy\local\agentbridge.cmd open
```

`setup` may take time: it prepares dependencies, the database, and the sandbox image, and generates installation secrets **on your computer**. Then `open` starts the required services and opens `http://127.0.0.1:3411/app` in your browser. You can revisit that address directly. The single-user local mode has no workspace-ID or API-key entry screen.

If the dashboard does not open, check that Docker Desktop is running, then run `deploy\local\agentbridge.cmd status`. The [installation guide](install-local.en.md) covers common failures, stopping, and updating.

![Local dashboard open in the browser](guide/images/02-dashboard.png)

## 3. Create and select a project

In “My projects” below the main form, enter a name such as “First trial” and choose “Add project.” Return to “New OpenAPI spec” above and select that project. Projects organize runs within your local installation; you do not need to create or enter a workspace ID.

![Projects area and specification form in the dashboard](guide/images/03-upload-spec.png)

## 4. Add an OpenAPI specification and start a run

For a first trial, upload `tests/fixtures/mini-petstore.yaml` from your cloned repository, or paste its contents into the text area. With a project selected, choose “Start run.” The form accepts YAML or JSON within the limit displayed in the interface; if it rejects a large file, read the error rather than assuming the file was processed.

Do not put real credentials or secrets in your trial specification. If you later select an external model provider, review the [data-handling limits](security.md) before uploading sensitive specifications.

## 5. Follow the run and read its decision

The run page shows progress and events. The following image is an example of **one completed run**; its stage count and score describe that trial, not a promise that every specification produces the same result.

![Run page, progress, and decision from an illustrated trial](guide/images/04-run-stages.png)

In the decision card, read the status, reason, and score. If a certificate was granted, you will see downloads for the certificate and generated artifacts, plus a verification ID. If the run was rejected, read its reason and missing evidence: **generating output does not automatically grant a certificate**. Live checks may require the running Docker environment and sandbox configuration provided by the local installer.

![Decision card, downloads, and event log from the illustrated trial](guide/images/05-certificate.png)

## 6. Verify a certificate, if one was granted

Open the verification link shown in the decision card. The page displays the verification result and a limited set of fields, such as the score and fingerprint of the inspected output. It records a check of **a specific artifact**; it does not replace your security review of the source API and generated server before using them. A rejected run has no granted certificate to verify.

![Verification page for a certificate granted in the illustrated trial](guide/images/06-verify-public.png)

## After the trial

- To stop services without deleting data, run `deploy\local\agentbridge.cmd stop`.
- To return later, run `deploy\local\agentbridge.cmd open` from the installation directory.
- For backup, update, and restore, follow the [installation guide](install-local.en.md). The bundled backup covers PostgreSQL; it is not, by itself, a complete copy of all files and settings.

These five screenshots show a local interface with sample data; there is no screenshot of a fresh-machine installation. The written commands are the reference for that process. The interface may evolve, so follow the controls and error messages in your installed version if they differ from the pictures.
