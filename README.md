<div align="center">

<img src="https://raw.githubusercontent.com/FugginOld/MediaHunter/refs/heads/main/logos/logo.png" width="128" alt="mediahunter Logo"/>

# mediahunter

English documentation

[![GitHub](https://img.shields.io/badge/GitHub-FugginOld%2FMediaHunter-orange?logo=github)](https://github.com/FugginOld/MediaHunter)
[![Docker Hub](https://img.shields.io/docker/pulls/fugginold/mediahunter?label=Docker%20Pulls&logo=docker)](https://hub.docker.com/r/fugginold/mediahunter)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Version](https://img.shields.io/badge/Version-v1.0 Beta-ff6b2b)](https://github.com/FugginOld/MediaHunter/releases)

</div>

---

<!-- ENGLISH -->
<a name="en"></a>

**Automated media search for Sonarr & Radarr** — queue-based scanning and dispatch for missing content and quality upgrades on a configurable schedule. Includes a web dashboard, first-run wizard, SQLite persistence, multi-instance support, Discord notifications, and 3 themes.

## ✨ Features

| Feature | Details |
|---|---|
| 📺 Multiple Sonarr instances | Missing + Upgrades · Mode: Episode / Season / Series |
| 🎬 Multiple Radarr instances | Missing + Upgrades |
| 🏷️ Custom names | Each instance gets its own name (Sonarr 4K, Anime, …) |
| 🧙 First-Run Wizard | Browser-based setup — no config editing required |
| 🗄️ SQLite persistence | Search history plus persistent media queue |
| ⏳ Cooldown | 1–365 days, configurable |
| 📊 Daily limit | Max searches per day (0 = unlimited) |
| 🎲 Random selection | Items picked randomly each cycle for even coverage |
| 🎲 Jitter | Random offset ±N sec (min. 15 min interval enforced) |
| 🔄 Queue refresh | Initial full scan, then automatic periodic queue refresh |
| 🔔 Discord | 6 events + periodic stats report + rate-limit protection |
| 🌐 Language | English only (UI + logs + Discord messages) |
| 🎨 3 themes | Dark / Light / OLED Black |
| 🕐 Timezone | Configurable — all timestamps in local time |
| 🔒 Secure | Input validation, hardened headers, optional dashboard/API password, CSRF-protected write requests |

## 🧠 How It Works

1. Setup stores your Sonarr and Radarr instances in a persistent config.
2. MediaHunter builds a per-instance queue of missing and upgrade candidates.
3. Each cycle pings instances, refreshes overdue queues, and dispatches searches from queue entries.
4. Dispatch respects global daily limit, per-item cooldown, and max searches per run.
5. Cycle delay is the configured interval plus optional jitter.

Queue and cooldown behavior:

- First run performs an immediate cycle and queue population.
- Queue refresh runs automatically by scan interval (default 7 days), and can be triggered manually.
- Released items are searchable; unreleased items remain queued until release date.
- Items older than cooldown window can bypass cooldown checks and be searched again.
- Expired history entries are purged each cycle so items can re-enter search flow.

## 🚀 Quick Start

```bash
git clone https://github.com/FugginOld/MediaHunter.git
cd mediahunter && mkdir data
docker compose up -d
open http://localhost:7979
```

## 🐳 Docker Compose

```yaml
services:
  mediahunter:
    image: fugginold/mediahunter:latest
    container_name: mediahunter
    restart: unless-stopped
    ports:
      - "7979:7979"
    volumes:
      - /mnt/user/appdata/mediahunter:/data
    environment:
      - MEDIAHUNTER_PASSWORD=change-me
      # Optional first-run bootstrap:
      # - SONARR_API_KEY=...
      # - SONARR_URL=http://sonarr:8989
      # - RADARR_API_KEY=...
      # - RADARR_URL=http://radarr:7878
```

If you expose mediahunter beyond a trusted LAN, set `MEDIAHUNTER_PASSWORD` and place it behind a reverse proxy or firewall.

When `MEDIAHUNTER_PASSWORD` is set, the dashboard requires login and browser write requests are CSRF-protected automatically.

## 📦 Unraid

Community Apps template: [`mediahunter.xml`](mediahunter.xml)

Manual: Repository `fugginold/mediahunter:latest`, Port `7979:7979`, Volume `/mnt/user/appdata/mediahunter` → `/data`.

Optional: set `MEDIAHUNTER_PASSWORD` in the template to require login for the WebUI and API.

## 🔔 Discord Notifications

Settings → Discord:

| Event | Description |
|---|---|
| 🔍 Missing searched | Movie/series requested — title, instance, year |
| ⬆ Upgrade searched | Quality upgrade triggered |
| ⏳ Cooldown expired | Items available for search again |
| 🚫 Daily limit | Daily search limit reached |
| 📡 Instance offline | Instance not reachable |
| 📊 Statistics report | Periodic report (interval configurable) |

**Rate-limit protection:** Configurable minimum gap between same-type events (default 5 sec) — prevents Discord 429 errors.

**Join the community:** [discord.gg/8Vb9cj4ksv](https://discord.gg/8Vb9cj4ksv)

## 🔐 Security Notes

- If `MEDIAHUNTER_PASSWORD` is set, dashboard access requires login and browser write requests use CSRF protection.
- The setup connection test accepts only local/private/internal Sonarr or Radarr targets. Public internet hosts are rejected intentionally.
- `config.json` in your data directory contains your Arr API keys. Treat the `/data` path as sensitive.
- API responses never expose stored API keys or Discord webhook URL values.

## ⚙️ Settings

| Setting | Default | Range |
|---|---|---|
| Missing interval | 900s | min. 900s (15 min) |
| Max searches/run | 10 | 1–500 |
| Daily limit | 20 | 0 = unlimited |
| Cooldown | 7 days | 1–365 days |
| Jitter max | 300s | 0 = off, max 3600s |
| API timeout | 30s | 5–300s |
| Sonarr search mode | Season | Episode / Season / Series |
| Search upgrades | On | On / Off |
| Queue scan interval | 7 days | 1–365 days |
| Timezone | UTC | any IANA timezone |
| Theme | Dark | Dark / Light / OLED |
| Language | English | fixed |
| Discord rate-limit | 5s | 1–300s |
| Discord stats interval | 60 min | 1–10080 min |

## 📡 API

```bash
GET  /api/state                    # Status, stats, config, log
POST /api/control                  # {"action":"start|stop|run_now"}
POST /api/config                   # Update configuration

POST /api/setup/ping               # Test Sonarr/Radarr connectivity during setup
POST /api/setup/complete           # Save setup payload and start runtime
POST /api/setup/reset              # Reset setup state

GET  /api/instances                # List instances (no API keys)
POST /api/instances                # Add instance
PATCH /api/instances/{id}          # Update name/url/key/type/enabled
DELETE /api/instances/{id}         # Delete instance
GET  /api/instances/{id}/ping      # Test connection

GET  /api/history                  # Search history
GET  /api/history/stats            # History totals and yearly breakdown
POST /api/history/clear            # Clear all history
POST /api/history/clear/{id}       # Clear history for one instance

POST /api/discord/test             # Send test message
POST /api/discord/stats            # Send stats report now

POST /api/queue/scan               # Force queue rescan
GET  /api/queue/stats              # Queue counts per instance

GET  /api/timezones                # Available timezones
```

---

<div align="center">
MIT License · <a href="https://github.com/FugginOld/MediaHunter">github.com/FugginOld/MediaHunter</a>
</div>



