"""
MediaHunter v1.0 Beta — main.py
Multi-instance Sonarr & Radarr.
github.com/FugginOld/MediaHunter

New in v1.0 Beta:
  - Queue-based scan/dispatch architecture
  - Initial full scan on first run, weekly queue refresh
  - Jitter: random ±N minutes added to each hunt interval (configurable)
  - Sonarr search granularity: series / season / episode
  - Upgrade search can be disabled per instance
  - Configurable request timeout (default 30s)
  - Configurable timezone (defaults to OS timezone, affects timestamps + log display)
    - English-only log messages and UI labels
  - Instance management fully in main settings (no wizard redirect needed)
"""
import os, re, json, time, logging, threading, requests, random, string, zoneinfo, socket, secrets, ipaddress
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse
from flask import Flask, render_template, jsonify, request, redirect, session, url_for
from collections import deque
try:
    from . import db
except ImportError:
    import db

app = Flask(__name__, template_folder='../templates', static_folder='../static')
app.config["SECRET_KEY"] = os.environ.get("MEDIAHUNTER_SESSION_SECRET") or secrets.token_hex(32)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("MEDIAHUNTER_SESSION_SECURE", "").strip().lower() in {"1", "true", "yes", "on"}
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# ─── Constants ───────────────────────────────────────────────────────────────
ALLOWED_TYPES       = frozenset({"sonarr","radarr"})
ALLOWED_LANGUAGES   = frozenset({"en"})
ALLOWED_ACTIONS     = frozenset({"start","stop","run_now"})
ALLOWED_SCHEMES     = frozenset({"http","https"})
THEME_ALIASES       = {
    "dark": "system",
    "light": "system",
    "oled": "system",
    "system-dark": "system",
    "system-light": "system",
}
ALLOWED_THEMES      = frozenset({
    "system",
    "github-inspired",
    "discord-inspired",
    "plex-inspired",
})
ALLOWED_SONARR_MODES= frozenset({"episode","season","series"})
API_KEY_RE          = re.compile(r'^[A-Za-z0-9\-_]{8,128}$')
NAME_RE             = re.compile(r'^[A-Za-z0-9 \-_]{1,40}$')
URL_MAX_LEN         = 256
MAX_INSTANCES       = 20
MIN_INTERVAL_SEC    = 900   # 15 minutes absolute minimum
AUTH_PASSWORD       = os.environ.get("MEDIAHUNTER_PASSWORD", "").strip()
DEFAULT_PASSWORD    = "change-me"
APP_VERSION         = "1.0 Beta"
APP_BUILD_ID        = os.environ.get("MEDIAHUNTER_BUILD_ID", "").strip() or APP_VERSION

def normalize_theme_name(theme: str | None) -> str:
    value = str(theme or "").strip().lower()
    if not value:
        return "system"
    return THEME_ALIASES.get(value, value)

# ─── Discord Webhook ─────────────────────────────────────────────────────────
DISCORD_COLORS = {
    "missing":  0x3de68b,
    "upgrade":  0xf5c842,
    "cooldown": 0x4d9cff,
    "limit":    0xff4d4d,
    "offline":  0x888888,
    "stats":    0xff6b2b,
    "info":     0xff6b2b,
}

# Rate-limit guard: tracks last successful send time per event_type
_dc_last_sent: dict[str, float] = {}
_dc_lock = threading.Lock()

def _dc_cooldown_ok(event_type: str, cooldown_sec: int) -> bool:
    """Return True if we're allowed to send (cooldown elapsed or never sent)."""
    with _dc_lock:
        last = _dc_last_sent.get(event_type, 0.0)
        if time.time() - last >= cooldown_sec:
            _dc_last_sent[event_type] = time.time()
            return True
        return False

def discord_send(event_type: str, title: str, description: str,
                 instance_name: str = "", fields: list | None = None,
                 force: bool = False):
    """Fire-and-forget Discord embed. Runs in a daemon thread.
    Silently drops if webhook unconfigured, disabled, or rate-limited.
    Set force=True to bypass per-type cooldown (used for test & stats)."""
    dc = CONFIG.get("discord", {})
    if not dc.get("enabled"): return
    url = safe_str(dc.get("webhook_url", ""), 512).strip()
    if not url or not url.startswith(("http://", "https://")): return

    # Per-event toggle
    toggle_map = {
        "missing":  "notify_missing",
        "upgrade":  "notify_upgrade",
        "cooldown": "notify_cooldown",
        "limit":    "notify_limit",
        "offline":  "notify_offline",
    }
    toggle_key = toggle_map.get(event_type)
    if toggle_key and not dc.get(toggle_key, True): return

    # Rate-limit cooldown (default 5 s, configurable)
    cooldown_sec = clamp_int(dc.get("rate_limit_cooldown", 5), 1, 300, 5)
    if not force and not _dc_cooldown_ok(event_type, cooldown_sec):
        logger.debug(f"Discord rate-limit: skipping {event_type}")
        return

    color = DISCORD_COLORS.get(event_type, DISCORD_COLORS["info"])
    footer_text = f"MediaHunter v1.0 Beta · {instance_name}" if instance_name else "MediaHunter v1.0 Beta"
    embed = {
        "title":       safe_str(title, 256),
        "description": safe_str(description, 2048),
        "color":       color,
        "footer":      {"text": footer_text},
        "timestamp":   datetime.utcnow().isoformat() + "Z",
    }
    if fields:
        embed["fields"] = [
            {"name":   safe_str(f.get("name",""),  256),
             "value":  safe_str(f.get("value",""), 1024),
             "inline": bool(f.get("inline", True))}
            for f in fields[:10]
        ]

    def _send():
        try:
            r = requests.post(url, json={"embeds": [embed]},
                              timeout=CONFIG.get("request_timeout", 30))
            if r.status_code == 429:
                retry_after = r.json().get("retry_after", 5)
                logger.warning(f"Discord 429: retry_after={retry_after}s")
            elif r.status_code not in (200, 204):
                logger.warning(f"Discord webhook HTTP {r.status_code}")
        except Exception as e:
            logger.warning(f"Discord webhook failed: {e}")

    threading.Thread(target=_send, daemon=True).start()


def discord_send_stats():
    """Send a statistics summary embed to Discord."""
    dc = CONFIG.get("discord", {})
    if not dc.get("enabled") or not dc.get("notify_stats", False): return
    lang  = "en"
    today = db.count_today()
    limit = CONFIG.get("daily_limit", 0)
    total = db.total_count()
    cycles = STATE.get("cycle_count", 0)

    title = "📊 MediaHunter Statistics"
    desc  = f"Daily report — {now_local().strftime('%Y-%m-%d %H:%M')}"
    f_today  = "Today"
    f_total  = "Total"
    f_cycles = "Cycles"
    f_insts  = "Active instances"
    f_limit  = f"{today} / {limit if limit else '∞'}"

    active = len([i for i in CONFIG["instances"] if i.get("enabled")])
    fields = [
        {"name": f_today,  "value": f_limit, "inline": True},
        {"name": f_total,  "value": str(total), "inline": True},
        {"name": f_cycles, "value": str(cycles), "inline": True},
        {"name": f_insts,  "value": str(active), "inline": True},
    ]
    # Per-instance status
    for inst in CONFIG["instances"][:6]:
        st = STATE["inst_stats"].get(inst["id"], {}).get("status", "?")
        icon = "🟢" if st == "online" else "🔴" if st == "offline" else "⚫"
        fields.append({"name": inst["name"], "value": f"{icon} {st}", "inline": True})

    discord_send("stats", title, desc, "System", fields=fields, force=True)


# Stats report background thread
_stats_stop = threading.Event()

def _stats_loop():
    """Periodically send stats report to Discord."""
    while not _stats_stop.is_set():
        time.sleep(60)  # check every minute
        dc = CONFIG.get("discord", {})
        if not dc.get("enabled") or not dc.get("notify_stats", False):
            continue
        interval_min = clamp_int(dc.get("stats_interval_min", 60), 1, 10080, 60)
        last = dc.get("stats_last_sent_at", 0.0)
        if time.time() - float(last) >= interval_min * 60:
            discord_send_stats()
            CONFIG["discord"]["stats_last_sent_at"] = time.time()
            save_config(CONFIG)

_stats_thread = threading.Thread(target=_stats_loop, daemon=True)
_stats_thread.start()


# ─── Log messages (English only) ─────────────────────────────────────────────
MSGS = {
    "cycle_start":      "Cycle #{n} started – {active} active – Today: {today}/{limit}",
    "cycle_done":       "Cycle #{n} done – Today total: {today}",
    "daily_limit":      "Daily limit reached: {today}/{limit}",
    "db_pruned":        "{n} expired entries pruned",
    "skipped_offline":  "Skipped – offline or disabled",
    "auto_start":       "Hunt loop started",
    "app_start":        "MediaHunter v1.0 Beta started",
    "setup_required":   "Setup required – {setup_url}",
    "missing":          "Missing",
    "upgrade":          "Upgrade",
    "error":            "Error",
    "next_run":         "Next run at {hhmm} (jitter: {jitter_min})",
    "scan_start":       "Scanning {name}...",
    "scan_done":        "Queue updated: {n} items for {name}",
    "scan_error":       "Scan error [{name}]: {err}",
    "no_queue":         "Queue empty for {name} – running scan",
}

def msg(key: str, **kwargs) -> str:
    tmpl = MSGS.get(key, key)
    try: return tmpl.format(**kwargs)
    except: return tmpl


