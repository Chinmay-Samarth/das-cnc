# DasCNC Production Plan — New Server (Full Guide)

**What this document is:** the complete plan to put DasCNC live for your company.  
**What this document is not:** a guide to force production onto the current weak Windows Server 2016 box.

---

## Read this first (honest status)

Your current 2016 server (~**4 cores / 8 GB RAM / ~10 GB free disk**) is **not suitable for production** of this stack:

| Need | Why | Current box |
|------|-----|-------------|
| Disk | Node modules, Python/PaddleOCR, IIS logs, Windows updates | ~10 GB free → will fill and break |
| RAM | API + PaddleOCR + Windows + IIS | 8 GB → OCR will thrash/swap |
| CPU | OCR is CPU-heavy | 4 cores → usable only if nothing else competes |
| UX | You already see lag over RDP | Same machine can’t also run OCR well |

**Decision:** company procures a **new server** that meets the specs below.  
Until then, do the **prep work on your laptop / GitHub / Supabase** (Phase A).  
When the new machine arrives, follow **Phase B onward** step by step.

You will always see:

- **What to do** — exact action  
- **Why** — so you understand the purpose  
- **Checkpoint** — prove it worked before moving on  

---

# PART 0 — What you are deploying (the big picture)

## The three pieces of software

| Piece | Where the code lives today | What it does in production |
|-------|----------------------------|----------------------------|
| **Website (client)** | `das-cnc/client` | React UI users open in a browser |
| **API (server)** | `das-cnc/server` | Express + Socket.IO; auth, business logic, crons |
| **Invoice OCR** | `Python Files/InvoiceOCR` (separate folder) | Reads invoice PDFs with PaddleOCR; returns fields |

## What runs where

```
Users' browsers
      │
      │  HTTPS only (port 443)
      ▼
[ New Windows Server ]
      │
      ├── IIS  → serves website files (client/dist)
      │         and forwards /api + /socket.io to Node
      │
      ├── Node API on 127.0.0.1:3001   ← not public
      │       │
      │       ├── talks to Supabase (cloud database + file storage)
      │       ├── talks to Invoice OCR on 127.0.0.1:8000
      │       └── optional: Tally, biometric API
      │
      └── Python OCR on 127.0.0.1:8000  ← not public

You (admin)
      │
      └── Remote Desktop into the new server (locked down)
           to install, configure, and run deploy scripts
```

## Why this layout?

| Choice | Why |
|--------|-----|
| **IIS in front** | Handles HTTPS certificates and serves static files well on Windows |
| **Node/OCR on localhost only** | Attackers on the internet never talk to them directly |
| **Supabase in the cloud** | You don’t run Postgres yourself on this server; less ops burden |
| **GitHub + deploy script** | You push code from your laptop; server pulls and rebuilds — no USB zips |
| **RDP for admin** | Matches how you already work; we harden it so the static IP isn’t an open door |

## Ports (memorize this)

| Port | Service | Public? |
|------|---------|---------|
| **443** | HTTPS website | **Yes** |
| **80** | HTTP → redirect / cert renewals | Yes (limited) |
| **3001** | Node API | **No** — localhost only |
| **8000** | Invoice OCR | **No** — localhost only |
| **3389** | Remote Desktop | **Not to the whole internet** — VPN or your IP only |
| **9000** | Tally (optional) | LAN/localhost only |

---

# PART 1 — Buy / specify the new server

Give this table to whoever procures hardware (IT / vendor / management).

## Minimum vs recommended

| Item | Minimum (works) | Recommended (comfortable) | Why |
|------|-----------------|---------------------------|-----|
| **OS** | Windows Server **2019** or **2022** Standard | **2022** | 2016 is OK technically, but newer is smoother for Node 20 + drivers + support life |
| **CPU** | 4 cores | **8 cores** | OCR uses many cores while invoices parse |
| **RAM** | 16 GB | **32 GB** | Windows + IIS + Node (~1 GB) + OCR (4–8 GB spikes) |
| **System disk** | 256 GB SSD | **512 GB SSD** | OS + apps + logs + updates; 10 GB free is why the old box fails |
| **Network** | 1 static public IP (or NAT to one) | Same + DNS name (`erp.company.com`) | Users and TLS certificates need a stable address |
| **Backup** | External disk or NAS | Same + offsite copy | Recovery after failure/ransomware |
| **Access** | RDP available to you | RDP + optional VPN (Tailscale/company VPN) | Safe remote management |

