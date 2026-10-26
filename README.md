# ABB Worker ID & Registration (WIR)

WIR is a standalone worker registration and identity-card application for ABB Plant 3. It includes worker registration, worker management, secure administrator sign-in, local photo storage, and two-sided CR80 PDF ID cards. It does not provide gate access, visitor management, attendance, or canteen features.

## Requirements

- Windows 10/11 or Windows Server
- Python 3.11 or newer
- Node.js 20 or newer and npm for frontend development and builds
- Packages pinned in `requirements.txt` and `frontend/package-lock.json`

Node.js is only required to develop or build the frontend. A deployment computer can run the prebuilt frontend without Node.js if `frontend/dist` is included.

## First-time setup

Open PowerShell in the project directory (for example, `D:\ABB Workforce360`). Create a Python environment and install the backend packages:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Create the local environment file once. This check preserves an existing `.env`:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Open `.env` and set the database, upload, logo, and allowed-origin paths if needed. For a local run, the example database and upload paths work. For deployment, place the database and worker photos in a restricted data folder outside the source directory.

Generate the three application secrets and the Aadhaar encryption key only if the placeholder secrets are still present. This PowerShell block writes them directly to `.env` without printing the values. Run it from the project directory:

```powershell
$wirPython = ".\.venv\Scripts\python.exe"
$envText = Get-Content .env -Raw
if ($envText -match 'WIR_SESSION_SECRET=replace-') {
  $sessionSecret = & $wirPython -c "import secrets; print(secrets.token_urlsafe(48))"
  $csrfSecret = & $wirPython -c "import secrets; print(secrets.token_urlsafe(48))"
  $workerIdSecret = & $wirPython -c "import secrets; print(secrets.token_urlsafe(48))"
  $aadhaarKey = & $wirPython -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  $envText = $envText -replace '(?m)^WIR_SESSION_SECRET=.*$', "WIR_SESSION_SECRET=$sessionSecret"
  $envText = $envText -replace '(?m)^WIR_CSRF_SECRET=.*$', "WIR_CSRF_SECRET=$csrfSecret"
  $envText = $envText -replace '(?m)^WIR_WORKER_ID_SECRET=.*$', "WIR_WORKER_ID_SECRET=$workerIdSecret"
  $envText = $envText -replace '(?m)^WIR_AADHAAR_ENCRYPTION_KEY=.*$', "WIR_AADHAAR_ENCRYPTION_KEY=$aadhaarKey"
  Set-Content .env -Value $envText -Encoding utf8NoBOM
  Remove-Variable sessionSecret, csrfSecret, workerIdSecret, aadhaarKey
  Write-Output 'WIR secrets were generated and saved in .env.'
} else {
  Write-Output 'WIR secrets are already configured; leaving .env unchanged.'
}
```

Keep `.env` private and include it in the approved secrets backup process. The encryption key is required to decrypt stored Aadhaar values. Never commit `.env` or share its contents. The app refuses to start without the session, CSRF, and Worker ID secrets; registration is disabled without the Aadhaar encryption key.

The supplied ABB logo is `assets\abb-logo.svg`. The frontend build copies it automatically, and the PDF generator embeds it as vector artwork. Set `WIR_LOGO_PATH` if the backend should read the logo from another location.

## Install frontend packages and create an administrator

Install the frontend dependencies and run its test from the project directory:

```powershell
Set-Location 'D:\ABB Workforce360\frontend'
npm ci
npm test
Set-Location 'D:\ABB Workforce360'
```

Create the first administrator once, after `.env` has been configured:

```powershell
Set-Location 'D:\ABB Workforce360'
.\.venv\Scripts\python.exe -m backend.create_admin
```

Enter a unique username and a password of at least 14 characters when prompted. Password input is hidden. No default account is created.

## Run the development project

From the project root, double-click `start_workforce360.bat` or run:

```powershell
.\start_workforce360.bat
```

The launcher uses this checkout's `.venv`, backend, frontend `node_modules`, and source database. It reserves backend port 8000 and frontend port 5173 when available; if either is occupied, it binds an available port and prints the actual URLs. The Vite API proxy reads this run's backend URL from `data\run\development\backend.json`. The browser opens at the actual frontend URL after both UI and API health checks pass.

Keep the launcher console open while using the development app. Press Enter there, or run `.\start_workforce360.bat /stop` from another PowerShell window, to stop only this development instance. Runtime state, lock, logs, and stop signal live under `data\run\development`. Development requires backend dependencies in `.venv` and frontend dependencies installed with `npm ci`.

## Open the app from another laptop on the same LAN

Start the app on the server laptop with either `start_workforce360.bat` for development or `run_app.bat` for the portable release. Each launcher prints its actual application URL after it is ready. Open that URL from the second laptop on the same router/LAN; for example, a development run may print `http://192.168.0.102:5173`. The portable app serves its frontend and API on the same port. A hotspot is not needed when both computers are already on the same network.

If Windows Firewall blocks access, allow inbound TCP on the port shown in the printed URL, on the Windows **Private** network profile. For example, if the development URL uses port 5173, run this once in an elevated PowerShell window:

```powershell
New-NetFirewallRule -DisplayName 'ABB Workforce360 LAN' -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow -Profile Private
```