def setup_url_for_logs() -> str:
    """Return externally reachable setup URL for startup logs.

    Priority:
    1) MEDIAHUNTER_PUBLIC_URL (full URL, e.g. https://host.example.com)
    2) MEDIAHUNTER_PUBLIC_PORT (host-mapped port, e.g. 9191)
    3) default localhost:7979
    """
    public_url = os.environ.get("MEDIAHUNTER_PUBLIC_URL", "").strip().rstrip("/")
    if public_url:
        return f"{public_url}/setup"

    public_port = os.environ.get("MEDIAHUNTER_PUBLIC_PORT", "").strip()
    if public_port.isdigit():
        return f"http://localhost:{public_port}/setup"

    return "http://localhost:7979/setup"

# ─── Paths ───────────────────────────────────────────────────────────────────
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
CFG_FILE = DATA_DIR / "config.json"
DB_FILE  = DATA_DIR / "mediahunter.db"
DATA_DIR.mkdir(parents=True, exist_ok=True)
db.init(DB_FILE)

# ─── Helpers ─────────────────────────────────────────────────────────────────
def make_id() -> str:
    return "inst_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=8))

def fresh_inst_stats() -> dict:
    return {"missing_found":0,"missing_searched":0,"upgrades_found":0,
            "upgrades_searched":0,"skipped_cooldown":0,"skipped_daily":0,
            "skipped_unreleased":0,"queue_size":0,"scan_status":"idle",
            "scan_shows_total":0,"scan_episodes_total":0,"scan_movies_total":0,
            "status":"unknown","version":"?","status_detail":""}

def _detect_local_tz() -> str:
    """Return the host OS IANA timezone name, falling back to UTC."""
    # 1. Honour an explicit TZ environment variable if set.
    env_tz = os.environ.get("TZ", "").strip()
    if env_tz:
        try:
            zoneinfo.ZoneInfo(env_tz)
            return env_tz
        except Exception:
            pass
    # 2. Python 3.11+ exposes the local zone directly.
    try:
        local = zoneinfo.ZoneInfo("localtime")
        if local.key:
            return local.key
    except Exception:
        pass
    # 3. Read /etc/timezone (Debian/Ubuntu containers).
    try:
        tz_name = Path("/etc/timezone").read_text().strip()
        if tz_name:
            zoneinfo.ZoneInfo(tz_name)  # validate
            return tz_name
    except Exception:
        pass
    # 4. Resolve /etc/localtime symlink to an IANA name (most Linux/macOS).
    try:
        lt = Path("/etc/localtime").resolve()
        parts = lt.parts
        zi_idx = next((i for i, p in enumerate(parts) if p == "zoneinfo"), None)
        if zi_idx is not None:
            tz_name = "/".join(parts[zi_idx + 1:])
            zoneinfo.ZoneInfo(tz_name)  # validate
            return tz_name
    except Exception:
        pass
    return "UTC"

OS_TIMEZONE = _detect_local_tz()

def now_local() -> datetime:
    """Current time in configured timezone."""
    tz_name = CONFIG.get("timezone", OS_TIMEZONE)
    try: tz = zoneinfo.ZoneInfo(tz_name)
    except Exception: tz = zoneinfo.ZoneInfo(OS_TIMEZONE)
    return datetime.now(tz)

def fmt_time(dt: datetime) -> str:
    return dt.strftime("%H:%M:%S")

def fmt_dt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")

def _year(val):
    if val is None: return None
    try:
        y = int(str(val)[:4])
        return y if 1900 < y < 2100 else None
    except: return None

# ─── Default config ───────────────────────────────────────────────────────────
DEFAULT_CONFIG = {
    "setup_complete": False,
    "language": "en",
    "theme": "system",
    "timezone": OS_TIMEZONE,
    "instances": [],
    "hunt_missing_delay":    900,   # seconds (min 900 = 15 min)
    "hunt_upgrade_delay":   1800,
    "max_searches_per_run":   10,
    "daily_limit":            20,
    "daily_count_reset_at":   "",
    "cooldown_days":           7,
    "request_timeout":        30,   # seconds for arr API calls
    "jitter_max":            300,   # max random seconds added to interval (0=off)
    "dry_run":    False,
    "auto_start": False,
    "last_boot_version": "",
    "last_boot_build_id": "",
    # Sonarr search granularity: "episode" | "season" | "series"
    "sonarr_search_mode": "season",   # season is safer default (fewer API calls)
    # Whether to search for upgrades at all
    "search_upgrades": True,
    # Discord Webhook notifications
    "discord": {
        "enabled":             False,
        "webhook_url":         "",
        "notify_missing":      True,   # new missing search triggered
        "notify_upgrade":      True,   # upgrade search triggered
        "notify_cooldown":     True,   # items released from cooldown
        "notify_limit":        True,   # daily limit reached
        "notify_offline":      True,   # instance went offline
        "notify_stats":        False,  # periodic stats report
        "stats_interval_min":  60,     # minutes between stats reports
        "stats_last_sent_at":  0.0,    # unix timestamp
        "rate_limit_cooldown": 5,      # seconds between same-type messages
    },
    "scan_interval_days": 7,       # days between full queue refreshes
    "queue_last_scan":    {},       # {inst_id: ISO timestamp of last scan}
}

def load_config() -> dict:
    if CFG_FILE.exists():
        try:
            raw = json.loads(CFG_FILE.read_text())
            m = DEFAULT_CONFIG.copy(); m.update(raw)
            for inst in m.get("instances",[]):
                if "id" not in inst: inst["id"] = make_id()
            return m
        except Exception as e: logger.warning(f"Config load failed: {e}")
    return DEFAULT_CONFIG.copy()

def save_config(cfg: dict):
    tmp = CFG_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    tmp.replace(CFG_FILE)
    try:
        os.chmod(CFG_FILE, 0o600)
    except OSError:
        pass


def auth_enabled() -> bool:
    return bool(AUTH_PASSWORD)


def is_authenticated() -> bool:
    return not auth_enabled() or session.get("auth_ok") is True


def sanitize_next_url(target: str) -> str:
    if not target or not target.startswith("/") or target.startswith("//"):
        return "/"
    return target


def get_csrf_token() -> str:
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_hex(32)
        session["csrf_token"] = token
    return token


@app.context_processor
def inject_template_context():
    return {
        "auth_enabled": auth_enabled(),
        "csrf_token": get_csrf_token(),
    }


def _bootstrap_host() -> str:
    """Return best-effort host/IP for local *arr fallback URLs."""
    env_host = os.environ.get("SYSTEM_IP", "").strip() or os.environ.get("HOST_IP", "").strip()
    if env_host:
        return env_host
    try:
        ip = socket.gethostbyname(socket.gethostname())
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass
    return "127.0.0.1"


def _bootstrap_arr_url(service: str) -> str:
    port = 8989 if service == "sonarr" else 7878
    return f"http://{_bootstrap_host()}:{port}"

CONFIG = load_config()

# English-only mode: normalize any existing config to English.
_cfg_migrated = False
if CONFIG.get("language") != "en":
    CONFIG["language"] = "en"
    _cfg_migrated = True

# Migrate legacy default timezone from UTC to detected host timezone.
if (not CONFIG.get("timezone") or CONFIG.get("timezone") == "UTC") and OS_TIMEZONE != "UTC":
    CONFIG["timezone"] = OS_TIMEZONE
    _cfg_migrated = True

# Prevent immediate background hunt on fresh setups unless explicitly enabled later.
if CONFIG.get("setup_complete") and CONFIG.get("auto_start") and not CONFIG.get("queue_last_scan"):
    CONFIG["auto_start"] = False
    _cfg_migrated = True

if _cfg_migrated:
    save_config(CONFIG)

# Env-var bootstrap
if not CONFIG["setup_complete"] and not CONFIG["instances"]:
    for svc, ek, eu in [
        ("sonarr","SONARR_API_KEY","SONARR_URL"),
        ("radarr","RADARR_API_KEY","RADARR_URL"),
    ]:
        k = os.environ.get(ek,"").strip()
        if k:
            fallback_url = _bootstrap_arr_url(svc)
            CONFIG["instances"].append({"id":make_id(),"type":svc,
                "name":svc.title(),"url":os.environ.get(eu,fallback_url).strip(),
                "api_key":k,"enabled":True})
    if CONFIG["instances"]:
        CONFIG["setup_complete"] = True; save_config(CONFIG)

# ─── Runtime State ────────────────────────────────────────────────────────────
STATE = {
    "running":False,"last_run":None,"next_run":None,"cycle_count":0,
    "inst_stats":{}, "activity_log":deque(maxlen=300),
    "scan_running":False,
}
STOP_EVENT  = threading.Event()
hunt_thread = None
CYCLE_LOCK  = threading.Lock()
SCAN_LOCK   = threading.Lock()

# ─── Daily count cache ────────────────────────────────────────────────────────
# Avoids repeated COUNT(*) queries on every search dispatch within a cycle.
_daily_cache: dict = {"date": "", "n": 0}
_daily_cache_lock = threading.Lock()
_grab_sync_lock = threading.Lock()
_last_grab_sync_at = 0.0

def _daily_count_reset_cutoff() -> str:
    """Optional ISO cutoff after which today's grab events are counted."""
    raw = str(CONFIG.get("daily_count_reset_at", "") or "").strip()
    if not raw:
        return ""
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None).isoformat()
    except Exception:
        return ""

def _today_count(refresh: bool = False) -> int:
    """Return today's dispatched search count from cache, hitting DB only when
    the date has changed or refresh=True is requested."""
    today = datetime.utcnow().strftime("%Y-%m-%d")
    with _daily_cache_lock:
        if refresh or _daily_cache["date"] != today:
            _daily_cache["date"] = today
            _daily_cache["n"]    = db.count_today(_daily_count_reset_cutoff())
        return _daily_cache["n"]