### Software licenses / accounts you also need

| Item | Why |
|------|-----|
| Windows Server license | OS |
| Ability to install IIS roles | Front door for HTTPS |
| GitHub account + repos | Source of truth for code |
| Supabase project (production) | Database + file storage |
| Domain DNS control (preferred) | Proper HTTPS certificate (Let’s Encrypt) |

### Explicitly do **not** run production on

- The current 2016 box with ~10 GB free  
- A laptop left on overnight  
- A machine without backups  

**Checkpoint — procurement**

- [ ] New server ordered/approved with ≥16 GB RAM and ≥256 GB SSD  
- [ ] Static IP / DNS plan known  
- [ ] You will have Administrator + Remote Desktop access  

---

# PART 2 — Work you can do NOW (while waiting for hardware)

Do these on your **laptop**. They save days later and don’t need the new server.

---

## Phase A1 — Understand and clean your Git setup

### A1.1 — Make sure both apps are on GitHub

**What:** Push `das-cnc` and `InvoiceOCR` to GitHub if not already.

**Why:** The new server will **clone/pull** from GitHub. GitHub is the bridge between your laptop and production. Secrets must never live in Git.

```powershell
# On your laptop — ERP
cd "E:\Chinmay_Projects\VS Files\das-cnc"
git remote -v
git status

# Invoice OCR
cd "E:\Chinmay_Projects\VS Files\Python Files\InvoiceOCR"
git status
# If it is not a git repo yet: git init, create GitHub repo, add remote, commit, push
```

### A1.2 — Create a `production` branch

**What:** A branch that means “this is what production is allowed to run.”

**Why:** You can keep experimenting on `main` without accidentally shipping half-finished work. Production only tracks `production`.

```powershell
cd "E:\Chinmay_Projects\VS Files\das-cnc"
git checkout main
git pull
git checkout -b production
git push -u origin production

cd "E:\Chinmay_Projects\VS Files\Python Files\InvoiceOCR"
git checkout -b production
git push -u origin production
```

On GitHub → repo → **Settings → Branches**: protect `production` if you can (limit who can push).

### A1.3 — Confirm secrets are ignored by Git

**What:** Ensure `.env` files are not tracked.

**Why:** `SUPABASE_SERVICE_KEY` can read/write your whole database. If it hits GitHub, treat it as leaked and rotate it.

```powershell
cd "E:\Chinmay_Projects\VS Files\das-cnc"
git check-ignore -v server/.env
git check-ignore -v client/.env.production
# Both should print an ignore rule. If not, add them to .gitignore now.
```

**Checkpoint A1**

- [ ] Both repos on GitHub  
- [ ] `production` branch exists on both  
- [ ] `.env` files are ignored  

---

## Phase A2 — Inventory your production secrets (write them down safely)

**What:** Collect every value production will need into a password manager or encrypted note (not WhatsApp, not a plain git file).

**Why:** On go-live day you will paste these into `server\.env` on the new server. Missing one value = login/OCR/sync fails and you’ll be debugging under pressure.

### Server env values you will need

| Variable | What it is | Why |
|----------|------------|-----|
| `SUPABASE_URL` | Your Supabase project URL | Where the API stores data |
| `SUPABASE_SERVICE_KEY` | Service role key | Server bypasses RLS — **never** put in the browser |
| `JWT_SECRET` | Long random string | Signs login tokens |
| `FRONTEND_URL` | Exact public site URL | CORS / Socket origin |
| `DEVICE_SECRET` | Shared secret for biometric devices | Device posts attendance |
| `BIOMETRIC_*` | Vendor API URL + user + password | Punch sync (if used) |
| `INVOICE_OCR_URL` | Usually `http://127.0.0.1:8000/parse` | API finds OCR on same machine |
| `TALLY_*` | Optional Tally URL + company name | Accounting sync |

### Client build values (baked into the website at build time)

