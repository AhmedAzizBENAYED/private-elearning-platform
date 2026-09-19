"""Provider-neutral storage port and its adapters.

This package must not import the application's domain or configuration at module
level: ``app.core.config`` depends on :mod:`app.storage.models` for the provider
enum. Use :mod:`app.storage.factory` to build a configured adapter.
"""