Keep the server launcher running while the app is in use. The server's LAN address can change when DHCP renews; check `ipconfig` if the URL stops working. Do not expose the development server directly to the public internet.

## Portable Windows launcher

This GitHub repository is private, so the first download needs [GitHub CLI](https://cli.github.com/) and an account with repository access. Install GitHub CLI if needed, then authenticate once:

```powershell
gh auth login --hostname github.com --web
gh auth status
```

Double-click the root-level `run_app.bat`. On first use it uses GitHub CLI to download the latest `ABB_Workforce360_Portable_Windows.zip` asset, extracts it to `portable_windows\ABB_Workforce360`, and starts the packaged application. Later runs use that local package without downloading again. An internet connection, GitHub CLI authentication, and a published Release with the asset are required the first time. Development and portable mode use separate code folders, runtime files, logs, locks, processes, dependencies, and data folders.

The portable package includes its own Python runtime, backend dependencies, and built React frontend; Python and Node.js do not need to be installed on the target laptop. Its console verifies API and page readiness, opens the app in the default browser, and stays open. It tries backend port 8000 first and dynamically binds an available port if needed. Close the browser and press Enter in its console, or run `run_app.bat /stop` from the project root, to stop only the portable instance. The launcher prints the actual URL for other laptops on the same LAN; allow that TCP port on the Windows Private firewall profile if needed. Production frontend/API calls use the same origin.

The first launch creates `.env` with local signing, ID-generation, and encryption secrets. Create an administrator after the first launch has initialized this file by opening PowerShell in `portable_windows\ABB_Workforce360` and running `.\runtime\python.exe -m backend.create_admin`. Do not share `.env`. Worker records and uploaded files use the portable folder's own `data` directory; back up `data` and `.env` together. The release ZIP contains only empty runtime folders; it does not include a database, uploaded records, or `.env` secrets.

### Publishing a portable Release

Push the release source and tag, then create and publish a GitHub Release for that tag. The `Publish Workforce360 portable Windows release` workflow runs when the Release is published, builds the frontend, assembles and smoke-checks the Windows package, then attaches `ABB_Workforce360_Portable_Windows.zip` to that same Release. Enable GitHub Actions for the repository before the first Release. The workflow uses the repository's `GITHUB_TOKEN` with `contents: write`; no personal access token is needed. Do not distribute `run_app.bat` until the workflow has completed successfully and the ZIP asset appears on the Release.

## Production build and start

Build the frontend from its directory:

```powershell
Set-Location 'D:\ABB Workforce360\frontend'
npm ci
npm run build
```

The built assets are placed in `frontend\dist`. The FastAPI app serves these assets when that folder exists. For the source checkout, use `start_workforce360.bat` so it manages reserved/dynamic ports, runtime state, frontend readiness, and project-scoped shutdown. For packaged deployment, use the root `run_app.bat` and its Release package. The direct Uvicorn command below is for a local backend-only diagnostic:

```powershell
Set-Location 'D:\ABB Workforce360'
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Do not use `--reload` for production. Do not expose the development server directly or bypass company firewall rules.

## Tests

Install the test-only barcode decoder and run the backend tests from the project directory, then run the frontend test:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-test.txt
.\.venv\Scripts\python.exe -m pytest -q
Set-Location 'D:\ABB Workforce360\frontend'
npm test
```

## Application and security notes

- Worker Nos. are allocated by an SQLite sequence and are unique. Worker IDs use HMAC-SHA-256 over the Worker No. and normalized Aadhaar input. The ID is an identifier, not an authentication credential.
- Aadhaar is encrypted with the configured Fernet key and masked in normal worker API responses. It is never printed on an ID card or included in a barcode.
- Photos must be valid JPG/JPEG files no larger than 200 KB. They are stored on disk; the database stores a relative path.
- ID-card PDFs contain two 85.6 × 54 mm pages: front first, back second. For duplex printing, use landscape orientation and flip on the long edge.
- SQLite itself does not encrypt the database. Protect the database, photo directory, `.env`, encryption key, and backups with approved access controls.
- Confirm Aadhaar collection and retention, authorized users, printing settings, and deployment with the appropriate ABB owners. This project does not claim compliance with ABB policy or Indian law.

## Backup and restore

Back up the SQLite database using its online backup API or another method that accounts for active WAL state. Back up the worker-photo directory and `assets\abb-logo.svg` together with the database. Protect backups as sensitive personal data. Store the encryption key separately under approved key custody. Do not copy only the main database file while the app is running. Stop the service before restoring; restore the database and corresponding photos together, then check health and verify photo and ID-card retrieval. Follow organizational retention and deletion requirements.

## API

- `GET /api/health`
- `POST /api/auth/login` and `POST /api/auth/logout`
- `POST /api/workers`
- `GET /api/workers` and `GET /api/workers/search`
- `GET /api/workers/{worker_id}`
- `PATCH /api/workers/{worker_id}/status`
- `GET /api/workers/{worker_id}/photo`
- `GET /api/workers/{worker_id}/id-card`
- `GET /api/summary`

Worker endpoints require an administrator session. State-changing requests require the CSRF token returned at login.