| Variable | Example | Why |
|----------|---------|-----|
| `VITE_API_URL` | `https://erp.company.com/api` | Browser calls the API |
| `VITE_SOCKET_URL` | `https://erp.company.com` | Live updates (Socket.IO) — **required** in production |
| `VITE_TIMEZONE` | `Asia/Kolkata` | Date/time display |

Generate a strong secret when ready:

```powershell
-join ((48..57 + 65..90 + 97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
```

**Checkpoint A2**

- [ ] Secrets list complete in a password manager  
- [ ] You know the intended public URL (DNS name preferred over raw IP)  

---

## Phase A3 — Prepare Supabase for production

**What:** Decide which Supabase project is **production** (ideally not the messy shared-dev one).

**Why:** Production data should not be wiped by a test migration. Buckets must exist or uploads fail.

1. Create or pick production project in Supabase.  
2. Note URL + service role key into your secrets list.  
3. Confirm storage buckets exist (or plan to create them):  
   `invoices`, `master-images`, `employee-images`, `photos`  
4. List SQL files you must apply in order from `das-cnc/server/migrations/` (oldest date first). Keep that checklist.

**Checkpoint A3**

- [ ] Production Supabase project identified  
- [ ] Migration file list ordered  
- [ ] Bucket names known  

---

## Phase A4 — Optional: dry-run build on your laptop

**What:** Build the client once with temporary production-like URLs.

**Why:** Catches build errors now, not on go-live night.

```powershell
cd "E:\Chinmay_Projects\VS Files\das-cnc"
npm ci
# Temporarily set client/.env.production with your future URL, then:
npm run build
```

You do **not** commit `client/dist`. The **new server** will build again with the real `.env.production`.

**Checkpoint A4**

- [ ] `npm run build` succeeds on your laptop  

---

# PART 3 — When the new server arrives

Fill these in on day one:

| Placeholder | Your value |
|-------------|------------|
| `STATIC_IP` | |
| `PUBLIC_URL` | e.g. `https://erp.yourcompany.com` |
| `GITHUB_ORG_OR_USER` | |
| `DASCNC_REPO` | e.g. `das-cnc` |
| `OCR_REPO` | e.g. `invoice-ocr` |
| `YOUR_RDP_SOURCE_IP` | your office/home public IP (whatismyip.com) |

Connect with **Remote Desktop** as Administrator. Every step below that does not say “On your laptop” is done **inside that RDP session**.

---

## Phase B — Base Windows setup

### B1 — Patch the OS

**What:** Install Windows Updates → reboot → repeat until clean.

**Why:** Unpatched servers get exploited. TLS and IIS also behave better on updated boxes.

### B2 — Set timezone

**What:**

```powershell
tzutil /s "India Standard Time"
```

**Why:** Your API crons (attendance, alerts) use `TIMEZONE=Asia/Kolkata`. Wrong OS time = wrong “who is absent” logic.

### B3 — Create folder layout

**What:**

```powershell
New-Item -ItemType Directory -Force -Path @(
  "C:\apps\das-cnc",
  "C:\apps\invoice-ocr",
  "C:\apps\logs\api",
  "C:\apps\logs\ocr",
  "C:\apps\logs\deploy",
  "C:\apps\backups\env",
  "C:\apps\backups\releases",
  "C:\apps\tools"
) | Out-Null
```

**Why:** One predictable place for app, logs, backups, and scripts. Makes support and handoff easier.

### B4 — Create accounts

**What:**

```powershell
net user svc_dascnc "STRONG_PASSWORD_HERE" /add /fullname:no /expires:never
net localgroup "Users" svc_dascnc /add

net user deploy "STRONG_DEPLOY_PASSWORD" /add /expires:never
net localgroup "Administrators" deploy /add

icacls "C:\apps\das-cnc" /grant "svc_dascnc:(OI)(CI)M" /T
icacls "C:\apps\invoice-ocr" /grant "svc_dascnc:(OI)(CI)M" /T
icacls "C:\apps\logs" /grant "svc_dascnc:(OI)(CI)M" /T
```

Also: `secpol.msc` → **User Rights Assignment** → **Log on as a service** → add `svc_dascnc`.

**Why:**

- `svc_dascnc` runs Node/OCR — not your daily admin account  
- `deploy` is who you RDP as to pull Git and restart services  
- “Log on as a service” is required or Windows services fail to start  