def _today_count_inc():
    """Legacy helper kept for compatibility; confirmed counts are DB-derived."""
    today = datetime.utcnow().strftime("%Y-%m-%d")
    with _daily_cache_lock:
        if _daily_cache["date"] != today:
            _daily_cache["date"] = today
            _daily_cache["n"]    = db.count_today(_daily_count_reset_cutoff())


def _normalize_grab_ts(raw) -> str:
    """Return ISO timestamp for Arr history event time; fallback to now."""
    val = str(raw or "").strip()
    if not val:
        return datetime.utcnow().isoformat()
    try:
        return datetime.fromisoformat(val.replace("Z", "+00:00")).replace(tzinfo=None).isoformat()
    except Exception:
        return datetime.utcnow().isoformat()


def sync_grab_events(force: bool = False):
    """Ingest confirmed Arr 'grabbed' history events for daily-limit counting."""
    global _last_grab_sync_at
    now_ts = time.time()
    if not force and now_ts - _last_grab_sync_at < 20:
        return
    if not _grab_sync_lock.acquire(blocking=False):
        return
    try:
        _last_grab_sync_at = now_ts
        for inst in CONFIG.get("instances", []):
            if not inst.get("enabled") or not inst.get("api_key"):
                continue
            if STATE["inst_stats"].get(inst["id"], {}).get("status") != "online":
                continue
            try:
                client = ArrClient(inst["name"], inst["url"], inst["api_key"])
                data = client.get("history", params={"page": 1, "pageSize": 200, "sortKey": "date", "sortDir": "descending"})
                records = data.get("records", []) if isinstance(data, dict) else []
                for rec in records:
                    if str(rec.get("eventType", "")).lower() != "grabbed":
                        continue
                    event_id = str(rec.get("id", "")).strip()
                    if not event_id:
                        continue
                    if inst.get("type") == "sonarr":
                        item_id = int(rec.get("episodeId") or 0)
                        if not item_id:
                            continue
                        item_type = "episode"
                        series_title = (rec.get("series") or {}).get("title") or rec.get("sourceTitle") or "Sonarr item"
                        title = safe_str(series_title, 120)
                    else:
                        movie = rec.get("movie") or {}
                        item_id = int(rec.get("movieId") or movie.get("id") or 0)
                        if not item_id:
                            continue
                        item_type = "movie"
                        movie_title = movie.get("title") or rec.get("sourceTitle") or "Radarr item"
                        title = safe_str(movie_title, 120)

                    grabbed_at = _normalize_grab_ts(rec.get("date"))
                    inserted = db.add_grab_event(
                        service=inst["id"],
                        arr_type=inst.get("type", "sonarr"),
                        item_type=item_type,
                        item_id=item_id,
                        title=title,
                        grabbed_at=grabbed_at,
                        event_id=event_id,
                    )
                    if inserted:
                        db.upsert_search(inst["id"], item_type, item_id, title, "downloaded")
            except Exception as e:
                logger.debug(f"grab sync failed for {inst.get('name', inst.get('id'))}: {e}")
        _today_count(refresh=True)
    finally:
        _grab_sync_lock.release()

def _ensure_inst_stats():
    for inst in CONFIG["instances"]:
        if inst["id"] not in STATE["inst_stats"]:
            STATE["inst_stats"][inst["id"]] = fresh_inst_stats()

_ensure_inst_stats()

# ─── Validation ───────────────────────────────────────────────────────────────
def validate_url(url: str, max_len: int = URL_MAX_LEN):
    if not url or not isinstance(url,str): return False,"URL is missing"
    if len(url) > max_len: return False,"URL is too long"
    try: p = urlparse(url)
    except: return False,"Invalid URL"
    if p.scheme not in ALLOWED_SCHEMES: return False,f"Scheme '{p.scheme}' not allowed"
    if not p.hostname: return False,"Missing hostname"
    return True,""


def validate_discord_webhook_url(url: str):
    if not url or not isinstance(url, str):
        return False, "URL is missing"
    return validate_url(url, 512)


def validate_csrf_request() -> bool:
    expected = session.get("csrf_token", "")
    if not expected:
        return False
    provided = request.headers.get("X-CSRF-Token", "")
    if not provided:
        provided = request.form.get("csrf_token", "")
    return bool(provided) and secrets.compare_digest(provided, expected)


def is_private_host(hostname: str) -> bool:
    host = hostname.strip().lower()
    if not host:
        return False
    if host == "localhost" or "." not in host:
        return True
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        pass
    try:
        resolved = {info[4][0] for info in socket.getaddrinfo(host, None)}
    except OSError:
        return False
    if not resolved:
        return False
    try:
        return all(
            ipaddress.ip_address(addr).is_private
            or ipaddress.ip_address(addr).is_loopback
            or ipaddress.ip_address(addr).is_link_local
            for addr in resolved
        )
    except ValueError:
        return False


def validate_internal_service_url(url: str):
    ok, err = validate_url(url)
    if not ok:
        return False, err
    parsed = urlparse(url)
    if not parsed.hostname or not is_private_host(parsed.hostname):
        return False, "Target must point to a local or internal system"
    return True, ""

def validate_api_key(key: str):
    if not key or not isinstance(key,str): return False,"API key is missing"
    if not API_KEY_RE.match(key): return False,"Invalid format (8-128 chars: A-Z a-z 0-9 - _)"
    return True,""

def validate_name(name: str):
    if not name or not isinstance(name,str): return False,"Name is missing"
    if not NAME_RE.match(name.strip()): return False,"Invalid characters or too long (max 40)"
    return True,""

def clamp_int(val, lo, hi, default):
    try: return max(lo, min(hi, int(val)))
    except: return default

def safe_str(val, max_len=256):
    return val[:max_len] if isinstance(val,str) else ""

# ─── Security Headers ─────────────────────────────────────────────────────────
@app.after_request
def sec_headers(r):
    r.headers.update({
        "X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY",
        "X-XSS-Protection":"1; mode=block","Referrer-Policy":"same-origin",
        "Content-Security-Policy":(
            "default-src 'self'; script-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; "
            "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self';"),
    })
    if request.path.startswith("/api/"):
        r.headers["Cache-Control"]="no-store"; r.headers["Pragma"]="no-cache"
    return r


@app.before_request
def require_auth():
    if not auth_enabled():
        pass
    if request.path.startswith("/static/"):
        return None
    if request.endpoint in {"login_page", "logout"}:
        pass
    elif auth_enabled() and not is_authenticated():
        if request.path.startswith("/api/"):
            return jsonify({"ok": False, "error": "Authentifizierung erforderlich"}), 401
        return redirect(url_for("login_page", next=sanitize_next_url(request.full_path or request.path)))
    if request.method in {"POST", "PATCH", "DELETE"} and request.endpoint not in {"logout"}:
        if not validate_csrf_request():
            if request.path.startswith("/api/"):
                return jsonify({"ok": False, "error": "CSRF validation failed"}), 400
            return "CSRF validation failed", 400
    if request.endpoint == "logout" and not validate_csrf_request():
        return "CSRF validation failed", 400
    return None

@app.errorhandler(400)
def e400(e): return jsonify({"ok":False,"error":"Invalid request"}),400
@app.errorhandler(404)
def e404(e): return jsonify({"ok":False,"error":"Not found"}),404
@app.errorhandler(405)
def e405(e): return jsonify({"ok":False,"error":"Method not allowed"}),405
@app.errorhandler(500)
def e500(e): logger.error(f"500:{e}"); return jsonify({"ok":False,"error":"Internal server error"}),500

# ─── *arr API Client ──────────────────────────────────────────────────────────
class ArrClient:
    def __init__(self, name:str, url:str, api_key:str):
        self.name = name; self.url = url.rstrip("/")
        self._h = {"X-Api-Key":api_key,"Content-Type":"application/json"}

    def _timeout(self) -> int:
        return CONFIG.get("request_timeout", 30)

    def get(self, path, params=None):
        r = requests.get(f"{self.url}/api/v3/{path}", headers=self._h,
                         params=params, timeout=self._timeout())
        r.raise_for_status(); return r.json()

    def post(self, path, data=None):
        r = requests.post(f"{self.url}/api/v3/{path}", headers=self._h,
                          json=data, timeout=self._timeout())
        r.raise_for_status(); return r.json()

    def ping(self):
        try:
            d = self.get("system/status")
            return True, str(d.get("version","?"))[:20], ""
        except Exception as e:
            return False, "?", summarize_ping_error(str(e)[:200])

def summarize_ping_error(raw: str) -> str:
    text = str(raw or "").strip()
    lower = text.lower()
    if not text:
        return "Connection failed"
    if "401" in lower or "403" in lower or "unauthorized" in lower or "forbidden" in lower:
        return "Authentication failed"
    if "404" in lower:
        return "API endpoint not found"
    if "name or service not known" in lower or "nodename nor servname" in lower:
        return "Host not found"
    if "timed out" in lower or "timeout" in lower:
        return "Timed out"
    if "failed to establish a new connection" in lower or "connection refused" in lower:
        return "Connection failed"
    if "max retries exceeded" in lower or "connectionpool" in lower:
        return "Host unreachable"
    if "ssl" in lower or "certificate" in lower:
        return "TLS/SSL error"
    compact = re.sub(r"\s+", " ", text)
    if ":" in compact:
        compact = compact.split(":", 1)[0].strip()
    return compact[:60] or "Connection failed"

# ─── Activity Log ─────────────────────────────────────────────────────────────
def log_act(service:str, action:str, item:str, status:str="info"):
    ts = fmt_time(now_local())
    STATE["activity_log"].appendleft({
        "ts": ts, "service": safe_str(service,30),
        "action": safe_str(action,50), "item": safe_str(item,200),
        "status": status if status in ("info","success","warning","error") else "info",
    })
    logger.info(f"[{service}] {action}: {item}")

