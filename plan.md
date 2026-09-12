# Production Deployment Plan — DasCNC on Windows Server (Static IP)

**App:** `das-cnc` (React/Vite client + Express API) + `InvoiceOCR` (FastAPI/PaddleOCR)  
**Target:** On-prem Windows Server with a public/static IP  
**Date:** 2026-09-12  

This plan covers install layout, TLS, firewall, service management, remote admin, backups, and go-live checks. It matches how the code actually runs today.

---

## 0. Reality check — “Windows 2010 Server”

There is **no** Microsoft product named Windows Server 2010. Closest matches:

| Likely OS | Node 20 / modern tooling | Recommendation |
|-----------|--------------------------|----------------|
| Windows Server **2008 R2** (~2009) | **Not supported** by Node 18/20 | Do **not** run this stack natively. Upgrade OS or run a newer guest VM. |
| Windows Server **2012 / 2012 R2** | Fragile / often unsupported by current Node | Prefer upgrade; if stuck, test Node 20 thoroughly or use a newer VM. |
| Windows Server **2016 / 2019 / 2022** | Supported | **Recommended** production host. |

**Minimum practical host for this app:** Windows Server **2016+** (2019/2022 preferred), x64, with outbound HTTPS.

If the physical box must stay on 2008/2012:

1. Install Hyper-V (if licensed) or another hypervisor.
2. Create a **Windows Server 2019/2022** guest VM.
3. Deploy DasCNC + InvoiceOCR inside the guest.
4. NAT/port-forward the static IP to the guest (80/443 only).

Do not try to force Node 20 + PaddleOCR onto an unsupported OS — it will fail at install or crash under load.

---

## 1. What you are deploying

### Components (this monorepo + sibling OCR)

| Component | Source path | Runtime | Default port |
|-----------|-------------|---------|--------------|
| **SPA (client)** | `das-cnc/client` → build to `client/dist` | Static files (IIS) | 443 (HTTPS) |
| **API (server)** | `das-cnc/server` → `node index.js` | Node.js 20 LTS | **3001** (localhost only) |
| **Invoice OCR** | `Python Files/InvoiceOCR` → `uvicorn app.main:app` | Python 3.10 + PaddleOCR CPU | **8000** (localhost only) |
| **Supabase** | Cloud | Postgres + Storage | HTTPS outbound |
| **Tally** (optional) | Local Tally ERP | HTTP XML API | **9000** (LAN / localhost) |
| **Biometric API** | External vendor URL | HTTPS outbound | vendor |

InvoiceOCR is **not** inside `das-cnc`. It lives at:

`E:\Chinmay_Projects\VS Files\Python Files\InvoiceOCR`

Copy that folder (or a release zip) to the server alongside the ERP.

### Architecture (recommended)

```
Internet users
      │
      ▼
[ Windows Firewall ]  allow 443 (and 80→443 redirect) only
      │
      ▼
[ IIS + URL Rewrite + ARR ]  TLS cert on static IP / DNS name
      │
      ├── /           → static site: C:\apps\das-cnc\client\dist
      ├── /api/*      → http://127.0.0.1:3001/api/*
      └── /socket.io/*→ http://127.0.0.1:3001/socket.io/*  (WebSocket)
            │
            ▼
      [ Node API :3001 ] ──HTTPS──► Supabase
            │
            ├──HTTP──► InvoiceOCR 127.0.0.1:8000
            ├──HTTP──► Tally 127.0.0.1:9000 (optional)
            └──HTTPS─► Biometric API (optional)

Remote admins ──VPN or jump host──► RDP / WinRM (never expose RDP on 3389 to the world)
```

**Do not** expose 3001, 8000, or 9000 on the public static IP.

---

## 2. Server sizing (starting point)

| Role | Minimum | Comfortable |
|------|---------|-------------|
| CPU | 4 cores | 8 cores (OCR is CPU-heavy) |
| RAM | 8 GB | **16 GB** (Node ~0.5–1 GB + OCR 4–8 GB + OS/IIS) |
| Disk | 60 GB free | 100+ GB SSD (logs, models, Windows updates) |
| Network | Static IP + outbound HTTPS | Same + DNS A record |