**Checkpoint B**

- [ ] Updated + rebooted  
- [ ] IST timezone  
- [ ] Folders + `svc_dascnc` + `deploy` ready  

---

## Phase C — Install required software (order matters)

### C1 — IIS + WebSockets

**What:**

```powershell
Install-WindowsFeature Web-Server, Web-Common-Http, Web-Static-Content, Web-Default-Doc, Web-Dir-Browsing, Web-Http-Errors, Web-Http-Redirect, Web-Filtering, Web-Stat-Compression, Web-Mgmt-Console, Web-WebSockets -IncludeManagementTools
```

**Why:** IIS is the public HTTPS entry. WebSockets are required for Socket.IO live updates through IIS.

### C2 — URL Rewrite + Application Request Routing (ARR)

**What:** Download/install from Microsoft iis.net:

1. URL Rewrite 2.x  
2. ARR 3.x  
3. IIS Manager → server node → **ARR → Server Proxy Settings** → **Enable proxy**  
4. Set proxy **timeout = 300 seconds**

**Why:** Browser calls `https://yoursite/api/...`. IIS must **forward** that to `http://127.0.0.1:3001`. OCR uploads can take minutes — short timeouts look like “OCR is broken.”

### C3 — Node.js 20 LTS (x64 MSI)

**What:** Install from nodejs.org → reopen PowerShell → `node -v` shows `v20.x`.

**Why:** Your API and tooling expect modern Node (`@supabase/supabase-js`, Vite build). Older Node will fail installs.

### C4 — Python 3.10 (x64)

**What:** Install 3.10.x with PATH enabled → `py -3.10 --version`.

**Why:** InvoiceOCR is pinned around Python 3.10 (`paddlepaddle` stack). Other versions often break wheels.

### C5 — Visual C++ Redistributable x64

**What:** Install latest VC++ redist from Microsoft.

**Why:** PaddleOCR/OpenCV native libraries won’t load without it.

### C6 — Git for Windows

**What:** Install → `git --version`.

**Why:** Production updates are `git pull` based.

### C7 — NSSM

**What:** Unzip to `C:\apps\tools\nssm\` (use `win64\nssm.exe`).

**Why:** Turns `node` and `uvicorn` into Windows services that **auto-start after reboot** and restart on crash — you shouldn’t rely on a logged-in RDP window.

### C8 — OpenSSH? Skip for now

**Why:** You use **Remote Desktop**. SSH is optional later for one-line remote scripts. Skipping reduces attack surface.

**Checkpoint C**

```powershell
node -v; npm -v; py -3.10 --version; git --version
Get-WindowsFeature Web-Server | Select InstallState
```

- [ ] All installed  
- [ ] ARR proxy enabled, timeout 300  

---

## Phase D — Clone code from GitHub

### D1 — Deploy key (read-only)

**What:** As user `deploy`:

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\dascnc_deploy -N '""'
Get-Content $env:USERPROFILE\.ssh\dascnc_deploy.pub
```

Add that public key in GitHub → repo → **Settings → Deploy keys** (read-only) for `das-cnc` and `invoice-ocr`.

`C:\Users\deploy\.ssh\config`:

```
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/dascnc_deploy
  IdentitiesOnly yes
```

Test: `ssh -T git@github.com`

**Why:** Server can pull code without your personal password. Read-only means a compromised server can’t push malware into GitHub.

### D2 — Clone `production` branch

```powershell
Remove-Item -Recurse -Force C:\apps\das-cnc, C:\apps\invoice-ocr -ErrorAction SilentlyContinue
git clone -b production git@github.com:GITHUB_ORG_OR_USER/DASCNC_REPO.git C:\apps\das-cnc
git clone -b production git@github.com:GITHUB_ORG_OR_USER/OCR_REPO.git C:\apps\invoice-ocr

icacls "C:\apps\das-cnc" /grant "svc_dascnc:(OI)(CI)M" /T
icacls "C:\apps\invoice-ocr" /grant "svc_dascnc:(OI)(CI)M" /T
```

**Why:** Live code lives under `C:\apps\...` as a real git checkout so deploys are `fetch` + `reset` + build.

**Checkpoint D**