# ─── Jitter ───────────────────────────────────────────────────────────────────
def jittered_delay(base_sec: int) -> tuple[int, int]:
    """Returns (actual_delay, jitter_applied). Minimum 900s enforced."""
    jmax = CONFIG.get("jitter_max", 300)
    jitter = random.randint(0, max(0, jmax)) if jmax > 0 else 0
    total = max(MIN_INTERVAL_SEC, base_sec + jitter)
    return total, jitter

# ─── Hunt helpers ─────────────────────────────────────────────────────────────
def daily_limit_reached() -> bool:
    sync_grab_events(force=False)
    limit = CONFIG.get("daily_limit", 0)
    return limit > 0 and _today_count() >= limit

def _parse_release_dt(raw):
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    # Most Arr payloads contain YYYY-MM-DD or full ISO datetime.
    if len(s) >= 10:
        try:
            return datetime.fromisoformat(s[:10])
        except Exception:
            pass
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        pass
    if len(s) >= 4 and s[:4].isdigit():
        try:
            return datetime(int(s[:4]), 1, 1)
        except Exception:
            return None
    return None

def _pick_release_dt(record: dict, *keys):
    for key in keys:
        dt = _parse_release_dt(record.get(key))
        if dt is not None:
            return dt
    return None

def _is_older_than_cooldown(release_dt):
    if release_dt is None:
        return False
    cooldown_days = CONFIG.get("cooldown_days", 7)
    try:
        age_days = (datetime.utcnow().date() - release_dt.date()).days
        return age_days >= cooldown_days
    except Exception:
        return False

def _is_released(release_dt):
    if release_dt is None:
        # Unknown release date should not be blocked.
        return True
    try:
        return release_dt.date() <= datetime.utcnow().date()
    except Exception:
        return True

def should_search(iid:str, item_type:str, item_id:int, release_dt=None):
    if daily_limit_reached(): return False, "daily_limit"
    # Requested behavior: older titles bypass cooldown and can be searched now.
    if _is_older_than_cooldown(release_dt):
        return True, ""
    if db.is_on_cooldown(iid, item_type, item_id, CONFIG.get("cooldown_days",7)):
        return False, "cooldown"
    return True, ""


def do_search(client: ArrClient, iid: str, item_type: str, item_id: int,
              title: str, command: dict, changed=None, year=None):
    """Dispatch a search command and record it. Returns 'dispatched', 'dry_run', or 'error'."""
    if CONFIG["dry_run"]:
        result = "dry_run"
    else:
        try:
            client.post("command", command)
        except Exception as e:
            inst_name_err = next((i["name"] for i in CONFIG["instances"] if i["id"] == iid), iid)
            log_act(inst_name_err, msg("error"), str(e)[:200], "error")
            return "error"
        result = "dispatched"
        db.upsert_search(iid, item_type, item_id, title, "dispatched", changed, year)

    # Discord notification
    inst = next((i for i in CONFIG["instances"] if i["id"] == iid), {})
    inst_name = inst.get("name", iid)
    is_upgrade = "upgrade" in item_type
    event = "upgrade" if is_upgrade else "missing"
    label_en = "Upgrade searched" if is_upgrade else "Missing searched"
    label = label_en
    icon  = "⬆️" if is_upgrade else "🔍"
    if result == "dry_run":
        desc = f"**[Dry Run]** {icon} {title}"
    else:
        desc = f"{icon} {title}"
    discord_send(event, label, desc, inst_name, fields=[
        {"name": "Instance", "value": inst_name, "inline": True},
        {"name": "Type",     "value": item_type,  "inline": True},
    ])
    return result

# ─── Queue Scan ──────────────────────────────────────────────────────────────
def needs_scan(inst_id: str) -> bool:
    """True if this instance has never been scanned or scan is overdue."""
    last = CONFIG.get("queue_last_scan", {}).get(inst_id)
    if not last:
        return True
    try:
        days_since = (datetime.utcnow() - datetime.fromisoformat(last)).days
        return days_since >= CONFIG.get("scan_interval_days", 7)
    except Exception:
        return True


def scan_sonarr_instance(inst: dict):
    """Populate queue with ALL missing + upgradeable Sonarr episodes."""
    iid = inst["id"]; name = inst["name"]
    client = ArrClient(name, inst["url"], inst["api_key"])
    stats = STATE["inst_stats"].setdefault(iid, fresh_inst_stats())
    stats["scan_status"] = "scanning"
    stats["scan_shows_total"] = 0
    stats["scan_episodes_total"] = 0
    log_act(name, msg("scan_start", name=name), "", "info")

    series_cache: dict[int, str] = {}
    series_total = 0
    try:
        for s in client.get("series"):
            series_total += 1
            sid = s.get("id")
            if sid and s.get("title"):
                series_cache[int(sid)] = s["title"].strip()
        stats["scan_shows_total"] = series_total
    except Exception as e:
        logger.warning(f"Series cache for {name}: {e}")

    def _ep_label(ep: dict) -> str:
        series_obj = ep.get("series", {}) or {}
        sid = series_obj.get("id") or ep.get("seriesId")
        s_title = (series_cache.get(int(sid), "") if sid else "") or \
                  series_obj.get("title") or ep.get("seriesTitle") or "?"
        ep_t  = (ep.get("title") or "").strip()
        snum  = ep.get("seasonNumber", 0)
        enum  = ep.get("episodeNumber", 0)
        code  = f"S{snum:02d}E{enum:02d}"
        suppressed = {"tba", "tbd", "", "unknown", "n/a", "none"}
        return (f"{s_title[:60]} – {ep_t[:60]} – {code}"
                if ep_t and ep_t.lower() not in suppressed
                else f"{s_title[:60]} – {code}")

    do_upgrades = CONFIG.get("search_upgrades", True)
    endpoints = [("wanted/missing", "episode")]
    if do_upgrades:
        endpoints.append(("wanted/cutoff", "episode_upgrade"))

    scanned_episode_ids: set[int] = set()
    for endpoint, item_type in endpoints:
        seen_ids: set[int] = set()
        page = 1
        try:
            while True:
                data = client.get(endpoint, params={
                    "page": page, "pageSize": 1000,
                    "sortKey": "airDateUtc", "sortDir": "desc",
                })
                recs = data.get("records", [])
                total_records = int(data.get("totalRecords", 0))
                for ep in recs:
                    eid = ep.get("id")
                    if not eid:
                        continue
                    seen_ids.add(eid)
                    scanned_episode_ids.add(int(eid))
                    series_obj = ep.get("series", {}) or {}
                    series_id  = series_obj.get("id") or ep.get("seriesId")
                    release_dt = (_pick_release_dt(ep, "airDate", "airDateUtc", "firstAired")
                                  or _pick_release_dt(series_obj, "firstAired"))
                    db.queue_upsert(
                        service=iid, arr_type="sonarr", item_type=item_type,
                        item_id=eid, title=_ep_label(ep),
                        series_id=series_id,
                        season_number=ep.get("seasonNumber"),
                        release_dt=release_dt.strftime("%Y-%m-%d") if release_dt else None,
                        release_year=_year(series_obj.get("year") or (ep.get("airDate") or "")[:4]),
                        last_modified=series_obj.get("lastInfoSync"),
                    )
                if len(recs) < 1000 or page * 1000 >= total_records:
                    break
                page += 1
            removed = db.queue_remove_stale(iid, item_type, seen_ids)
            if removed:
                logger.info(f"{name}: pruned {removed} stale {item_type} entries from queue")
        except Exception as e:
            log_act(name, msg("scan_error", name=name, err=str(e)[:100]), "", "error")

    stats["scan_episodes_total"] = len(scanned_episode_ids)
    stats["missing_found"]  = db.queue_count(iid, "sonarr", "episode")
    stats["upgrades_found"] = db.queue_count(iid, "sonarr", "episode_upgrade")
    stats["queue_size"]     = stats["missing_found"] + stats["upgrades_found"]
    stats["scan_status"]    = "idle"
    CONFIG.setdefault("queue_last_scan", {})[iid] = datetime.utcnow().isoformat()
    save_config(CONFIG)
    log_act(
        name,
        msg("scan_done", name=name, n=stats["queue_size"]),
        f"shows scanned: {stats['scan_shows_total']} · episodes scanned: {stats['scan_episodes_total']}",
        "success",
    )


