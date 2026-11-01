import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "engine"))
sys.path.insert(0, os.path.dirname(__file__))

import tempfile  # noqa: E402

# tests never write into the real audio cache
os.environ.setdefault("ASISTENT_CACHE_DIR", tempfile.mkdtemp(prefix="asistent-cache-"))
