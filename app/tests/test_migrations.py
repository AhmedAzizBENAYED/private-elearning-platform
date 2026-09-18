"""Model discovery and migration configuration without touching PostgreSQL."""

import importlib
import io
import shutil
import sys
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

import app.models
from app.core.config import PROJECT_ROOT
from app.database.base import Base


def test_nested_models_are_discovered_and_registered_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    package = tmp_path / "discovery_probe"
    package.mkdir()
    (package / "__init__.py").write_text("", encoding="utf-8")
    (package / "metadata.py").write_text(
        "from sqlalchemy import Column, Integer, Table\n"
        "from app.database.base import Base\n"
        "Table('_discovery_probe', Base.metadata, Column('id', Integer, primary_key=True))\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(app.models, "__path__", [str(tmp_path)])
    importlib.invalidate_caches()
    try:
        app.models.load_models()
        table = Base.metadata.tables["_discovery_probe"]
        app.models.load_models()
        assert Base.metadata.tables["_discovery_probe"] is table
        assert table.primary_key.name == "pk__discovery_probe"
    finally:
        if "_discovery_probe" in Base.metadata.tables:
            Base.metadata.remove(Base.metadata.tables["_discovery_probe"])
        for name in tuple(sys.modules):
            if name.startswith("app.models.discovery_probe"):
                del sys.modules[name]
        if hasattr(app.models, "discovery_probe"):
            delattr(app.models, "discovery_probe")


def test_revision_template_and_offline_sql(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Generate a no-op revision only in a temporary directory, never in the repo.
    scripts = tmp_path / "alembic"
    shutil.copytree(PROJECT_ROOT / "alembic", scripts, ignore=shutil.ignore_patterns("__pycache__"))
    output = io.StringIO()
    config = Config(str(PROJECT_ROOT / "alembic.ini"), output_buffer=output)
    config.set_main_option("script_location", str(scripts))
    secret = "example%25password"
    monkeypatch.setenv(
        "DATABASE_URL", f"postgresql+asyncpg://example:{secret}@localhost/example"
    )

    command.revision(config, message="Infrastructure template check", rev_id="test_revision")
    command.upgrade(config, "head", sql=True)

    sql = output.getvalue()
    assert "test_revision" in sql
    assert "COMMIT;" in sql
    assert secret not in sql
    assert '"timestamp"' not in sql
    assert set(Base.metadata.tables) == {"users", "courses", "modules", "lessons"}
    assert "CREATE TABLE users" in sql
    assert "CREATE UNIQUE INDEX ix_users_email" in sql
    assert "CREATE TRIGGER users_updated_at" in sql
    assert "ADD COLUMN activation_token_hash VARCHAR(64)" in sql
    assert "ADD COLUMN activation_expires_at TIMESTAMP WITH TIME ZONE" in sql
    assert "UNIQUE (activation_token_hash)" in sql
    for table in ("courses", "modules", "lessons"):
        assert f"CREATE TABLE {table}" in sql
        assert f"CREATE TRIGGER {table}_updated_at" in sql
    assert "CREATE UNIQUE INDEX ix_courses_slug" in sql
    assert "UNIQUE (course_id, position)" in sql
    assert "UNIQUE (module_id, position)" in sql
    assert "REFERENCES users (id) ON DELETE RESTRICT" in sql
    assert "REFERENCES courses (id) ON DELETE RESTRICT" in sql
    assert "REFERENCES modules (id) ON DELETE CASCADE" in sql


def test_catalog_migration_downgrade_sql() -> None:
    output = io.StringIO()
    config = Config(str(PROJECT_ROOT / "alembic.ini"), output_buffer=output)
    command.downgrade(config, "f93c25d170ba:e82b14c069af", sql=True)
    sql = output.getvalue()
    assert sql.index("DROP TABLE lessons") < sql.index("DROP TABLE modules") < sql.index("DROP TABLE courses")
    assert "DROP FUNCTION set_catalog_updated_at()" in sql
    assert "DROP TABLE users" not in sql


def test_activation_migration_downgrade_sql() -> None:
    output = io.StringIO()
    config = Config(str(PROJECT_ROOT / "alembic.ini"), output_buffer=output)
    command.downgrade(config, "e82b14c069af:c71a92e045bd", sql=True)
    sql = output.getvalue()
    assert "DROP CONSTRAINT uq_users_activation_token_hash" in sql
    assert "DROP COLUMN activation_expires_at" in sql
    assert "DROP COLUMN activation_token_hash" in sql
    assert "DROP TABLE users" not in sql
