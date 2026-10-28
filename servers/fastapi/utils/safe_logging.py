import logging
from typing import Any

_CONTROL_ESCAPES = {
    code: f"\\x{code:02x}"
    for code in (*range(32), *range(127, 160))
}
_CONTROL_ESCAPES.update({9: "\\t", 0x2028: "\\u2028", 0x2029: "\\u2029"})


def safe_log(logger: logging.Logger, level: int, message: object, *args: Any, **kwargs: Any) -> None:
    """Escape message controls after standard formatting; retain traceback metadata."""
    if not logger.isEnabledFor(level):
        return
    try:
        record = logging.LogRecord(logger.name, level, "", 0, message, args, None)
        rendered = record.getMessage()
    except Exception:
        # Logging failures must not turn an otherwise valid request into an error.
        rendered = "Unable to format diagnostic message"
    rendered = rendered.replace("\r", "\\r").replace("\n", "\\n").replace("\x1b", "\\x1b")
    rendered = rendered.translate(_CONTROL_ESCAPES)
    kwargs["stacklevel"] = kwargs.get("stacklevel", 1) + 1
    logger.log(level, rendered, **kwargs)


def safe_log_exception(logger: logging.Logger, message: object, *args: Any, **kwargs: Any) -> None:
    kwargs.setdefault("exc_info", True)
    kwargs["stacklevel"] = kwargs.get("stacklevel", 1) + 1
    safe_log(logger, logging.ERROR, message, *args, **kwargs)
