# src

Main source-code folder.

Primary runtime package: `src/mediahunter/`.

Compatibility note: `app/` now contains thin shim modules that re-export
from `src.mediahunter.*`, so runtime logic is maintained in one place.