def scan_radarr_instance(inst: dict):
    """Populate queue with ALL missing + upgradeable Radarr movies."""
    iid = inst["id"]; name = inst["name"]
    client = ArrClient(name, inst["url"], inst["api_key"])
    stats = STATE["inst_stats"].setdefault(iid, fresh_inst_stats())
    stats["scan_status"] = "scanning"
    stats["scan_movies_total"] = 0
    log_act(name, msg("scan_start", name=name), "", "info")

    do_upgrades = CONFIG.get("search_upgrades", True)

    missing_ids: set[int] = set()
    scanned_movies_total = 0
    try:
        for movie in client.get("movie"):
            scanned_movies_total += 1
            if not movie.get("monitored") or movie.get("hasFile"):
                continue
            mid = movie.get("id")
            if not mid:
                continue
            missing_ids.add(mid)
            title  = str(movie.get("title", "?"))[:100]
            year   = _year(movie.get("year"))
            label  = f"{title} ({year})" if year else title
            rel_dt = _pick_release_dt(movie, "digitalRelease", "physicalRelease",
                                      "inCinemas", "releaseDate")
            db.queue_upsert(
                service=iid, arr_type="radarr", item_type="movie",
                item_id=mid, title=label,
                release_dt=rel_dt.strftime("%Y-%m-%d") if rel_dt else None,
                release_year=year, last_modified=movie.get("lastInfoSync"),
            )
        db.queue_remove_stale(iid, "movie", missing_ids)
    except Exception as e:
        log_act(name, msg("scan_error", name=name, err=str(e)[:100]), "", "error")

    if do_upgrades:
        upgrade_ids: set[int] = set()
        try:
            data = client.get("wanted/cutoff", params={"pageSize": 1000})
            for movie in data.get("records", []):
                mid = movie.get("id")
                if not mid:
                    continue
                upgrade_ids.add(mid)
                title  = str(movie.get("title", "?"))[:100]
                year   = _year(movie.get("year"))
                label  = f"{title} ({year})" if year else title
                rel_dt = _pick_release_dt(movie, "digitalRelease", "physicalRelease",
                                          "inCinemas", "releaseDate")
                db.queue_upsert(
                    service=iid, arr_type="radarr", item_type="movie_upgrade",
                    item_id=mid, title=label,
                    release_dt=rel_dt.strftime("%Y-%m-%d") if rel_dt else None,
                    release_year=year,
                )
            db.queue_remove_stale(iid, "movie_upgrade", upgrade_ids)
        except Exception as e:
            log_act(name, msg("scan_error", name=name, err=str(e)[:100]), "", "error")

    stats["scan_movies_total"] = scanned_movies_total
    stats["missing_found"]  = db.queue_count(iid, "radarr", "movie")
    stats["upgrades_found"] = db.queue_count(iid, "radarr", "movie_upgrade")
    stats["queue_size"]     = stats["missing_found"] + stats["upgrades_found"]
    stats["scan_status"]    = "idle"
    CONFIG.setdefault("queue_last_scan", {})[iid] = datetime.utcnow().isoformat()
    save_config(CONFIG)
    log_act(
        name,
        msg("scan_done", name=name, n=stats["queue_size"]),
        f"movies scanned: {stats['scan_movies_total']}",
        "success",
    )


def run_scan_if_needed():
    """Scan instances that are overdue for a queue refresh (online instances only)."""
    if not SCAN_LOCK.acquire(blocking=False):
        return None
    STATE["scan_running"] = True
    try:
        to_scan = [
            i for i in CONFIG["instances"]
            if i.get("enabled") and i.get("api_key") and needs_scan(i["id"])
            and STATE["inst_stats"].get(i["id"], {}).get("status") == "online"
        ]
        if not to_scan:
            return 0
        scanned = 0
        for inst in to_scan:
            if STOP_EVENT.is_set():
                break
            if inst["type"] == "sonarr":
                scan_sonarr_instance(inst)
                scanned += 1
            elif inst["type"] == "radarr":
                scan_radarr_instance(inst)
                scanned += 1
        return scanned
    finally:
        STATE["scan_running"] = False
        SCAN_LOCK.release()


# ─── Hunt: Sonarr (dispatch from queue) ──────────────────────────────────────
def hunt_sonarr_instance(inst: dict):
    iid    = inst["id"]; name = inst["name"]
    client = ArrClient(name, inst["url"], inst["api_key"])
    stats  = STATE["inst_stats"][iid]
    mode   = CONFIG.get("sonarr_search_mode", "season")
    do_upgrades = CONFIG.get("search_upgrades", True)

    stats["missing_found"]  = db.queue_count(iid, "sonarr", "episode")
    stats["upgrades_found"] = db.queue_count(iid, "sonarr", "episode_upgrade")
    stats["queue_size"]     = stats["missing_found"] + stats["upgrades_found"]

    cooldown_days = CONFIG.get("cooldown_days", 7)
    items = db.queue_get_pending(iid, "sonarr", cooldown_days, limit=500)
    if not do_upgrades:
        items = [x for x in items if x["item_type"] == "episode"]

    if not items:
        return

    random.shuffle(items)
    searched = 0
    dispatched_keys: set = set()  # within-cycle dedup for season/series mode

    for item in items:
        if STOP_EVENT.is_set() or searched >= CONFIG["max_searches_per_run"]:
            break
        if daily_limit_reached():
            log_act(name, msg("daily_limit", today=_today_count(),
                              limit=CONFIG["daily_limit"]), "", "warning")
            label = "Daily limit reached"
            desc = f"Today: {_today_count()}/{CONFIG['daily_limit']} searches"
            discord_send("limit", label, desc, name)
            return

        item_type  = item["item_type"]
        item_id    = item["item_id"]
        series_id  = item.get("series_id")
        season_num = item.get("season_number")
        title      = item["title"]
        year       = item.get("release_year")

        if mode == "series" and series_id:
            dedup_key = ("series", series_id)
            command   = {"name": "SeriesSearch", "seriesId": series_id}
        elif mode == "season" and series_id and season_num is not None:
            dedup_key = ("season", series_id, season_num)
            command   = {"name": "SeasonSearch", "seriesId": series_id,
                         "seasonNumber": season_num}
        else:
            dedup_key = ("episode", item_id)
            command   = {"name": "EpisodeSearch", "episodeIds": [item_id]}

        if dedup_key in dispatched_keys:
            continue
        dispatched_keys.add(dedup_key)

        result = do_search(client, iid, item_type, item_id, title, command, year=year)
        searched += 1
        if result == "dispatched":
            if "upgrade" in item_type:
                stats["upgrades_searched"] += 1
                log_act(name, msg("upgrade"), title, "warning")
            else:
                stats["missing_searched"] += 1
                log_act(name, msg("missing"), title, "success")
        time.sleep(1.5)


# ─── Hunt: Radarr (dispatch from queue) ──────────────────────────────────────
def hunt_radarr_instance(inst: dict):
    iid    = inst["id"]; name = inst["name"]
    client = ArrClient(name, inst["url"], inst["api_key"])
    stats  = STATE["inst_stats"][iid]
    do_upgrades = CONFIG.get("search_upgrades", True)

    stats["missing_found"]  = db.queue_count(iid, "radarr", "movie")
    stats["upgrades_found"] = db.queue_count(iid, "radarr", "movie_upgrade")
    stats["queue_size"]     = stats["missing_found"] + stats["upgrades_found"]

    cooldown_days = CONFIG.get("cooldown_days", 7)
    items = db.queue_get_pending(iid, "radarr", cooldown_days, limit=500)
    if not do_upgrades:
        items = [x for x in items if x["item_type"] == "movie"]

    if not items:
        return

    random.shuffle(items)
    searched = 0
    for movie in items:
        if STOP_EVENT.is_set() or searched >= CONFIG["max_searches_per_run"]:
            break
        if daily_limit_reached():
            log_act(name, msg("daily_limit", today=_today_count(),
                              limit=CONFIG["daily_limit"]), "", "warning")
            return

        item_type = movie["item_type"]
        item_id   = movie["item_id"]
        title     = movie["title"]
        year      = movie.get("release_year")
        result = do_search(client, iid, item_type, item_id, title,
                           {"name": "MoviesSearch", "movieIds": [item_id]}, year=year)
        searched += 1
        if result == "dispatched":
            if "upgrade" in item_type:
                stats["upgrades_searched"] += 1
                log_act(name, msg("upgrade"), title, "warning")
            else:
                stats["missing_searched"] += 1
                log_act(name, msg("missing"), title, "success")
        time.sleep(1.5)

# ─── Ping ─────────────────────────────────────────────────────────────────────
def ping_all():
    _ensure_inst_stats()
    for inst in CONFIG["instances"]:
        stats = STATE["inst_stats"].setdefault(inst["id"], fresh_inst_stats())
        if not inst.get("enabled") or not inst.get("api_key"):
            stats["status"] = "disabled"
            stats["version"] = "?"
            stats["status_detail"] = "Disabled"
            continue
        ok, ver, detail = ArrClient(inst["name"], inst["url"], inst["api_key"]).ping()
        prev_status = stats.get("status","unknown")
        stats["status"]  = "online" if ok else "offline"
        stats["version"] = ver
        stats["status_detail"] = "" if ok else detail
        # Notify only on transition online→offline
        if not ok and prev_status == "online":
            discord_send("offline", "Instance offline", f"**{inst['name']}** is unreachable", inst["name"])

# ─── Cycle & Loop ─────────────────────────────────────────────────────────────
def run_cycle():
    if not CYCLE_LOCK.acquire(blocking=False):
        logger.info("run_cycle skipped: another cycle is already running")
        return False
    try:
        STATE["cycle_count"] += 1
        STATE["last_run"] = fmt_dt(now_local())
        active = [i for i in CONFIG["instances"] if i.get("enabled") and i.get("api_key")]
        limit  = CONFIG.get("daily_limit",0)
        _today_count(refresh=True)  # prime/reset cycle-local cache
        log_act("System", msg("cycle_start", n=STATE["cycle_count"],
                active=len(active), today=_today_count(), limit=limit or "∞"), "", "info")
        _ensure_inst_stats()
        for inst in CONFIG["instances"]:
            s = STATE["inst_stats"].get(inst["id"], fresh_inst_stats())
            for k in ("missing_searched","upgrades_searched","skipped_cooldown","skipped_daily","skipped_unreleased"):
                s[k] = 0
        ping_all()
        sync_grab_events(force=True)
        run_scan_if_needed()  # populate/refresh queue for overdue instances
        removed = db.purge_expired(CONFIG.get("cooldown_days",7))
        if removed:
            log_act("System", msg("db_pruned", n=removed), "", "info")
            # Notify Discord: items back off cooldown
            discord_send("cooldown", "Cooldown expired", f"{removed} item(s) available again", "System")
        for inst in CONFIG["instances"]:
            if STOP_EVENT.is_set(): break
            if not inst.get("enabled") or not inst.get("api_key"): continue
            if STATE["inst_stats"].get(inst["id"],{}).get("status") != "online":
                log_act(inst["name"], msg("skipped_offline"), "", "warning"); continue
            if inst["type"] == "sonarr":   hunt_sonarr_instance(inst)
            elif inst["type"] == "radarr": hunt_radarr_instance(inst)
        log_act("System", msg("cycle_done", n=STATE["cycle_count"], today=_today_count()), "", "info")
        return True
    finally:
        CYCLE_LOCK.release()

