"""Compatibility shim for legacy app.db imports.

Primary database module now lives in src.mediahunter.db.
"""

from pathlib import Path
import sys

# Ensure project root is on sys.path so src package can be imported.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.mediahunter.db import *  # noqa: F401,F403
