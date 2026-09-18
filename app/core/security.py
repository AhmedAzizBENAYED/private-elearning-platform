"""Argon2id password primitives. Async callers must offload this CPU/memory work."""

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from argon2.profiles import RFC_9106_LOW_MEMORY

_password_hasher = PasswordHasher.from_parameters(RFC_9106_LOW_MEMORY)


def hash_password(password: str) -> str:
    """Hash with a fresh random salt; never persist or log the input."""
    return _password_hasher.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    """Fail closed for incorrect passwords and malformed stored hashes."""
    try:
        return _password_hasher.verify(hashed_password, password)
    except (VerificationError, InvalidHashError):
        return False
