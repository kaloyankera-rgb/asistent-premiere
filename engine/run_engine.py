"""Start the engine from any working directory (used by the LaunchAgent / Windows Startup shortcut)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from asistent.server import main  # noqa: E402

sys.exit(main())
