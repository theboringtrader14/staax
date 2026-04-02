"""
execution_errors.py — Structured error codes for STAAX execution layer.

Used by _pre_execution_check() and any component that reports a blocked/failed
execution event. Extends str so codes serialise cleanly in logs and DB records.
"""
from enum import Enum


class ExecutionErrorCode(str, Enum):
    TOKEN_INVALID            = "TOKEN_INVALID"
    API_KEY_INVALID          = "API_KEY_INVALID"
    FEED_INACTIVE            = "FEED_INACTIVE"
    LTP_UNAVAILABLE          = "LTP_UNAVAILABLE"
    OPTION_CHAIN_FAILED      = "OPTION_CHAIN_FAILED"
    STRIKE_NOT_FOUND         = "STRIKE_NOT_FOUND"
    INSTRUMENT_TOKEN_MISSING = "INSTRUMENT_TOKEN_MISSING"
    DB_ERROR                 = "DB_ERROR"
    PRE_CHECK_FAILED         = "PRE_CHECK_FAILED"
    UNKNOWN                  = "UNKNOWN"