OCR runs **CPU-only** (`paddlepaddle`, `use_gpu=False`). Keep **uvicorn `--workers 1`**.

If RAM ≤ 8 GB, set OCR low-memory mode (see §6).

---

## 3. Prerequisites on the Windows host

Install in this order:

1. **Windows Updates** + reboot.
2. **.NET Framework** (IIS features may need it).
3. **IIS** with:
   - Static Content, Default Document
   - URL Rewrite module
   - Application Request Routing (ARR) + enable proxy
   - WebSocket protocol
4. **Node.js 20 LTS x64** (≥ 20.16 recommended) from nodejs.org.
5. **Python 3.10.x x64** (match `.python-version` → `3.10.14`).
6. **Visual C++ Redistributable x64** (required by Paddle / OpenCV).
7. **NSSM** (Non-Sucking Service Manager) or WinSW — run Node + uvicorn as Windows services.
8. **Git** (optional) or deploy via zip from a build machine.
9. **Win64 OpenSSH Server** or keep RDP behind VPN (see §9).

Verify:

```powershell
node -v          # v20.x
npm -v
py -3.10 --version
```

---

## 4. Folder layout on the server

Use a dedicated non-admin service account, e.g. `svc_dascnc`.

```
C:\apps\
  das-cnc\                 # ERP monorepo release
    client\dist\           # built SPA only (or full repo + dist)
    server\
      .env                 # secrets — ACL locked down
      index.js
      ...
    package.json
    node_modules\
  invoice-ocr\
    app\
    requirements.txt
    .venv\
  logs\
    api\
    ocr\
    iis\
  backups\
    env\
    configs\
  tools\
    nssm\
```

Permissions:

- `svc_dascnc`: Modify on `C:\apps\das-cnc`, `C:\apps\invoice-ocr`, `C:\apps\logs`.
- Deny interactive login for `svc_dascnc` if policy allows.
- `server\.env`: Read for `svc_dascnc` + admins only; no Everyone/Users.

---

## 5. Build & release process

Prefer **build on a modern PC**, copy artifacts to the server (especially if the server is old).

### On build machine (dev PC)

```powershell
cd "E:\Chinmay_Projects\VS Files\das-cnc"
npm ci

# Production client env (create client/.env.production before build)
# VITE_API_URL=https://YOUR_DOMAIN_OR_IP/api
# VITE_SOCKET_URL=https://YOUR_DOMAIN_OR_IP
# VITE_TIMEZONE=Asia/Kolkata

npm run build
```

**Critical:** `VITE_*` vars are baked in at **build time**. Rebuild the client whenever the public URL changes.

**Socket fix:** `client/src/socket/socketContext.jsx` requires `VITE_SOCKET_URL` in production (the fallback `apiUrl` path is currently broken). Always set:

```env
VITE_SOCKET_URL=https://YOUR_DOMAIN_OR_IP
VITE_API_URL=https://YOUR_DOMAIN_OR_IP/api
```

### Copy to server

Copy at least:

- `client/dist/**`
- `server/**` (excluding local `.env` secrets from laptop if different)
- root `package.json`, `package-lock.json`
- Run `npm ci --omit=dev` on server **or** copy `node_modules` from a matching OS/arch build.

Also copy InvoiceOCR source (without local `.venv`) and create venv on the server.

### On server — API deps

```powershell
cd C:\apps\das-cnc
npm ci --omit=dev
```

### On server — OCR venv

```powershell
cd C:\apps\invoice-ocr
py -3.10 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

First OCR start downloads Paddle models to the **service account** profile (`C:\Users\svc_dascnc\.paddleocr\`). Allow outbound HTTPS once, or pre-copy a warmed cache from another machine under the same user path.

---

## 6. Environment configuration

### `C:\apps\das-cnc\server\.env` (template)

```env
# --- Core ---
PORT=3001
FRONTEND_URL=https://YOUR_DOMAIN_OR_IP
TIMEZONE=Asia/Kolkata
JWT_SECRET=REPLACE_WITH_LONG_RANDOM_64_CHARS
JWT_EXPIRES_IN=12h

# --- Supabase (service role — never expose to browser) ---
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_KEY=REPLACE_SERVICE_ROLE_KEY

