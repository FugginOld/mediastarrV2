"""Compatibility shim for legacy app.main imports.

Primary runtime module now lives in src.mediahunter.main.
"""

from pathlib import Path
import sys

# Ensure project root is on sys.path so src package can be imported.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.mediahunter.main import *  # noqa: F401,F403

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=7979, debug=False)
