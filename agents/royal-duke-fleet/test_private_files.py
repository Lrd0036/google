from __future__ import annotations

import json
from pathlib import Path
import stat
import tempfile
import unittest

from private_files import write_private_json


class WritePrivateJsonTest(unittest.TestCase):
    def test_writes_atomically_with_owner_only_permissions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "evidence" / "runtime.json"
            write_private_json(output, {"status": "ok"})

            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), {"status": "ok"})
            self.assertEqual(stat.S_IMODE(output.parent.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
