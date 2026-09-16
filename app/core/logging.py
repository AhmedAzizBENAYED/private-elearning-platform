"""JSON logs for the application and Uvicorn, written to standard output."""

import json
import logging
from datetime import datetime, timezone
from logging.config import dictConfig


class JsonFormatter(logging.Formatter):
    """Emit one JSON object per line with a small, explicit set of fields."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(
                record.created, tz=timezone.utc
            ).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for field in ("environment", "method", "path", "status_code"):
            if hasattr(record, field):
                payload[field] = getattr(record, field)

        # Uvicorn's default message contains the query string. Keep only the path.
        if record.name == "uvicorn.access" and isinstance(record.args, tuple):
            if len(record.args) == 5:
                _, method, target, _, status_code = record.args
                payload.update(
                    message="HTTP request completed",
                    method=method,
                    path=str(target).partition("?")[0],
                    status_code=status_code,
                )

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=True, default=str)


def configure_logging(level: str = "INFO") -> None:
    """Replace server handlers to avoid duplicate or mixed-format worker logs."""
    dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {"json": {"()": JsonFormatter}},
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "level": level,
                    "formatter": "json",
                    "stream": "ext://sys.stdout",
                },
            },
            "root": {"handlers": ["console"], "level": level},
            "loggers": {
                name: {"handlers": [], "level": level, "propagate": True}
                for name in ("uvicorn", "uvicorn.error", "uvicorn.access")
            },
        }
    )
