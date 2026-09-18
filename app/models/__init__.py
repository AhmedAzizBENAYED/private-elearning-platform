"""Discover future ORM model modules without maintaining a manual import list."""

from importlib import import_module
from pkgutil import walk_packages


def load_models() -> None:
    """Register models with Base.metadata by importing all modules in this package.

    Keep model modules limited to declarations, with no connections or HTTP imports.
    Python caches imports, so repeated calls do not redefine models.
    """
    for module in sorted(
        walk_packages(__path__, prefix=f"{__name__}."), key=lambda item: item.name
    ):
        import_module(module.name)