# --- Device / biometric ---
DEVICE_SECRET=REPLACE_DEVICE_HEADER_SECRET
BIOMETRIC_API_URL=https://vendor.example/api
BIOMETRIC_API_USERNAME=
BIOMETRIC_API_PASSWORD=

# --- Invoice OCR (localhost only) ---
INVOICE_OCR_URL=http://127.0.0.1:8000/parse
INVOICE_OCR_HEALTH_URL=http://127.0.0.1:8000/health
INVOICE_OCR_TIMEOUT_MS=300000

# --- Tally (optional) ---
TALLY_ENABLED=false
TALLY_URL=http://127.0.0.1:9000
TALLY_COMPANY=Exact Company Name In Tally
# TALLY_TIMEOUT_MS=30000
```

Generate secrets:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

### OCR process environment (NSSM / system env)

Full accuracy (needs RAM):

```env
OCR_LOW_MEMORY=false
OCR_VERSION=PP-OCRv4
OCR_DPI=150
OCR_MAX_SIDE=2400
OCR_MAX_PAGES=1
```

Low RAM (≤ 8 GB):

```env
OCR_LOW_MEMORY=true
# or OCR_FAST_MODE=true
```

---

## 7. Run as Windows services (NSSM)

### API service

```powershell
nssm install DasCncApi "C:\Program Files\nodejs\node.exe" "C:\apps\das-cnc\server\index.js"
nssm set DasCncApi AppDirectory "C:\apps\das-cnc\server"
nssm set DasCncApi AppEnvironmentExtra "NODE_ENV=production"
nssm set DasCncApi ObjectName ".\svc_dascnc" "SERVICE_USER_PASSWORD"
nssm set DasCncApi AppStdout "C:\apps\logs\api\stdout.log"
nssm set DasCncApi AppStderr "C:\apps\logs\api\stderr.log"
nssm set DasCncApi AppRotateFiles 1
nssm set DasCncApi AppRotateBytes 10485760
nssm set DasCncApi Start SERVICE_AUTO_START
nssm set DasCncApi AppExit Default Restart
nssm set DasCncApi AppRestartDelay 5000
```

Ensure `.env` is loaded (server already loads `server/.env` via dotenv).

### OCR service

```powershell
nssm install DasCncOcr "C:\apps\invoice-ocr\.venv\Scripts\uvicorn.exe" "app.main:app --host 127.0.0.1 --port 8000 --workers 1"
nssm set DasCncOcr AppDirectory "C:\apps\invoice-ocr"
nssm set DasCncOcr ObjectName ".\svc_dascnc" "SERVICE_USER_PASSWORD"
nssm set DasCncOcr AppStdout "C:\apps\logs\ocr\stdout.log"
nssm set DasCncOcr AppStderr "C:\apps\logs\ocr\stderr.log"
nssm set DasCncOcr AppRotateFiles 1
nssm set DasCncOcr AppRotateBytes 10485760
nssm set DasCncOcr Start SERVICE_AUTO_START
nssm set DasCncOcr AppExit Default Restart
nssm set DasCncOcr AppRestartDelay 10000
```

Bind OCR to **`127.0.0.1`**, not `0.0.0.0`, so it is not reachable from the LAN/internet.

Start order: **OCR → API → IIS**.

```powershell
Start-Service DasCncOcr
Start-Service DasCncApi
iisreset /noforce
```

Smoke:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:3001/health
```

---

## 8. IIS reverse proxy + TLS

### Why IIS

- Terminate HTTPS on the static IP / DNS name.
- Serve SPA from `client/dist`.
- Proxy `/api` and `/socket.io` to Node (WebSockets required for Socket.IO).
- Keep Node/OCR off the public NIC.

### SPA site