def hunt_loop():
    """Run initial scan + dispatch immediately, then hunt on schedule."""
    STATE["running"] = True
    # Immediate first cycle: scan all instances and start dispatching right away
    if not STOP_EVENT.is_set():
        try: run_cycle()
        except Exception as e: log_act("System", msg("error"), str(e)[:200], "error")
    while not STOP_EVENT.is_set():
        # ── Wait ──
        base  = CONFIG["hunt_missing_delay"]
        delay, jitter = jittered_delay(base)
        next_dt = now_local() + timedelta(seconds=delay)
        STATE["next_run"] = next_dt.strftime("%H:%M:%S")
        # Format jitter as ±Xm for readability
        jitter_min = (f'+{jitter//60}m' if jitter >= 60 else f'+{jitter}s') if jitter else '0s'
        log_act("System", msg("next_run", hhmm=STATE["next_run"], jitter_min=jitter_min), "", "info")
        for _ in range(delay):
            if STOP_EVENT.is_set(): break
            time.sleep(1)
        if STOP_EVENT.is_set(): break
        # ── Hunt ──
        try: run_cycle()
        except Exception as e: log_act("System", msg("error"), str(e)[:200], "error")
    STATE["running"] = False; STATE["next_run"] = None

# ─── Flask Routes ─────────────────────────────────────────────────────────────
@app.route("/")
def index():
    if not CONFIG.get("setup_complete"): return redirect("/setup")
    return render_template("index.html", auth_enabled=auth_enabled(), theme=normalize_theme_name(CONFIG.get("theme", "system")), default_pw=(AUTH_PASSWORD == DEFAULT_PASSWORD))

@app.route("/setup")
def setup_page(): return render_template("setup.html", auth_enabled=auth_enabled(), theme=normalize_theme_name(CONFIG.get("theme", "system")), default_pw=(AUTH_PASSWORD == DEFAULT_PASSWORD))


@app.route("/login", methods=["GET", "POST"])
def login_page():
    if not auth_enabled():
        return redirect("/")
    requested_theme = normalize_theme_name(request.form.get("theme") if request.method == "POST" else request.args.get("theme", CONFIG.get("theme", "system")))
    if request.method == "POST":
        password = request.form.get("password", "")
        if secrets.compare_digest(password, AUTH_PASSWORD):
            if requested_theme in ALLOWED_THEMES and CONFIG.get("theme") != requested_theme:
                CONFIG["theme"] = requested_theme
                save_config(CONFIG)
            session["auth_ok"] = True
            target = sanitize_next_url(request.form.get("next", "/"))
            return redirect(target)
        return render_template("login.html", error="Invalid password", next_path=sanitize_next_url(request.form.get("next", "/")), theme=requested_theme)
    return render_template("login.html", error="", next_path=sanitize_next_url(request.args.get("next", "/")), theme=requested_theme)


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("login_page"))

# ── Setup API ─────────────────────────────────────────────────────────────────
@app.route("/api/setup/ping", methods=["POST"])
def api_setup_ping():
    d = request.get_json(silent=True) or {}
    itype = safe_str(d.get("type",""), 10)
    if itype not in ALLOWED_TYPES: return jsonify({"ok":False,"msg":"Unknown type"}),400
    url = safe_str(d.get("url",""), URL_MAX_LEN)
    ok, err = validate_internal_service_url(url)
    if not ok: return jsonify({"ok":False,"msg":f"Invalid URL: {err}"}),400
    key = safe_str(d.get("api_key",""), 128)
    ok, err = validate_api_key(key)
    if not ok: return jsonify({"ok":False,"msg":f"API Key: {err}"}),400
    try:
        ok, ver, detail = ArrClient(itype, url, key).ping()
        return jsonify({"ok":ok,"version":ver,"msg":detail})
    except: return jsonify({"ok":False,"msg":"Connection failed"})

@app.route("/api/setup/complete", methods=["POST"])
def api_setup_complete():
    d = request.get_json(silent=True) or {}
    instances = d.get("instances",[])
    if not isinstance(instances,list) or len(instances)==0:
        return jsonify({"ok":False,"errors":["At least one instance is required"]}),400
    if len(instances) > MAX_INSTANCES:
        return jsonify({"ok":False,"errors":[f"Maximum {MAX_INSTANCES} instances"]}),400
    errors=[]; validated=[]
    for i, inst in enumerate(instances):
        inst_errors = []
        nm    = safe_str(inst.get("name",""),40).strip()
        itype = safe_str(inst.get("type",""),10)
        url   = safe_str(inst.get("url",""),URL_MAX_LEN)
        key   = safe_str(inst.get("api_key",""),128)
        label = f"#{i+1} ({nm or '?'})"
        ok,e=validate_name(nm)
        if not ok:
            inst_errors.append(f"{label} Name: {e}")
        if itype not in ALLOWED_TYPES:
            inst_errors.append(f"{label}: Unknown type '{itype}'")
        ok,e=validate_url(url)
        if not ok:
            inst_errors.append(f"{label} URL: {e}")
        ok,e=validate_api_key(key)
        if not ok:
            inst_errors.append(f"{label} API Key: {e}")

        if inst_errors:
            errors.extend(inst_errors)
            continue

        raw_id = safe_str(inst.get("id", ""), 64).strip()
        inst_id = raw_id if raw_id and not raw_id.startswith("tmp_") else make_id()
        validated.append({"id":inst_id,"type":itype,
            "name":nm.strip(),"url":url,"api_key":key,"enabled":True})
    if errors: return jsonify({"ok":False,"errors":errors}),400
    lang = "en"
    theme = normalize_theme_name(d.get("theme", CONFIG.get("theme", "system")))
    CONFIG["instances"]      = validated
    CONFIG["language"]       = lang
    if theme in ALLOWED_THEMES:
        CONFIG["theme"] = theme
    CONFIG["setup_complete"] = True
    CONFIG["auto_start"] = False

    # Optional Discord config from wizard
    dc_in = d.get("discord")
    if isinstance(dc_in, dict) and dc_in.get("webhook_url","").strip():
        dc = CONFIG.setdefault("discord", {})
        url = safe_str(dc_in["webhook_url"], 512).strip()
        ok, err = validate_discord_webhook_url(url)
        if not ok:
            return jsonify({"ok": False, "errors": [f"Discord Webhook URL: {err}"]}), 400
        dc["webhook_url"] = url
        dc["enabled"]     = True
        for k in ("notify_missing","notify_upgrade","notify_cooldown",
                  "notify_limit","notify_offline"):
            if k in dc_in: dc[k] = bool(dc_in[k])
        if "rate_limit_cooldown" in dc_in:
            dc["rate_limit_cooldown"] = clamp_int(dc_in.get("rate_limit_cooldown", 5), 1, 300, 5)

    save_config(CONFIG); _ensure_inst_stats()
    log_act("System", "Setup completed", f"{len(validated)} instance(s) saved", "success")
    STOP_EVENT.set()
    STATE["running"] = False
    STATE["next_run"] = None
    return jsonify({"ok":True})

@app.route("/api/setup/reset", methods=["POST"])
def api_setup_reset():
    CONFIG["setup_complete"] = False; save_config(CONFIG); STOP_EVENT.set()
    return jsonify({"ok":True})

# ── Instance CRUD ─────────────────────────────────────────────────────────────
@app.route("/api/instances", methods=["GET"])
def api_instances_get():
    safe = [{k:v for k,v in inst.items() if k!="api_key"} for inst in CONFIG["instances"]]
    return jsonify({"ok":True,"instances":safe,"stats":STATE["inst_stats"]})

@app.route("/api/instances", methods=["POST"])
def api_instances_add():
    if len(CONFIG["instances"]) >= MAX_INSTANCES:
        return jsonify({"ok":False,"error":f"Maximum {MAX_INSTANCES} instances"}),400
    d=request.get_json(silent=True) or {}; errors=[]
    nm=safe_str(d.get("name",""),40); itype=safe_str(d.get("type",""),10)
    url=safe_str(d.get("url",""),URL_MAX_LEN); key=safe_str(d.get("api_key",""),128)
    ok,e=validate_name(nm);    errors+=[f"Name: {e}"]    if not ok else []
    if itype not in ALLOWED_TYPES: errors.append(f"Unknown type '{itype}'")
    ok,e=validate_url(url);    errors+=[f"URL: {e}"]     if not ok else []
    ok,e=validate_api_key(key);errors+=[f"API Key: {e}"] if not ok else []
    if errors: return jsonify({"ok":False,"errors":errors}),400
    inst={"id":make_id(),"type":itype,"name":nm.strip(),"url":url,"api_key":key,"enabled":True}
    CONFIG["instances"].append(inst)
    STATE["inst_stats"][inst["id"]] = fresh_inst_stats()
    save_config(CONFIG); return jsonify({"ok":True,"id":inst["id"]})