- [ ] Both clones on `production`  
- [ ] `ssh -T git@github.com` works from the server (outbound HTTPS/SSH allowed)  

---

## Phase E — Secrets on the server (never in Git)

### E1 — `C:\apps\das-cnc\server\.env`

**What:** Create with Notepad; paste real values from your password manager (Phase A2).

```env
PORT=3001
FRONTEND_URL=https://YOUR_PUBLIC_HOST
TIMEZONE=Asia/Kolkata
JWT_SECRET=LONG_RANDOM
JWT_EXPIRES_IN=12h

SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

DEVICE_SECRET=LONG_RANDOM
BIOMETRIC_API_URL=
BIOMETRIC_API_USERNAME=
BIOMETRIC_API_PASSWORD=

INVOICE_OCR_URL=http://127.0.0.1:8000/parse
INVOICE_OCR_HEALTH_URL=http://127.0.0.1:8000/health
INVOICE_OCR_TIMEOUT_MS=300000

TALLY_ENABLED=false
TALLY_URL=http://127.0.0.1:9000
TALLY_COMPANY=
```

Lock ACL + backup:

```powershell
icacls "C:\apps\das-cnc\server\.env" /inheritance:r
icacls "C:\apps\das-cnc\server\.env" /grant:r "Administrators:F" "deploy:F" "svc_dascnc:R"
Copy-Item C:\apps\das-cnc\server\.env C:\apps\backups\env\server.env.backup
# Copy encrypted backup off the server (USB / password manager)
```

**Why:** The API reads this on start. Wrong `FRONTEND_URL` breaks browser CORS. Missing Supabase key = total failure. Backup saves you if the disk dies.

### E2 — `C:\apps\das-cnc\client\.env.production`

```env
VITE_API_URL=https://YOUR_PUBLIC_HOST/api
VITE_SOCKET_URL=https://YOUR_PUBLIC_HOST
VITE_TIMEZONE=Asia/Kolkata
```

**Why:** Vite **bakes** these into JS at build time. If you build with localhost URLs, production browsers will call your laptop. `VITE_SOCKET_URL` is required — without it live production boards break.

**Checkpoint E**

- [ ] Both env files exist, locked, backed up off-box  
- [ ] URLs match the real public hostname  

---

## Phase F — Install and test Invoice OCR by hand

### F1 — Python venv + packages

```powershell
cd C:\apps\invoice-ocr
py -3.10 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

**Why:** Isolates OCR deps. First install is large; needs internet. On **16 GB+ RAM** leave defaults. Only if you were stuck on 8 GB would you set `OCR_LOW_MEMORY=true` (you should not be — new server has ≥16 GB).

### F2 — Manual start test

```powershell
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Second window: `Invoke-RestMethod http://127.0.0.1:8000/health`

**Why:**

- `127.0.0.1` = not reachable from internet  
- `--workers 1` = OCR models are heavy; more workers multiply RAM and fight each other  
- First start may download models into the user profile (`.paddleocr`) — needs outbound HTTPS once  

Stop with Ctrl+C when healthy.

**Checkpoint F**

- [ ] Health OK  
- [ ] Models downloaded (or you know they’ll download under `svc_dascnc` when the service starts)  

---

## Phase G — Install API + build website by hand

### G1 — Dependencies + build

```powershell
cd C:\apps\das-cnc
npm ci --omit=dev
npm run build
dir .\client\dist
```

**Why:** `npm ci` uses the lockfile for reproducible installs. `build` creates static files IIS will serve.

### G2 — Manual API test

```powershell
cd C:\apps\das-cnc\server
node index.js
```

Other window: `Invoke-RestMethod http://127.0.0.1:3001/health`

**Why:** Proves `.env` loads and the process listens before you wrap it in a service (easier to read errors in the console).

**Checkpoint G**

- [ ] `client\dist\index.html` exists  
- [ ] `/health` returns ok  

---

## Phase H — Windows services (survive reboot)

### H1 — OCR service (NSSM)

