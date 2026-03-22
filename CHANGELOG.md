# Changelog

## [1.0 Beta] - 2026-03-22

### Added
- Initial public beta release of MediaHunter.
- Multi-instance support for Sonarr and Radarr.
- Web dashboard with setup wizard and instance management.
- SQLite search history with cooldown support.
- Daily limit, jitter, and configurable search behavior.
- Discord notifications with event toggles and statistics reports.
- Docker and Unraid deployment support.

### Changed
- Project is English-only across UI, logs, API messages, and documentation.
- UI theme system updated to four options: System (auto light/dark), GitHub Inspired, Discord Inspired, and Plex Inspired.
- Theme selection is now consistent across dashboard, setup wizard, and login page.
- Legacy theme names (`dark`, `light`, `oled`) now normalize to `system`.
- Default timezone now follows the OS timezone while remaining user-configurable.
- Frontend styling was reorganized into shared CSS assets (`theme-system.css`, `auth-common.css`, `ui-primitives.css`, `status-primitives.css`) for easier maintenance.