@app.route("/api/instances/<inst_id>", methods=["PATCH"])
def api_instances_update(inst_id:str):
    inst = next((i for i in CONFIG["instances"] if i["id"]==inst_id), None)
    if not inst: return jsonify({"ok":False,"error":"Not found"}),404
    d = request.get_json(silent=True) or {}
    if "name" in d:
        nm=safe_str(d["name"],40); ok,e=validate_name(nm)
        if not ok: return jsonify({"ok":False,"error":f"Name: {e}"}),400
        inst["name"] = nm.strip()
    if "url" in d:
        url=safe_str(d["url"],URL_MAX_LEN); ok,e=validate_url(url)
        if not ok: return jsonify({"ok":False,"error":f"URL: {e}"}),400
        inst["url"] = url
    if "api_key" in d and d["api_key"]:
        key=safe_str(d["api_key"],128); ok,e=validate_api_key(key)
        if not ok: return jsonify({"ok":False,"error":f"API Key: {e}"}),400
        inst["api_key"] = key
    if "type" in d:
        itype = safe_str(d.get("type", ""), 10)
        if itype not in ALLOWED_TYPES:
            return jsonify({"ok":False,"error":f"Unknown type '{itype}'"}),400
        inst["type"] = itype
    if "enabled" in d: inst["enabled"] = bool(d["enabled"])
    save_config(CONFIG); return jsonify({"ok":True})

@app.route("/api/instances/<inst_id>", methods=["DELETE"])
def api_instances_delete(inst_id:str):
    before = len(CONFIG["instances"])
    CONFIG["instances"] = [i for i in CONFIG["instances"] if i["id"]!=inst_id]
    if len(CONFIG["instances"]) == before: return jsonify({"ok":False,"error":"Not found"}),404
    STATE["inst_stats"].pop(inst_id,None); save_config(CONFIG)
    return jsonify({"ok":True})

@app.route("/api/instances/<inst_id>/ping")
def api_instances_ping(inst_id:str):
    inst = next((i for i in CONFIG["instances"] if i["id"]==inst_id), None)
    if not inst: return jsonify({"ok":False,"error":"Not found"}),404
    if not inst.get("api_key"): return jsonify({"ok":False,"msg":"Missing API key"})
    try:
        ok, ver, detail = ArrClient(inst["name"],inst["url"],inst["api_key"]).ping()
        stats = STATE["inst_stats"].setdefault(inst_id,fresh_inst_stats())
        stats["status"] = "online" if ok else "offline"
        stats["version"] = ver
        stats["status_detail"] = "" if ok else detail
        return jsonify({"ok":ok,"version":ver,"msg":detail})
    except: return jsonify({"ok":False,"msg":"Connection failed"})

# ── Main API ──────────────────────────────────────────────────────────────────
@app.route("/api/state")
def api_state():
    today_n=_today_count(refresh=True); limit=CONFIG.get("daily_limit",0)
    instances_safe=[{k:v for k,v in i.items() if k!="api_key"} for i in CONFIG["instances"]]
    return jsonify({
        "running":STATE["running"],"last_run":STATE["last_run"],
        "next_run":STATE["next_run"],"cycle_count":STATE["cycle_count"],
        "total_searches":db.total_count(),"daily_count":today_n,
        "daily_limit":limit,"daily_remaining":max(0,limit-today_n) if limit>0 else None,
        "inst_stats":STATE["inst_stats"],"instances":instances_safe,
        "server_time": fmt_time(now_local()),
        "server_tz":   CONFIG.get("timezone", OS_TIMEZONE),
        "activity_log":list(STATE["activity_log"])[:60],
        "scan_running":    STATE.get("scan_running", False),
        "queue_last_scan": CONFIG.get("queue_last_scan", {}),
        "config":{
            "hunt_missing_delay":   CONFIG["hunt_missing_delay"],
            "hunt_upgrade_delay":   CONFIG["hunt_upgrade_delay"],
            "max_searches_per_run": CONFIG["max_searches_per_run"],
            "daily_limit":          CONFIG.get("daily_limit",20),
            "cooldown_days":        CONFIG.get("cooldown_days",7),
            "request_timeout":      CONFIG.get("request_timeout",30),
            "jitter_max":           CONFIG.get("jitter_max",300),
            "sonarr_search_mode":   CONFIG.get("sonarr_search_mode","season"),
            "search_upgrades":      CONFIG.get("search_upgrades",True),
            "scan_interval_days":   CONFIG.get("scan_interval_days",7),
            "dry_run":              CONFIG["dry_run"],
            "language":             CONFIG["language"],
            "theme":                normalize_theme_name(CONFIG.get("theme","system")),
            "timezone":             CONFIG.get("timezone", OS_TIMEZONE),
            "auto_start":           CONFIG["auto_start"],
            "instance_count":       len(CONFIG["instances"]),
            "discord": {
                k: v for k, v in CONFIG.get("discord", {}).items()
                if k not in ("webhook_url", "stats_last_sent_at")  # never expose
            },
            "discord_configured": bool(CONFIG.get("discord",{}).get("webhook_url","")),
            "discord_webhook_set": bool(CONFIG.get("discord",{}).get("webhook_url","")),
        },
    })

@app.route("/api/control", methods=["POST"])
def api_control():
    global hunt_thread
    d=request.get_json(silent=True) or {}; action=d.get("action")
    if action not in ALLOWED_ACTIONS: return jsonify({"ok":False,"error":"Invalid action"}),400
    if action=="start" and not STATE["running"]:
        CONFIG["auto_start"] = True
        CONFIG["last_boot_build_id"] = APP_BUILD_ID
        CONFIG["last_boot_version"] = APP_VERSION
        save_config(CONFIG)
        STOP_EVENT.clear(); hunt_thread=threading.Thread(target=hunt_loop,daemon=True); hunt_thread.start()
    elif action=="stop":
        CONFIG["auto_start"] = False
        save_config(CONFIG)
        STOP_EVENT.set()
    elif action=="run_now":
        if not STATE["running"]:
            STOP_EVENT.clear(); threading.Thread(target=run_cycle,daemon=True).start()
        else: threading.Thread(target=run_cycle,daemon=True).start()
    return jsonify({"ok":True})

@app.route("/api/config", methods=["POST"])
def api_config():
    d=request.get_json(silent=True)
    if d is None: return jsonify({"ok":False,"error":"Invalid JSON"}),400
    # Enforce minimum 15 minute interval
    raw_delay = clamp_int(d.get("hunt_missing_delay", CONFIG["hunt_missing_delay"]), MIN_INTERVAL_SEC, 86400, CONFIG["hunt_missing_delay"])
    CONFIG["hunt_missing_delay"]   = raw_delay
    CONFIG["hunt_upgrade_delay"]   = clamp_int(d.get("hunt_upgrade_delay",   CONFIG["hunt_upgrade_delay"]),   MIN_INTERVAL_SEC, 86400, CONFIG["hunt_upgrade_delay"])
    CONFIG["max_searches_per_run"] = clamp_int(d.get("max_searches_per_run", CONFIG["max_searches_per_run"]), 1, 500, CONFIG["max_searches_per_run"])
    CONFIG["daily_limit"]          = clamp_int(d.get("daily_limit",          CONFIG.get("daily_limit",20)),   0, 9999, CONFIG.get("daily_limit",20))
    CONFIG["cooldown_days"]        = clamp_int(d.get("cooldown_days",        CONFIG.get("cooldown_days",7)),  1, 365, CONFIG.get("cooldown_days",7))
    CONFIG["request_timeout"]      = clamp_int(d.get("request_timeout",      CONFIG.get("request_timeout",30)),5, 300, 30)
    CONFIG["jitter_max"]           = clamp_int(d.get("jitter_max",           CONFIG.get("jitter_max",300)),   0, 3600, 300)
    if "dry_run"           in d: CONFIG["dry_run"]           = bool(d["dry_run"])
    if "auto_start"        in d: CONFIG["auto_start"]        = bool(d["auto_start"])
    if "search_upgrades"   in d: CONFIG["search_upgrades"]   = bool(d["search_upgrades"])
    if "scan_interval_days" in d:
        CONFIG["scan_interval_days"] = clamp_int(d["scan_interval_days"], 1, 365, 7)
    mode = safe_str(d.get("sonarr_search_mode",""), 10)
    if mode in ALLOWED_SONARR_MODES: CONFIG["sonarr_search_mode"] = mode
    theme = normalize_theme_name(safe_str(d.get("theme", CONFIG.get("theme","system")), 32))
    if theme in ALLOWED_THEMES: CONFIG["theme"] = theme
    CONFIG["language"] = "en"
    tz = safe_str(d.get("timezone", CONFIG.get("timezone", OS_TIMEZONE)), 50)
    try: zoneinfo.ZoneInfo(tz); CONFIG["timezone"] = tz
    except Exception: pass  # keep current if invalid

    # Discord settings
    if "discord" in d and isinstance(d["discord"], dict):
        dc_in = d["discord"]
        dc    = CONFIG.setdefault("discord", {})
        for bool_key in ("enabled","notify_missing","notify_upgrade",
                         "notify_cooldown","notify_limit","notify_offline","notify_stats"):
            if bool_key in dc_in: dc[bool_key] = bool(dc_in[bool_key])
        if "stats_interval_min" in dc_in:
            dc["stats_interval_min"] = clamp_int(dc_in.get("stats_interval_min", 60), 1, 10080, 60)
        if "rate_limit_cooldown" in dc_in:
            dc["rate_limit_cooldown"] = clamp_int(dc_in.get("rate_limit_cooldown", 5), 1, 300, 5)
        if "webhook_url" in dc_in:
            url = safe_str(dc_in["webhook_url"], 512).strip()
            ok, err = (True, "") if url == "" else validate_discord_webhook_url(url)
            if not ok:
                return jsonify({"ok":False,"error":f"Discord Webhook URL: {err}"}),400
            if url == "" or ok:
                dc["webhook_url"] = url
    save_config(CONFIG); return jsonify({"ok":True})

