import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "engine"))
sys.path.insert(0, os.path.dirname(__file__))

import tempfile  # noqa: E402

# tests never write into the real audio cache
os.environ.setdefault("ASISTENT_CACHE_DIR", tempfile.mkdtemp(prefix="asistent-cache-"))

import warnings  # noqa: E402

import pytest  # noqa: E402

# sentencepiece (the English line's translator) is built with SWIG, which on Python 3.12 warns "builtin type SwigPyObject has
# no __module__ attribute" while the library sets itself up and when it makes its objects. Under `-W error` (the test command
# in CLAUDE.md) the warning becomes an error inside the library's C code, which leaves it half set up: Python then crashes
# with a segmentation fault while loading the model (the "translator tests crash pytest" bug) or when it unloads the library
# at exit after every test passed (macOS: "Python quit unexpectedly"). Measured 2026-11-12: `python -W error -c "import
# sentencepiece"` exits 139; with only this warning ignored, 0. The engine never runs with -W error: a test-only problem.
# So the library is imported here once with only this warning ignored, and each test ignores it too.
SWIG = dict(action="ignore", message=r"builtin type [Ss]wig\w* has no __module__ attribute", category=DeprecationWarning)
with warnings.catch_warnings():
    warnings.filterwarnings(**SWIG)
    try:
        import sentencepiece  # noqa: E402,F401
    except ImportError:
        pass


@pytest.fixture(autouse=True)
def _swig_warning_is_not_an_error():
    warnings.filterwarnings(**SWIG)        # inside each test's own warning filters, where -W error is applied
    yield