1. Create IIS site `DasCnc` → physical path `C:\apps\das-cnc\client\dist`.
2. Bind **HTTPS 443** to the static IP (and hostname if you have DNS).
3. Optional: HTTP 80 site that redirects to HTTPS.
4. Add `web.config` for SPA fallback + proxy (example):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="API" stopProcessing="true">
          <match url="^api/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3001/api/{R:1}" />
        </rule>
        <rule name="SocketIO" stopProcessing="true">
          <match url="^socket.io/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3001/socket.io/{R:1}" />
        </rule>
        <rule name="SPA" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
    <httpProtocol>
      <customHeaders>
        <add name="X-Content-Type-Options" value="nosniff" />
        <add name="X-Frame-Options" value="SAMEORIGIN" />
        <add name="Referrer-Policy" value="strict-origin-when-cross-origin" />
        <!-- After HTTPS works: -->
        <!-- <add name="Strict-Transport-Security" value="max-age=31536000; includeSubDomains" /> -->
      </customHeaders>
    </httpProtocol>
  </system.webServer>
</configuration>
```

Enable ARR proxy:

- IIS → Application Request Routing → Server Proxy Settings → **Enable proxy**.
- Increase timeout for OCR uploads (invoice parse can take minutes) — set proxy timeout ≥ **300 seconds**.

### TLS certificate

| Option | When to use |
|--------|-------------|
| **Let's Encrypt** (win-acme) | You have a **public DNS name** pointing at the static IP |
| **Commercial cert** | Corporate requirement |
| **Self-signed** | Internal-only LAN; browsers will warn — avoid for real users |

Prefer a DNS name (`erp.yourcompany.com` → static IP) over raw IP for certificates and cookies.

If you must use raw IP HTTPS, use a cert that includes the IP (uncommon) or accept that public CAs will not issue easily — DNS name is strongly preferred.

---

## 9. Security hardening (production checklist)

### Network / firewall

**Public inbound (WAN):**

| Port | Action |
|------|--------|
| 443/tcp | Allow (IIS HTTPS) |
| 80/tcp | Allow only for ACME/HTTP→HTTPS |
| 3389, 22, 5985/5986, 3001, 8000, 9000 | **Block** from internet |

**Localhost / loopback:** Node 3001, OCR 8000, Tally 9000.

**Outbound:** HTTPS to Supabase, biometric vendor, Windows Update, (first-time) Paddle model hosts / PyPI.

Prefer placing the server behind a **router firewall / NAT** that only forwards 443.

### Application security (current gaps to close)

The API today has JWT + bcrypt auth, but **no helmet, no rate limiting**, and CORS defaults can be wide. Before go-live:

1. Set `FRONTEND_URL` to the exact public origin (not `*`).
2. Restrict CORS in `server/index.js` to that origin (already partially prepared).
3. Add (recommended code follow-ups, not in this doc’s scope unless you ask):
   - `helmet`
   - rate limit on `/api/auth/login` and OCR upload routes
   - disable FastAPI `/docs` on OCR in production (or bind localhost only — already planned)
4. Never put `SUPABASE_SERVICE_KEY` in the client.
5. Rotate `JWT_SECRET` / `DEVICE_SECRET` if they were ever committed or shared.
6. Protect manual debug route `POST /api/sync/biometric` (auth-gate or disable in prod).

### InvoiceOCR

- No API key in the OCR service today → **must stay on 127.0.0.1**.
- Upload max **25 MB**.
- Do not publish port 8000.

### Windows host

- Dedicated local/domain accounts; no shared Administrator for daily use.
- Disable unused roles/features.
- Enable **Windows Firewall**, **Defender** (or approved AV), real-time protection.
- BitLocker if the chassis is at risk of theft.
- Audit logon events; forward logs if possible.
- Keep the box patched on a monthly cadence (or weekly).

### Supabase

- Confirm Storage buckets (`invoices`, `master-images`, `employee-images`, `photos`) exist.
- Apply SQL from `server/migrations/*.sql` (and any private `supabase/migrations` you maintain) in order on the **production** project.
- Restrict Supabase dashboard access (MFA on owners).
- Note: service role bypasses RLS — API security is your RLS.

---

## 10. Healthy remote management

### Preferred access model

```
Admin laptop → VPN (or ZeroTier / Tailscale / WireGuard) → Server private RDP/WinRM
```

**Never** leave RDP (3389) open to `0.0.0.0/0` on a static IP. That is the #1 way these boxes get ransomware.

### Options (pick one primary)

| Method | Use |
|--------|-----|
| **Site-to-site / SSL VPN** + RDP | Best for factory networks |
| **Tailscale / ZeroTier** | Fast to set up; lock ACL to admin devices only |
| **RD Gateway** | If you already run Microsoft remote stack |
| **OpenSSH** (Admin only, key auth, non-default port, VPN still better) | Scripted deploys |

### Hardening RDP (even on VPN)

- Network Level Authentication (NLA) on.
- Strong passwords / preferably domain accounts + MFA at VPN.
- Account lockout policy.
- Optionally change RDP listen port **and** still keep it off the public internet.
- Restrict which AD/local groups can log on via RDP.

### WinRM / PowerShell remoting

Enable only on the management network:

```powershell
Enable-PSRemoting -Force
# Prefer HTTPS listener + cert; restrict firewall to VPN subnet
```

### Monitoring & health

1. **Scheduled task every 5 minutes** — hit local health endpoints; restart service on failure; append to log.

```powershell
# C:\apps\tools\healthcheck.ps1
$fail = $false
try { Invoke-RestMethod http://127.0.0.1:3001/health -TimeoutSec 10 | Out-Null } catch { $fail = $true; Restart-Service DasCncApi -ErrorAction SilentlyContinue }
try { Invoke-RestMethod http://127.0.0.1:8000/health -TimeoutSec 30 | Out-Null } catch { $fail = $true; Restart-Service DasCncOcr -ErrorAction SilentlyContinue }
if ($fail) { Add-Content C:\apps\logs\health-fail.log "$(Get-Date -Format o) health restart triggered" }
```

2. **External uptime** (UptimeRobot / Better Stack / Hetrix) against `https://YOUR_HOST/health` — requires exposing `/health` through IIS (add a rewrite rule for `^health$` → `http://127.0.0.1:3001/health`).

3. **Disk / RAM alerts** via Performance Monitor + email, or a small script checking free space & service status.

4. **Log rotation** — NSSM rotate + IIS logs; purge `C:\apps\logs` older than 30–90 days.

### Remote updates (safe pattern)

1. VPN in.
2. Stop IIS site (or put maintenance page).
3. Stop `DasCncApi` (OCR can stay up unless OCR code changes).
4. Robocopy new `dist` + `server` files; keep `.env`.
5. `npm ci --omit=dev` if lockfile changed.
6. Start services; smoke `/health`, login, one OCR upload.
7. Keep previous release zip under `C:\apps\backups\releases\YYYYMMDD\` for rollback.

---

## 11. Backups & disaster recovery

| What | How often | Where |
|------|-----------|-------|
| `server\.env` (encrypted) | On every change | Offline USB / password manager + encrypted zip |
| IIS `web.config`, NSSM exports | On every change | `C:\apps\backups\configs` + offsite |
| App release zip | Each deploy | Offsite |
| Supabase | Daily (Supabase backups / PITR if paid) | Supabase dashboard |
| Windows System State / full image | Weekly | External drive / NAS |
| Paddle model cache (optional) | After first warm-up | Speeds rebuilds |

Test restore once before go-live.

Tally data is separate — follow your existing Tally backup SOP if `TALLY_ENABLED=true`.

---

## 12. Database / storage go-live

1. Create or select **production** Supabase project (do not reuse a dirty shared-dev project if avoidable).
2. Apply migrations in chronological order from `server/migrations/`.
3. Verify buckets + policies.
4. Create at least one admin employee login; verify bcrypt path works.
5. Confirm cron jobs on the API (attendance, alerts, etc.) use `TIMEZONE=Asia/Kolkata` and that the Windows clock/NTP is correct.

---

## 13. Tally & biometric (optional)

### Tally

- Install Tally on the **same LAN** (often same server or accounting PC).
- Enable Tally HTTP/XML on port 9000; company name must match `TALLY_COMPANY` exactly.
- Firewall: allow 9000 only from the API host IP.
- Set `TALLY_ENABLED=true` only after a test voucher sync.

### Biometric

- Confirm vendor API reachable from the server (outbound).
- Set Basic auth env vars.
- Test `POST /api/sync/biometric` once from an authenticated admin session (or temporarily from localhost), then lock the route down.

---

## 14. Go-live checklist

### Pre-flight

- [ ] OS is 2016+ (or newer guest VM)
- [ ] Node 20 + Python 3.10 + VC++ redist installed
- [ ] `svc_dascnc` created; `.env` ACLs tight
- [ ] Client rebuilt with `VITE_API_URL` + `VITE_SOCKET_URL`
- [ ] NSSM services auto-start; OCR on `127.0.0.1:8000`
- [ ] IIS HTTPS + ARR timeouts ≥ 300s; WebSockets on
- [ ] WAN firewall: only 443 (and 80 redirect)
- [ ] RDP/SSH not on public internet; VPN works
- [ ] Supabase migrations + buckets done
- [ ] Health scripts + external uptime configured
- [ ] Backup of `.env` and release zip stored off-box

### Functional tests

- [ ] `GET https://HOST/health` → `{ status: "ok" }`
- [ ] Login works; JWT stored; protected pages load
- [ ] Socket.IO connects (production board / live updates)
- [ ] Upload employee/master image
- [ ] Invoice OCR upload → review page fields populated
- [ ] GIRN extract-invoice path (if used)
- [ ] Cron: wait for a scheduled tick or trigger sync manually
- [ ] Tally ping (if enabled)
- [ ] Reboot server → services come back without login

### Rollback

1. Stop API (+ IIS if needed).
2. Restore previous `client\dist` + `server` from `C:\apps\backups\releases\...`.
3. Restore `.env` if changed.
4. Start services; verify health.

---

## 15. Suggested deployment timeline

| Day | Work |
|-----|------|
| **D1** | Confirm OS viability; patch; create service account; install Node/Python/IIS/NSSM |
| **D2** | Deploy OCR; warm models; health OK |
| **D3** | Deploy API + `.env`; local health; Supabase migrations |
| **D4** | Build SPA; IIS site + TLS; proxy `/api` + `/socket.io` |
| **D5** | Firewall lockdown; VPN/remote admin; health monitors |
| **D6** | UAT with real users (login, production board, invoice OCR) |
| **D7** | Backups tested; cutover; watch logs 48h |

---

## 16. Known product notes (fix before prod)

1. **`VITE_SOCKET_URL` is mandatory** in production builds (`socketContext.jsx`).
2. **README port is wrong** — API listens on **3001**, not 3000.
3. **`server/.env.example` is incomplete** — use the full template in §6.
4. **OCR `/docs`** is open if the port is reachable — bind localhost only.
5. **No Docker** in-repo; this plan is native Windows services + IIS.
6. Prior Render URLs in comments (`das-cnc.onrender.com`, `invoiceocr-c7ah.onrender.com`) are **dev/legacy**; production should use your static IP/DNS + local OCR.

---

## 17. Post-deploy improvements (recommended backlog)

These are not required to boot, but strengthen production:

1. Add `helmet`, login rate limiting, request size limits on Express.
2. Auth-protect or remove public debug sync endpoints.
3. Serve SPA from Express *or* keep IIS — but document one official path.
4. Structured logging (e.g. rotate + ship to a file share).
5. Disable InvoiceOCR OpenAPI docs via env flag.
6. Pin Node/Python versions in an `engines` / deploy readme.
7. Automate release with a PowerShell `deploy.ps1` (stop → robocopy → start → health).

---

## 18. Quick command cheat sheet

```powershell
# Status
Get-Service DasCncApi, DasCncOcr
Invoke-RestMethod http://127.0.0.1:3001/health
Invoke-RestMethod http://127.0.0.1:8000/health

# Restart
Restart-Service DasCncOcr
Restart-Service DasCncApi

# Logs
Get-Content C:\apps\logs\api\stderr.log -Tail 100
Get-Content C:\apps\logs\ocr\stderr.log -Tail 100
```

---

## Summary

Deploy as **three layers on one hardened Windows host (2016+)**: IIS terminates TLS and serves the SPA; Node API and InvoiceOCR run as **localhost-only** auto-restart services; data stays in **Supabase**. Lock the static IP to **443**, manage the box over **VPN**, monitor `/health`, and treat `.env` + release zips as first-class backups. If the machine is truly Server 2008-era, put a **newer Windows Server VM** in front of the same static IP rather than running this stack on the old host OS.