```powershell
$nssm = "C:\apps\tools\nssm\win64\nssm.exe"
& $nssm install DasCncOcr "C:\apps\invoice-ocr\.venv\Scripts\uvicorn.exe" "app.main:app --host 127.0.0.1 --port 8000 --workers 1"
& $nssm set DasCncOcr AppDirectory "C:\apps\invoice-ocr"
& $nssm set DasCncOcr ObjectName ".\svc_dascnc" "SVC_PASSWORD"
& $nssm set DasCncOcr AppStdout "C:\apps\logs\ocr\stdout.log"
& $nssm set DasCncOcr AppStderr "C:\apps\logs\ocr\stderr.log"
& $nssm set DasCncOcr AppRotateFiles 1
& $nssm set DasCncOcr AppRotateBytes 10485760
& $nssm set DasCncOcr Start SERVICE_AUTO_START
& $nssm set DasCncOcr AppExit Default Restart
& $nssm set DasCncOcr AppRestartDelay 10000
Start-Service DasCncOcr
```

### H2 — API service (NSSM)

```powershell
$nssm = "C:\apps\tools\nssm\win64\nssm.exe"
& $nssm install DasCncApi "C:\Program Files\nodejs\node.exe" "C:\apps\das-cnc\server\index.js"
& $nssm set DasCncApi AppDirectory "C:\apps\das-cnc\server"
& $nssm set DasCncApi ObjectName ".\svc_dascnc" "SVC_PASSWORD"
& $nssm set DasCncApi AppStdout "C:\apps\logs\api\stdout.log"
& $nssm set DasCncApi AppStderr "C:\apps\logs\api\stderr.log"
& $nssm set DasCncApi AppRotateFiles 1
& $nssm set DasCncApi AppRotateBytes 10485760
& $nssm set DasCncApi Start SERVICE_AUTO_START
& $nssm set DasCncApi AppExit Default Restart
& $nssm set DasCncApi AppRestartDelay 5000
& $nssm set DasCncApi AppEnvironmentExtra "NODE_ENV=production"
Start-Service DasCncApi
```

### H3 — Reboot test

```powershell
Restart-Computer
# After reboot (no login needed for services):
Get-Service DasCncApi, DasCncOcr
Invoke-RestMethod http://127.0.0.1:3001/health
Invoke-RestMethod http://127.0.0.1:8000/health
```

**Why:** Production must come back after power loss without you RDPing in to click “start.”

**Checkpoint H**

- [ ] Both services Running after reboot  
- [ ] Both health endpoints OK  

---

## Phase I — IIS website + HTTPS

### I1 — DNS (strongly preferred)

**What:** Create `erp.yourcompany.com` → A record → `STATIC_IP`.

**Why:** Let’s Encrypt and browsers work cleanly with names. Raw IPs are painful for certificates.

### I2 — Create the IIS site

Point physical path to `C:\apps\das-cnc\client\dist`, bind HTTP 80 on the server IP (GUI or PowerShell).

**Why:** Users hit IIS; IIS serves the built React files.

### I3 — `web.config` (SPA + reverse proxy)

Save master copy at `C:\apps\tools\web.config` and copy into `dist` (builds wipe `dist`):

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
        <rule name="Health" stopProcessing="true">
          <match url="^health$" />
          <action type="Rewrite" url="http://127.0.0.1:3001/health" />
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
      </customHeaders>
    </httpProtocol>
    <security>
      <requestFiltering>
        <requestLimits maxAllowedContentLength="26214400" />
      </requestFiltering>
    </security>
  </system.webServer>
</configuration>
```

**Why:**

- `/api` and `/socket.io` → Node  
- Other routes → `index.html` (React Router)  
- 25 MB upload limit aligns with OCR  
- Security headers are basic hardening  

### I4 — TLS certificate

**What:** Use win-acme (Let’s Encrypt) for your DNS name, bind HTTPS 443 on the IIS site, redirect HTTP→HTTPS.

**Why:** Login tokens and business data must not travel in clear text. Browsers also warn on plain HTTP.

If `PUBLIC_URL` changed, update `.env` files and rebuild (Phase K).

**Checkpoint I**

- [ ] `https://PUBLIC_URL` shows login  
- [ ] `https://PUBLIC_URL/health` returns ok  
- [ ] Browser Network tab calls `/api/...` on the same host (not `localhost:3001`)  

---

## Phase J — Firewall + harden Remote Desktop

### J1 — Public web ports only