# ── History API ───────────────────────────────────────────────────────────────
@app.route("/api/history")
def api_history():
    svc=safe_str(request.args.get("service",""),40)
    only_cd=request.args.get("cooldown_only")=="1"
    cd_days=CONFIG.get("cooldown_days",7)
    rows=db.get_history(300,svc,only_cd,cd_days)
    now=datetime.utcnow()
    for r in rows:
        ts=datetime.fromisoformat(r["searched_at"]); ago=now-ts; mins=int(ago.total_seconds()/60)
        r["ago_label"]=(f"{mins}m ago" if mins<60 else f"{mins//60}h ago" if mins<1440 else f"{mins//1440}d ago")
        r["expires_label"]=(ts+timedelta(days=cd_days)).strftime("%Y-%m-%d %H:%M")
        inst = next((i for i in CONFIG["instances"] if i["id"] == r["service"]), None)
        if inst:
            r["instance_name"] = inst.get("name", r["service"])
            r["instance_type"] = inst.get("type", "")
        else:
            r["instance_name"] = r["service"]
            r["instance_type"] = ""
    return jsonify({"ok":True,"count":len(rows),"history":rows})

@app.route("/api/history/stats")
def api_history_stats():
    return jsonify({"ok":True,"total":db.total_count(),"today":_today_count(refresh=True),
                    "by_service":db.stats_by_service(),"by_year":db.year_stats()})

@app.route("/api/history/clear", methods=["POST"])
def api_history_clear():
    CONFIG["daily_count_reset_at"] = datetime.utcnow().isoformat()
    save_config(CONFIG)
    n = db.clear_all()
    _today_count(refresh=True)
    log_act("System", "DB cleared", f"{n} entries", "warning")
    return jsonify({"ok":True,"removed":n})

@app.route("/api/history/clear/<inst_id>", methods=["POST"])
def api_history_clear_inst(inst_id:str):
    targets = []
    if inst_id in ALLOWED_TYPES:
        targets = [i["id"] for i in CONFIG["instances"] if i.get("type") == inst_id]
    else:
        targets = [inst_id]

    n = 0
    for target in targets:
        n += db.clear_service(target)
    _today_count(refresh=True)
    log_act("System", f"DB cleared ({inst_id})", f"{n} entries", "warning")
    return jsonify({"ok":True,"removed":n})

# ── Timezone helper ───────────────────────────────────────────────────────────
@app.route("/api/timezones")
def api_timezones():
    """Return common timezone list for the settings dropdown."""
    common = [
        "UTC","Europe/Berlin","Europe/Vienna","Europe/Zurich","Europe/London",
        "Europe/Paris","Europe/Amsterdam","Europe/Rome","Europe/Madrid",
        "America/New_York","America/Chicago","America/Denver","America/Los_Angeles",
        "America/Sao_Paulo","Asia/Tokyo","Asia/Shanghai","Asia/Kolkata",
        "Asia/Dubai","Australia/Sydney","Pacific/Auckland",
    ]
    return jsonify({"ok":True,"timezones":common})

# ── Discord test endpoint ─────────────────────────────────────────────────────
@app.route("/api/discord/test", methods=["POST"])
def api_discord_test():
    dc = CONFIG.get("discord", {})
    if not dc.get("webhook_url",""):
        return jsonify({"ok":False,"error":"No webhook URL configured"}),400
    label = "🔔 MediaHunter Test"
    desc  = "This is a test notification from MediaHunter v1.0 Beta.\nIf you see this, the webhook is configured correctly."
    f_status  = "Status"
    f_ok      = "✓ Connected"
    f_ver     = "Version"
    f_inst    = "Instances"
    f_enabled = "Notifications"
    enabled_parts = [
        "Missing" if dc.get("notify_missing") else "",
        "Upgrade" if dc.get("notify_upgrade") else "",
        "Cooldown" if dc.get("notify_cooldown") else "",
    ]
    enabled_text = " ".join([p for p in enabled_parts if p]) or "—"

    active = len([i for i in CONFIG["instances"] if i.get("enabled")])
    fields = [
        {"name": f_status,  "value": f_ok, "inline": True},
        {"name": f_ver,     "value": "v1.0 Beta", "inline": True},
        {"name": f_inst,    "value": str(active), "inline": True},
        {"name": f_enabled, "value": enabled_text, "inline": False},
    ]
    # Force-send bypassing toggle/cooldown
    saved_enabled = dc.get("enabled", False)
    dc["enabled"] = True
    discord_send("info", label, desc, "System", fields=fields, force=True)
    dc["enabled"] = saved_enabled
    return jsonify({"ok": True})


@app.route("/api/discord/stats", methods=["POST"])
def api_discord_stats_now():
    """Manually trigger a stats report."""
    dc = CONFIG.get("discord", {})
    if not dc.get("webhook_url",""):
        return jsonify({"ok":False,"error":"No webhook URL"}),400
    discord_send_stats()
    return jsonify({"ok": True})


# ── Queue management ──────────────────────────────────────────────────────────
@app.route("/api/queue/scan", methods=["POST"])
def api_queue_scan():
    """Trigger an immediate full rescan of all instances (clears and rebuilds queue)."""
    if STATE.get("scan_running"):
        log_act("System", "Initial DB scan request ignored", "A scan is already in progress", "warning")
        return jsonify({"ok": False, "error": "Scan already in progress"}), 409
    configured = len(CONFIG.get("instances", []))
    enabled = sum(1 for inst in CONFIG.get("instances", []) if inst.get("enabled") and inst.get("api_key"))
    online = sum(
        1
        for inst in CONFIG.get("instances", [])
        if inst.get("enabled") and inst.get("api_key")
        and STATE["inst_stats"].get(inst.get("id"), {}).get("status") == "online"
    )
    log_act("System", "Initial DB scan requested", f"configured: {configured} · eligible config: {enabled}", "info")
    CONFIG["queue_last_scan"] = {}
    save_config(CONFIG)
    def _bg():
        try:
            log_act("System", "Initial DB scan started", "Refreshing instance status before queue rebuild", "info")
            ping_all()
            _ensure_inst_stats()
            eligible = [
                inst for inst in CONFIG["instances"]
                if inst.get("enabled") and inst.get("api_key")
                and STATE["inst_stats"].get(inst["id"], {}).get("status") == "online"
            ]
            if not eligible:
                log_act(
                    "System",
                    "Initial DB scan skipped",
                    f"No online enabled instances available (configured: {configured}, enabled: {enabled}, online: 0)",
                    "warning",
                )
                return
            scanned = run_scan_if_needed()
            if scanned is None:
                log_act("System", "Initial DB scan skipped", "Another scan is already running", "warning")
                return
            if scanned == 0:
                log_act("System", "Initial DB scan completed", "No instances required a queue rebuild", "info")
                return
            queue_items = sum(db.queue_count(inst["id"]) for inst in eligible)
            log_act("System", "Initial DB scan completed", f"instances scanned: {scanned} · queue items: {queue_items}", "success")
        except Exception as e:
            logger.exception("Initial DB scan failed")
            log_act("System", "Initial DB scan failed", str(e)[:200], "error")
    threading.Thread(target=_bg, daemon=True).start()
    return jsonify({
        "ok": True,
        "message": "Scan started",
        "configured": configured,
        "enabled": enabled,
        "online": online,
    })


@app.route("/api/queue/stats")
def api_queue_stats():
    stats = {}
    for inst in CONFIG["instances"]:
        iid   = inst["id"]
        atype = inst.get("type", "sonarr")
        mt    = "episode" if atype == "sonarr" else "movie"
        mtu   = "episode_upgrade" if atype == "sonarr" else "movie_upgrade"
        stats[iid] = {
            "name":      inst["name"],
            "type":      atype,
            "total":     db.queue_count(iid),
            "missing":   db.queue_count(iid, atype, mt),
            "upgrades":  db.queue_count(iid, atype, mtu),
            "last_scan": CONFIG.get("queue_last_scan", {}).get(iid),
        }
    return jsonify({
        "ok":           True,
        "stats":        stats,
        "scan_running": STATE.get("scan_running", False),
    })


# ─── Startup ──────────────────────────────────────────────────────────────────
_startup_lock = threading.Lock()
_startup_done = False


def start_runtime():
    global _startup_done, hunt_thread
    with _startup_lock:
        if _startup_done:
            return
        _startup_done = True
    log_act("System", msg("app_start"), "", "info")
    if AUTH_PASSWORD == DEFAULT_PASSWORD:
        logger.warning("MEDIAHUNTER_PASSWORD is set to the insecure default 'change-me' — update it before exposing this instance to a network.")
    if CONFIG.get("setup_complete"):
        _ensure_inst_stats(); ping_all()
        prev_build_id = safe_str(CONFIG.get("last_boot_build_id", ""), 64)
        if not prev_build_id:
            prev_build_id = safe_str(CONFIG.get("last_boot_version", ""), 32)
        first_boot_after_setup = not prev_build_id
        is_build_update = bool(prev_build_id) and prev_build_id != APP_BUILD_ID
        if first_boot_after_setup or is_build_update:
            CONFIG["auto_start"] = False
            CONFIG["last_boot_build_id"] = APP_BUILD_ID
            CONFIG["last_boot_version"] = APP_VERSION
            save_config(CONFIG)
        STOP_EVENT.set()
        STATE["running"] = False
        STATE["next_run"] = None
        if CONFIG.get("auto_start", False):
            STOP_EVENT.clear()
            hunt_thread = threading.Thread(target=hunt_loop, daemon=True)
            hunt_thread.start()
            log_act("System", msg("auto_start"), "", "info")
        elif is_build_update:
            log_act("System", "Stopped after update - press Start to resume", "", "info")
    else:
        log_act("System", msg("setup_required", setup_url=setup_url_for_logs()), "", "warning")


start_runtime()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=7979, debug=False)



