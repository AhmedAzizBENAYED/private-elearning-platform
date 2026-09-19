"""Provider-neutral storage failures.

Adapters must raise only these types. Vendor exception classes, URLs, request
bodies and credentials never cross the port, so services can map failures to
HTTP status codes without importing an SDK.
"""


class StorageError(Exception):
    """Base class for every failure reported through the storage port."""


class StorageUnavailable(StorageError):
    """The provider could not be reached, timed out, or failed server-side."""


class StorageAuthError(StorageUnavailable):
    """The configured credentials were rejected or could not be refreshed.

    Deliberately a subclass of :class:`StorageUnavailable`: callers must treat it
    as a server-side outage, never as a client authorization problem.
    """


class ObjectNotFound(StorageError):
    """The referenced object does not exist at the provider."""


class PayloadTooLarge(StorageError):
    """The upload exceeded the configured maximum size."""


class InvalidStorageKey(StorageError):
    """A storage key was malformed, absolute, or contained traversal segments."""