```powershell
New-NetFirewallRule -DisplayName "DasCnc HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
New-NetFirewallRule -DisplayName "DasCnc HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

Router/NAT: forward **80/443** only for the website. Do **not** forward 3001 or 8000.

**Why:** Shrink the attack surface to “just the website.”

### J2 — RDP lockdown (you use RDP — this matters)

**What — pick one:**

1. **Best:** Tailscale/company VPN on laptop + server → RDP to VPN IP → **do not** port-forward 3389 on the router.  
2. **OK:** Port-forward 3389 but firewall-allow **only** `YOUR_RDP_SOURCE_IP`.  
3. **On-site only:** no 3389 forward; RDP only on LAN.

Also enable **NLA** (`SystemPropertiesRemote`).

```powershell
# Example for option 2
New-NetFirewallRule -DisplayName "RDP from my PC only" `
  -Direction Inbound -Protocol TCP -LocalPort 3389 `
  -RemoteAddress YOUR_RDP_SOURCE_IP -Action Allow

net accounts /lockoutthreshold:5 /lockoutduration:30 /lockoutwindow:30
```

**Why:** Open RDP on a public static IP is a top ransomware path. You still get convenient Remote Desktop — just not for the entire internet.

### J3 — Outside test (phone mobile data)

- Site HTTPS works  
- `:3001` and `:8000` fail from outside  
- Random-network RDP fails  
- Your chosen RDP path still works  

**Checkpoint J**

- [ ] Website public; API/OCR private  
- [ ] RDP not open to the world  
- [ ] You can still RDP in  

---

## Phase K — Everyday Git deploy (laptop + RDP)

### K1 — Deploy script on the server

Save `C:\apps\tools\deploy-das-cnc.ps1`:

```powershell
#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$AppRoot = "C:\apps\das-cnc"
$LogDir  = "C:\apps\logs\deploy"
$Stamp   = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force $LogDir | Out-Null
Start-Transcript -Path "$LogDir\das-cnc-$Stamp.log"
try {
  Set-Location $AppRoot
  if (-not (Test-Path ".\server\.env")) { throw "Missing server\.env" }
  if (-not (Test-Path ".\client\.env.production")) { throw "Missing client\.env.production" }

  if (Test-Path ".\client\dist") {
    $bak = "C:\apps\backups\releases\dist-$Stamp"
    New-Item -ItemType Directory -Force $bak | Out-Null
    Copy-Item -Recurse ".\client\dist\*" $bak
  }

  git fetch origin production
  git checkout production
  git reset --hard origin/production
  npm ci --omit=dev
  npm run build
  Copy-Item "C:\apps\tools\web.config" ".\client\dist\web.config" -Force
  Restart-Service DasCncApi -Force
  Start-Sleep 4
  Invoke-RestMethod http://127.0.0.1:3001/health -TimeoutSec 20
  Write-Host "DEPLOY OK $Stamp"
}
catch { Write-Error $_; exit 1 }
finally { Stop-Transcript }
```

OCR: `C:\apps\tools\deploy-invoice-ocr.ps1` — fetch/reset, `pip install -r requirements.txt`, restart `DasCncOcr`, hit `/health`.

`Set-ExecutionPolicy RemoteSigned -Scope LocalMachine`

**Why:** One script = same steps every time (pull, install, build, restore `web.config`, restart, health check). Less human error.

### K2 — Your release ritual

**Laptop:**

```powershell
cd "E:\Chinmay_Projects\VS Files\das-cnc"
git checkout production
git merge main
git push origin production
```

**RDP into server → PowerShell:**

```powershell
powershell -File C:\apps\tools\deploy-das-cnc.ps1
```

**Why:** Laptop never needs direct file copy of the app. GitHub stores the version; RDP only runs the script and lets you watch logs if it fails.

### K3 — Rollback

On server via RDP: `git log`, `git reset --hard GOOD_COMMIT`, rebuild, copy `web.config`, restart API.

**Checkpoint K**

- [ ] One full push → RDP → deploy cycle works  
- [ ] Rollback practiced once  

---

## Phase L — Data go-live, monitoring, backups

### L1 — Apply Supabase migrations + buckets

**Why:** Code expects columns/tables/buckets that migrations create. Skipping = random 500 errors.

### L2 — Create admin user and test

Login, Socket.IO live page, image upload, one invoice OCR.

### L3 — Health task every 5 minutes

Script hits local `/health` and restarts services on failure. Optional: UptimeRobot on `https://PUBLIC_URL/health`.

