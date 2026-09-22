"""The example configuration must not reintroduce the two-second connection.

`docker-compose.yml` publishes PostgreSQL on ``127.0.0.1`` only, which is IPv4.
Naming the host ``localhost`` in ``DATABASE_URL`` makes a resolver that returns
``::1`` first - the default on Windows - attempt an address nothing listens on.
The refused IPv6 connection takes about two seconds to give up before falling
back to IPv4, and that is paid on every *new* pool connection rather than once.

A single request reuses a pooled connection and is unaffected, which is what
made this so hard to see: the application measures fast until several requests
arrive together and the pool has to grow, and then each of them waits ~2 s.

Measured on the machine this was found on: one connection takes 2102 ms via
``localhost`` and 47 ms via ``127.0.0.1``; five at once, 2183 ms against 166 ms.
"""

from pathlib import Path
from urllib.parse import urlsplit

import pytest

ROOT = Path(__file__).resolve().parents[2]


def settings_of(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        values[name.strip()] = value.strip().strip('"').strip("'")
    return values


def test_the_example_database_url_names_a_literal_address() -> None:
    url = settings_of(ROOT / ".env.example")["DATABASE_URL"]

    # The credentials are shell interpolations here, so only the host matters.
    host = urlsplit(url).hostname
    assert host == "127.0.0.1", (
        "DATABASE_URL must name 127.0.0.1; 'localhost' costs ~2 s per new "
        "pool connection when the resolver prefers ::1"
    )


def test_the_database_port_is_published_on_the_same_address() -> None:
    """The pair is what matters: a published address and a host that reaches it."""
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")

    assert "127.0.0.1:" in compose, "the database is expected to be published on IPv4 loopback"
    # If the binding is ever widened, the URL above may be revisited - but it
    # must never be the case that the URL names a name the binding cannot serve.
    assert "0.0.0.0:" not in compose


@pytest.mark.parametrize("name", ["POSTGRES_USER", "POSTGRES_DB", "DATABASE_POOL_SIZE"])
def test_the_example_still_documents_the_settings_the_application_reads(name: str) -> None:
    assert name in settings_of(ROOT / ".env.example")
