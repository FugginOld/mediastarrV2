# 🎯 Mediastarr

**Automated media search for Sonarr & Radarr** — finds missing content and quality upgrades on a configurable schedule. Web dashboard, first-run wizard, SQLite history, multi-instance support, Discord notifications and 3 themes.

> **Note:** Independent project, built from scratch. Not affiliated with Huntarr.

[![GitHub](https://img.shields.io/badge/GitHub-kroeberd%2Fmediastarr-orange?logo=github)](https://github.com/kroeberd/mediastarr)
[![Docker Hub](https://img.shields.io/docker/pulls/kroeberd/mediastarr?label=Docker%20Pulls&logo=docker)](https://hub.docker.com/r/kroeberd/mediastarr)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Version](https://img.shields.io/badge/Version-v6.0.2-ff6b2b)](https://github.com/kroeberd/mediastarr/releases)

---

## ✨ Features

| Feature | Details |
|---|---|
| 📺 Multiple Sonarr instances | Missing + Upgrades · Mode: Episode / Season / Series |
| 🎬 Multiple Radarr instances | Missing + Upgrades |
| 🏷️ Custom names | Each instance gets its own name (Sonarr 4K, Anime, …) |
| 🧙 First-Run Wizard | Browser-based setup — no config editing required |
| 🗄️ SQLite history | Title, year, result, search count, timestamps |
| ⏳ Cooldown | 1–365 days, configurable |
| 📊 Daily limit | Max searches per day (0 = unlimited) |
| 🎲 Jitter | Random offset ±N sec (min. 15 min interval enforced) |
| 🔔 Discord | 6 events + periodic stats report + rate-limit protection |
| 🌐 Multilingual | German & English (UI + logs + Discord messages) |
| 🎨 3 themes | Dark / Light / OLED Black |
| 🕐 Timezone | Configurable — all timestamps in local time |
| 🔒 Secure | Input validation, hardened headers, optional dashboard/API password, CSRF-protected write requests |

---

## 🚀 Quick Start

```bash
git clone https://github.com/kroeberd/mediastarr.git
cd mediastarr && mkdir data
docker compose up -d
open http://localhost:7979
```

---

## 🐳 Docker Compose (minimal)

```yaml
services:
  mediastarr:
    image: kroeberd/mediastarr:latest
    container_name: mediastarr
    restart: unless-stopped
    ports:
      - "7979:7979"
    volumes:
      - /mnt/user/appdata/mediastarr:/data
    environment:
      - MEDIASTARR_PASSWORD=change-me
```

If you expose Mediastarr outside a trusted LAN, set `MEDIASTARR_PASSWORD` and place it behind a reverse proxy or firewall.

When `MEDIASTARR_PASSWORD` is set, the dashboard requires login and browser write requests are CSRF-protected automatically.

---

## 📦 Unraid

Community Apps template: [`mediastarr.xml`](mediastarr.xml)

Manual: Repository `kroeberd/mediastarr:latest`, Port `7979:7979`, Volume `/mnt/user/appdata/mediastarr` → `/data`.

Optional: set `MEDIASTARR_PASSWORD` in the template to require login for the WebUI and API.

---

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

---

## 🔐 Security Notes

- If `MEDIASTARR_PASSWORD` is set, dashboard access requires login and browser write requests are protected by CSRF checks.
- The setup connection test accepts only local/private/internal Sonarr or Radarr targets. Public internet hosts are rejected intentionally.
- `config.json` inside your data directory stores your Arr API keys. Treat the `/data` path as sensitive.

---

## ⚙️ Settings

| Setting | Default | Range |
|---|---|---|
| Missing interval | 900s | min. 900s (15 min) |
| Max searches/run | 10 | 1–500 |
| Daily limit | 20 | 0 = unlimited |
| Cooldown | 7 days | 1–365 days |
| Jitter max | 300s | 0 = off, max 3600s |
| API timeout | 30s | 5–300s |
| Sonarr search mode | Episode | Episode / Season / Series |
| Search upgrades | On | On / Off |
| Timezone | UTC | any IANA timezone |
| Discord rate-limit | 5s | 1–300s |
| Discord stats interval | 60 min | 1–10080 min |

---

## 📡 API

```bash
GET  /api/state                    # Status, stats, config, log
POST /api/control                  # {"action":"start|stop|run_now"}
POST /api/config                   # Update configuration
GET  /api/instances                # List instances (no API keys)
POST /api/instances                # Add instance
PATCH /api/instances/{id}         # Update name/url/key/type/enabled
DELETE /api/instances/{id}        # Delete instance
GET  /api/instances/{id}/ping      # Test connection
GET  /api/history                  # Search history
POST /api/discord/test             # Send test message
POST /api/discord/stats            # Send stats report now
GET  /api/timezones                # Available timezones
```

---

*MIT License — [github.com/kroeberd/mediastarr](https://github.com/kroeberd/mediastarr)*
