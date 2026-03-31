"""
logging_config.py — STAAX file logging setup.

Creates two rotating log files in ~/STAXX/logs/:
  staax_engine.log  — INFO and above (full engine activity)
  staax_errors.log  — ERROR and above only (quick triage)

Both rotate daily and retain 30 days of history.
Call setup_logging() once at the top of main.py lifespan.
"""
import logging
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path


def setup_logging() -> None:
    log_dir = Path.home() / "STAXX" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    formatter = logging.Formatter(
        "%(asctime)s IST | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Engine log — INFO and above
    engine_handler = TimedRotatingFileHandler(
        log_dir / "staax_engine.log",
        when="midnight",
        backupCount=30,
        encoding="utf-8",
    )
    engine_handler.setLevel(logging.INFO)
    engine_handler.setFormatter(formatter)

    # Error log — ERROR and above only
    error_handler = TimedRotatingFileHandler(
        log_dir / "staax_errors.log",
        when="midnight",
        backupCount=30,
        encoding="utf-8",
    )
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(formatter)

    root = logging.getLogger()
    root.addHandler(engine_handler)
    root.addHandler(error_handler)

    logging.getLogger(__name__).info(
        f"File logging active — {log_dir}/staax_engine.log (INFO+), staax_errors.log (ERROR+)"
    )