**Why:** You notice outages before users call you.

### L4 — Backups

| What | When |
|------|------|
| `.env` files (encrypted) | Every change |
| Git tags on releases | Every production ship |
| Disk/image backup | Weekly |
| Supabase backups | Per plan in dashboard |

**Checkpoint L**

- [ ] Real user flows work  
- [ ] Monitoring on  
- [ ] Secrets backed up off-box  

---

## Phase M — Optional later (Tally / biometric)

Only after core ERP is stable. Enable Tally/biometric env vars, restart API, test once. Keep those ports off the public internet.

---

# PART 4 — Final go-live checklist

### Hardware / OS

- [ ] New server (not the 10 GB 2016 box)  
- [ ] ≥16 GB RAM, ≥256 GB SSD free headroom  
- [ ] Patched Windows Server 2019/2022 (or solid 2016 if that’s what was bought — still OK if sized right)  

### App

- [ ] `DasCncApi` + `DasCncOcr` auto-start after reboot  
- [ ] HTTPS site works  
- [ ] Login + sockets + OCR + uploads work  
- [ ] 3001/8000 not public  

### Access

- [ ] RDP locked (VPN or IP allowlist + NLA)  
- [ ] Deploy ritual documented for a second person  

### Ops

- [ ] Health monitor green  
- [ ] Backup of secrets + weekly machine backup  

---

# PART 5 — Everyday cheat sheet

```powershell
Get-Service DasCncApi, DasCncOcr
Invoke-RestMethod http://127.0.0.1:3001/health
Invoke-RestMethod http://127.0.0.1:8000/health
Get-Content C:\apps\logs\api\stderr.log -Tail 80
Get-Content C:\apps\logs\ocr\stderr.log -Tail 80
Restart-Service DasCncApi
Restart-Service DasCncOcr
powershell -File C:\apps\tools\deploy-das-cnc.ps1
```

**Ship:** laptop `git push origin production` → RDP → run deploy script.

---

# PART 6 — If something breaks

| Symptom | Likely cause | What to check |
|---------|--------------|---------------|
| Site old/blank after deploy | `web.config` missing from new `dist` | Copy from `C:\apps\tools\web.config` |
| Login / CORS errors | `FRONTEND_URL` ≠ browser origin | Exact `https://host` no trailing slash |
| IIS 502 | API service down | `Get-Service DasCncApi`, API stderr log |
| Sockets dead | Missing `VITE_SOCKET_URL` or no rebuild | Fix `.env.production`, rebuild |
| OCR timeouts | OCR down / ARR timeout / RAM | OCR health, ARR 300s, logs |
| Service won’t start | Wrong password / no “log on as service” | NSSM stderr, secpol |
| Can’t RDP | IP allowlist changed | Console/VPN; update firewall rule |
| Disk filling | Logs / updates | Clean old logs; you sized disk properly this time |

---

# PART 7 — Timeline

| When | Focus |
|------|--------|
| **Now (waiting for hardware)** | Part 2 — GitHub `production`, secrets inventory, Supabase prep, optional local build |
| **Server delivery week — Day 1** | Part 3 B–C — OS, folders, IIS, Node, Python, Git, NSSM |
| **Day 2** | D–H — clone, secrets, OCR, API, Windows services, reboot test |
| **Day 3** | I–J — HTTPS, firewall, RDP harden |
| **Day 4** | K–L — first Git deploy, data, monitors, UAT |
| **Day 5** | Go live; watch logs; keep old 2016 box offline for prod |

---

## Bottom line

1. **Don’t** put production on the laggy 10 GB / 8 GB RAM 2016 machine.  
2. **Do** procure a server with **16–32 GB RAM** and **256–512 GB SSD**.  
3. **Meanwhile** finish GitHub + secrets + Supabase prep on your laptop.  
4. **When hardware arrives**, walk Part 3 top to bottom — each step has a reason, and each phase has a checkpoint so you always know what you’re doing and why.
