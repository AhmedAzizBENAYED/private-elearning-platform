"""One-time Drive setup: the OAuth callback helper and root-folder creation.

Google is never contacted. The callback helper is driven through a real loopback
socket, and the Drive API is a mock transport.
"""

import importlib.util
import threading
import urllib.error
import urllib.request
from pathlib import Path

import httpx
import pytest

from app.storage.exceptions import StorageUnavailable
from app.storage.google_drive import FOLDER_MIME, ROOT_FOLDER_NAME, ensure_root_folder

pytestmark = pytest.mark.anyio
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def load_script():
    """Import the setup script by path; ``scripts/`` is not an installed package."""
    spec = importlib.util.spec_from_file_location(
        "google_drive_authorize", PROJECT_ROOT / "scripts" / "google_drive_authorize.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


setup = load_script()


def free_port() -> int:
    import socket

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def request(port: int, path: str) -> int:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def run_callback(query: str, *, before: list[str] = ()) -> tuple[str | None, str | None]:
    """Drive ``wait_for_callback`` through a real socket, returning (code, failure)."""
    port = free_port()
    server = setup.CallbackServer(port, "expected-state")
    outcome: dict = {}

    def wait() -> None:
        try:
            outcome["code"] = setup.wait_for_callback(server, timeout=10)
        except setup.AuthorizationError as error:
            outcome["failure"] = str(error)

    waiter = threading.Thread(target=wait, daemon=True)
    waiter.start()
    for path in before:
        request(port, path)
    request(port, query)
    waiter.join(timeout=15)
    assert not waiter.is_alive(), "wait_for_callback did not terminate"
    return outcome.get("code"), outcome.get("failure")


# ------------------------------------------------------- OAuth callback

def test_stray_browser_requests_do_not_end_the_flow() -> None:
    """A favicon request used to consume the single served request and hang."""
    code, failure = run_callback(
        "/?code=REAL&state=expected-state",
        before=["/favicon.ico", "/", "/apple-touch-icon.png"],
    )
    assert code == "REAL" and failure is None


def test_successful_callback_is_accepted() -> None:
    code, failure = run_callback("/?code=GOOD&state=expected-state")
    assert code == "GOOD" and failure is None


def test_denied_consent_fails_promptly_instead_of_hanging() -> None:
    code, failure = run_callback("/?error=access_denied&state=expected-state")
    assert code is None
    assert failure is not None and "access_denied" in failure


def test_mismatched_state_is_rejected() -> None:
    code, failure = run_callback("/?code=FORGED&state=someone-elses-state")
    assert code is None
    assert failure is not None and "state" in failure.lower()


def test_missing_state_is_rejected() -> None:
    code, failure = run_callback("/?code=FORGED")
    assert code is None and failure is not None


def test_waiting_times_out_without_spinning() -> None:
    """The helper blocks on an event, so a timeout costs no CPU."""
    import time

    port = free_port()
    server = setup.CallbackServer(port, "expected-state")
    started = time.monotonic()
    with pytest.raises(setup.AuthorizationError) as error:
        setup.wait_for_callback(server, timeout=0.4)
    assert "callback" in str(error.value)
    assert time.monotonic() - started < 5


def test_callback_server_is_closed_after_use() -> None:
    port = free_port()
    server = setup.CallbackServer(port, "expected-state")
    with pytest.raises(setup.AuthorizationError):
        setup.wait_for_callback(server, timeout=0.3)
    # The socket is released, so a retry on the same port can bind again.
    reopened = setup.CallbackServer(port, "second-state")
    reopened.server_close()
    # Nothing is still listening once the helper has returned.
    with pytest.raises(urllib.error.URLError):
        urllib.request.urlopen(f"http://127.0.0.1:{port}/?code=LATE", timeout=2)


def test_authorization_url_keeps_the_narrow_scope_and_pkce() -> None:
    import urllib.parse

    url = setup.authorization_url("client", "http://127.0.0.1:8765/", "challenge", "state")
    params = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    assert params["scope"] == ["https://www.googleapis.com/auth/drive.file"]
    assert "auth/drive " not in url and params["scope"] != ["https://www.googleapis.com/auth/drive"]
    assert params["code_challenge_method"] == ["S256"]
    assert params["access_type"] == ["offline"] and params["prompt"] == ["consent"]


# --------------------------------------------------------- root folder

class DriveFolders:
    """Drive under drive.file: listings only ever return app-created files."""

    def __init__(self, *, existing: list[str] = (), status: int | None = None) -> None:
        self.folders = {f"folder-{index}": name for index, name in enumerate(existing)}
        self.status = status
        self.created: list[dict] = []
        self.requests: list[str] = []

    def transport(self) -> httpx.MockTransport:
        def route(request: httpx.Request) -> httpx.Response:
            self.requests.append(f"{request.method} {request.url.path}")
            assert request.headers["Authorization"] == "Bearer access-token"
            if self.status:
                return httpx.Response(self.status, json={"error": "denied"})
            if request.method == "GET":
                query = request.url.params["q"]
                name = query.split("name = '", 1)[1].split("'", 1)[0]
                hit = [i for i, existing in self.folders.items() if existing == name]
                return httpx.Response(200, json={"files": [{"id": hit[0]}] if hit else []})
            import json

            body = json.loads(request.content)
            self.created.append(body)
            new_id = f"folder-{len(self.folders)}"
            self.folders[new_id] = body["name"]
            return httpx.Response(200, json={"id": new_id})

        return httpx.MockTransport(route)


async def test_root_folder_is_created_when_absent() -> None:
    drive = DriveFolders()
    async with httpx.AsyncClient(transport=drive.transport()) as client:
        folder_id, created = await ensure_root_folder(client, "access-token")
    assert created is True and folder_id == "folder-0"
    assert drive.created[0]["name"] == ROOT_FOLDER_NAME
    assert drive.created[0]["mimeType"] == FOLDER_MIME
    # Created at the account root, not inside a folder the user made by hand.
    assert "parents" not in drive.created[0]


async def test_existing_root_folder_is_reused() -> None:
    drive = DriveFolders(existing=[ROOT_FOLDER_NAME])
    async with httpx.AsyncClient(transport=drive.transport()) as client:
        folder_id, created = await ensure_root_folder(client, "access-token")
    assert created is False and folder_id == "folder-0"
    assert drive.created == []  # Re-running setup must not make a second folder.


async def test_root_folder_name_is_configurable() -> None:
    drive = DriveFolders()
    async with httpx.AsyncClient(transport=drive.transport()) as client:
        await ensure_root_folder(client, "access-token", "Association Training")
    assert drive.created[0]["name"] == "Association Training"


async def test_root_folder_failures_stay_provider_neutral() -> None:
    drive = DriveFolders(status=403)
    async with httpx.AsyncClient(transport=drive.transport()) as client:
        with pytest.raises(StorageUnavailable) as error:
            await ensure_root_folder(client, "access-token")
    assert "access-token" not in str(error.value)


async def test_unreachable_provider_is_reported_as_unavailable() -> None:
    def refuse(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("unreachable")

    async with httpx.AsyncClient(transport=httpx.MockTransport(refuse)) as client:
        with pytest.raises(StorageUnavailable):
            await ensure_root_folder(client, "access-token")


# ------------------------------------------------------ end-to-end setup

def stub_google(monkeypatch, drive: DriveFolders, *, refresh_token: str | None = "refresh-value"):
    """Replace only Google: the loopback server and wiring stay real."""
    def route(request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            body = {"access_token": "access-token", "expires_in": 3600}
            if refresh_token:
                body["refresh_token"] = refresh_token
            return httpx.Response(200, json=body)
        return drive.transport().handler(request)

    original = setup.httpx.AsyncClient

    def factory(*_args, **kwargs):
        kwargs.pop("timeout", None)
        return original(transport=httpx.MockTransport(route), **kwargs)

    monkeypatch.setattr(setup.httpx, "AsyncClient", factory)


def answer_callback(monkeypatch, *, stray: bool = True, state_override: str | None = None):
    """Play the browser: optionally request a favicon, then deliver the code."""
    import urllib.parse

    def open_url(url: str) -> None:
        params = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        port = int(urllib.parse.urlparse(params["redirect_uri"][0]).port)
        state = state_override or params["state"][0]

        def deliver() -> None:
            if stray:
                request(port, "/favicon.ico")
            request(port, f"/?code=AUTHCODE&state={urllib.parse.quote(state)}")

        threading.Thread(target=deliver, daemon=True).start()

    monkeypatch.setattr(setup.webbrowser, "open", open_url)


def test_setup_creates_the_root_folder_and_reports_both_values(monkeypatch) -> None:
    drive = DriveFolders()
    stub_google(monkeypatch, drive)
    answer_callback(monkeypatch)

    refresh_token, folder_id, created = setup.run_setup(
        "client-id", "client-secret", free_port(), ROOT_FOLDER_NAME, timeout=15)

    assert refresh_token == "refresh-value"
    assert folder_id == "folder-0" and created is True
    assert drive.created[0]["name"] == ROOT_FOLDER_NAME
    # The operator never creates the folder by hand.
    assert "parents" not in drive.created[0]


def test_rerunning_setup_reuses_the_existing_folder(monkeypatch) -> None:
    drive = DriveFolders(existing=[ROOT_FOLDER_NAME])
    stub_google(monkeypatch, drive)
    answer_callback(monkeypatch)

    _, folder_id, created = setup.run_setup(
        "client-id", "client-secret", free_port(), ROOT_FOLDER_NAME, timeout=15)
    assert folder_id == "folder-0" and created is False
    assert drive.created == []


def test_setup_stops_when_google_returns_no_refresh_token(monkeypatch) -> None:
    drive = DriveFolders()
    stub_google(monkeypatch, drive, refresh_token=None)
    answer_callback(monkeypatch)

    with pytest.raises(setup.AuthorizationError) as error:
        setup.run_setup("client-id", "client-secret", free_port(), ROOT_FOLDER_NAME, timeout=15)
    assert "refresh token" in str(error.value)
    assert drive.created == []  # No folder is made for an unusable authorization.


def test_setup_rejects_a_callback_with_the_wrong_state(monkeypatch) -> None:
    drive = DriveFolders()
    stub_google(monkeypatch, drive)
    answer_callback(monkeypatch, state_override="attacker-state")

    with pytest.raises(setup.AuthorizationError) as error:
        setup.run_setup("client-id", "client-secret", free_port(), ROOT_FOLDER_NAME, timeout=15)
    assert "state" in str(error.value).lower()
    assert drive.created == []
