"""Small helpers for writing local deployment evidence without broad permissions."""

from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
from typing import Any


def write_private_json(output: Path, value: Any) -> None:
    """Atomically write JSON with owner-only directory and file permissions."""

    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(output.parent, 0o700)
    payload = json.dumps(value, indent=2) + "\n"
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=output.parent,
        prefix=f".{output.name}.",
        delete=False,
    ) as handle:
        temporary_output = Path(handle.name)
        os.chmod(temporary_output, 0o600)
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary_output, output)
