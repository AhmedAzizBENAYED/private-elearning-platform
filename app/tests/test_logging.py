"""Machine-readable logs, exception details, and access-log query omission."""

import json
import logging
import sys
from datetime import datetime, timedelta

import pytest

from app.core.logging import JsonFormatter, configure_logging


def test_json_log_has_timestamp_and_structured_context() -> None:
    record = logging.LogRecord("app", logging.INFO, __file__, 1, "Started %s", ("API",), None)
    record.environment = "test"

    payload = json.loads(JsonFormatter().format(record))

    assert payload["level"] == "INFO"
    assert payload["logger"] == "app"
    assert payload["message"] == "Started API"
    assert payload["environment"] == "test"
    assert datetime.fromisoformat(payload["timestamp"]).utcoffset() == timedelta(0)


def test_access_log_omits_query_string() -> None:
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1:5000", "GET", "/api/v1/health?token=private-value", "1.1", 200),
        None,
    )

    output = JsonFormatter().format(record)
    payload = json.loads(output)

    assert payload["method"] == "GET"
    assert payload["path"] == "/api/v1/health"
    assert payload["status_code"] == 200
    assert "private-value" not in output


def test_exception_remains_a_single_json_line() -> None:
    try:
        raise RuntimeError("Example failure")
    except RuntimeError:
        record = logging.LogRecord(
            "app", logging.ERROR, __file__, 1, "Request failed", (), sys.exc_info()
        )

    output = JsonFormatter().format(record)

    assert len(output.splitlines()) == 1
    assert "RuntimeError: Example failure" in json.loads(output)["exception"]


def test_logging_configuration_avoids_duplicates_and_honors_level(
    capsys: pytest.CaptureFixture[str],
) -> None:
    configure_logging("WARNING")
    configure_logging("WARNING")
    logging.getLogger("app").info("Filtered out")
    logging.getLogger("uvicorn.error").warning("Server warning")

    lines = capsys.readouterr().out.splitlines()

    assert len(lines) == 1
    assert json.loads(lines[0])["message"] == "Server warning"
