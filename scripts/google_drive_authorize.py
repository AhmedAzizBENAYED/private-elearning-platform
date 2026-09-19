"""One-time Google Drive setup, run by a developer, never by the server.

Google issues a refresh token only through an interactive consent, so that step
is explicit and manual rather than hidden inside the application. Run this once;
the backend refreshes access tokens on its own from then on.

    python scripts/google_drive_authorize.py --client-id ... --client-secret ...

The script also creates the platform's root folder through the Drive API, or
reuses the one a previous run created. That is a requirement, not a convenience:
the ``drive.file`` scope grants access only to files the application itself
created, so a folder created by hand in the browser would be invisible to the
backend and would reject every upload into it.

Nothing is written to disk. The refresh token and folder ID are printed once, to
your terminal; copy them into .env or your secret manager.
"""

import argparse
import asyncio
import base64
import hashlib
import secrets
import sys
import threading
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx

# Runnable as a plain script from anywhere; Drive knowledge stays in the adapter.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.storage.exceptions import StorageError  # noqa: E402
from app.storage.google_drive import (  # noqa: E402
    ROOT_FOLDER_NAME, TOKEN_URL, ensure_root_folder,
)

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
# drive.file limits the application to files it created itself: it can never
# read the rest of the account's Drive.
SCOPE = "https://www.googleapis.com/auth/drive.file"
DEFAULT_TIMEOUT_SECONDS = 300


class AuthorizationError(RuntimeError):
    """Consent was denied, mismatched, or never arrived."""


class CallbackServer(ThreadingHTTPServer):
    """Serves until the genuine OAuth callback arrives, ignoring stray requests."""

    allow_reuse_address = True

    def __init__(self, port: int, expected_state: str) -> None:
        super().__init__(("127.0.0.1", port), CallbackHandler)
        self.expected_state = expected_state
        self.code: str | None = None
        self.failure: str | None = None
        self.finished = threading.Event()


class CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        code = (query.get("code") or [None])[0]
        error = (query.get("error") or [None])[0]
        state = (query.get("state") or [None])[0]

        if code is None and error is None:
            # A browser also asks for /favicon.ico and similar; keep waiting.
            self.respond(404, "Waiting for the Google authorization callback.")
            return
        if not secrets.compare_digest(state or "", self.server.expected_state):
            # A callback for a different flow, or a forged one.
            self.server.failure = "OAuth state did not match; authorization rejected."
            self.respond(400, "State mismatch. Authorization rejected.")
        elif error:
            self.server.failure = f"Google reported '{error}'."
            self.respond(400, f"Authorization failed ({error}). You can close this tab.")
        else:
            self.server.code = code
            self.respond(200, "Authorization received. You can close this tab.")
        self.server.finished.set()

    def respond(self, status: int, message: str) -> None:
        body = message.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args) -> None:
        """Keep the OAuth code out of the terminal log."""


def wait_for_callback(server: CallbackServer, timeout: float) -> str:
    """Block on an event, never a spin loop, until the callback or a timeout."""
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        if not server.finished.wait(timeout):
            raise AuthorizationError(f"No authorization callback within {timeout:.0f}s.")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    if server.failure or server.code is None:
        raise AuthorizationError(server.failure or "No authorization code was returned.")
    return server.code


def authorization_url(client_id: str, redirect_uri: str, challenge: str, state: str) -> str:
    return AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code",
        "scope": SCOPE, "access_type": "offline", "prompt": "consent",
        "code_challenge": challenge, "code_challenge_method": "S256", "state": state,
    })


async def exchange_and_prepare(
    client_id: str, client_secret: str, code: str, verifier: str,
    redirect_uri: str, folder_name: str,
) -> tuple[str, str, bool]:
    """Trade the code for tokens, then resolve the platform's root folder."""
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(TOKEN_URL, data={
            "client_id": client_id, "client_secret": client_secret, "code": code,
            "code_verifier": verifier, "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        })
        if response.status_code != 200:
            # The error body can echo the client secret; report only the status.
            raise AuthorizationError(f"Token exchange failed (HTTP {response.status_code}).")
        payload = response.json()
        refresh_token = payload.get("refresh_token")
        if not refresh_token:
            raise AuthorizationError(
                "Google returned no refresh token. Revoke the app's access at "
                "https://myaccount.google.com/permissions and run this again."
            )
        folder_id, created = await ensure_root_folder(
            client, payload["access_token"], folder_name
        )
    return refresh_token, folder_id, created


def run_setup(client_id: str, client_secret: str, port: int, folder_name: str,
              timeout: float) -> tuple[str, str, bool]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).decode().rstrip("=")
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).decode().rstrip("=")
    state = secrets.token_urlsafe(32)
    redirect_uri = f"http://127.0.0.1:{port}/"

    server = CallbackServer(port, state)
    url = authorization_url(client_id, redirect_uri, challenge, state)
    print("Open this URL and grant access:\n", url, "\n", file=sys.stderr)
    webbrowser.open(url)

    code = wait_for_callback(server, timeout)
    return asyncio.run(exchange_and_prepare(
        client_id, client_secret, code, verifier, redirect_uri, folder_name,
    ))


def main() -> None:
    parser = argparse.ArgumentParser(description="One-time Google Drive setup.")
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--client-secret", required=True)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--folder-name", default=ROOT_FOLDER_NAME,
                        help="Name of the Drive folder the platform creates and owns.")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS,
                        help="Seconds to wait for the browser callback.")
    arguments = parser.parse_args()
    try:
        refresh_token, folder_id, created = run_setup(
            arguments.client_id, arguments.client_secret, arguments.port,
            arguments.folder_name, arguments.timeout,
        )
    except (AuthorizationError, StorageError, httpx.HTTPError) as error:
        raise SystemExit(f"Setup failed: {error}")

    print(f"\n# Drive folder {'created' if created else 'reused'}: {arguments.folder_name}")
    print("GOOGLE_DRIVE_REFRESH_TOKEN=" + refresh_token)
    print("GOOGLE_DRIVE_ROOT_FOLDER_ID=" + folder_id)
    print("\nAdd these to .env with your client ID/secret, and set "
          "STORAGE_PROVIDER=google_drive.\nNever commit them.", file=sys.stderr)


if __name__ == "__main__":
    main()
