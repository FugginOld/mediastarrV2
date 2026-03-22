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
- Setup wizard language selection was removed; setup is now English-only and starts directly with instance configuration.
- Setup flow now uses three steps (`Instances`, `Discord`, `Done`) instead of four.
- Setup completion now disables automatic hunt start by default.
- Dashboard now prompts for an initial full Sonarr/Radarr queue scan after setup and includes a manual `Initial DB Scan` control.
- Daily limit accounting now uses confirmed downloader requests (`grabbed` events from Arr history) instead of counting search command dispatches.
- Existing configs with legacy `UTC` defaults now migrate to detected host OS timezone when possible.

### Fixed
- Removed duplicate sidebar logo markup that could render an extra blank icon next to the MediaHunter logo.



