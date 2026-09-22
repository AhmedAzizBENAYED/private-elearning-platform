"""A request-body ceiling enforced before routing, authentication and parsing.

FastAPI resolves an endpoint's body *before* its dependencies: ``routing.py``
reads ``await request.form()`` and only then calls ``solve_dependencies``. The
``Depends(admin_access)`` guard on the two upload routes therefore runs after
Starlette has already received the whole multipart body and spooled it to a
temporary file. The application's own limits - ``STORAGE_MAX_UPLOAD_BYTES`` for
a lesson file, 5 MiB for a thumbnail - are real, but they are checked by the
service, which is far too late to protect the process.

This middleware is the missing gate. It runs outside the router, so it sees the
bytes first:

* a ``Content-Length`` above the ceiling is refused without reading anything;
* a body without a length, or one that lies about it, is counted as it arrives
  and cut off the moment it passes the ceiling.

Two ceilings, because a request that presents no credential at all has no
legitimate reason to be large: the biggest uncredentialed body this API accepts
is a sign-in form. A request that does present one is allowed the application's
configured maximum upload, and the service's own limit still applies. Presenting
a *forged* credential therefore buys the larger ceiling - that is deliberate: a
bearer token cannot be verified without a database round trip, and this gate
exists precisely to run before that. The point is that consumption is bounded
and refused early, not that it is authenticated here.

It is not a substitute for a limit at the ingress; see the production section of
the README.
"""

from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]

#: Room for the multipart framing that surrounds an upload at the configured
#: maximum: boundaries, part headers and the trailing terminator.
MULTIPART_OVERHEAD_BYTES = 1024 * 1024

#: The ceiling for a request that carries no credential. A login, a refresh, a
#: token revocation and every JSON body this API accepts fit inside it many
#: times over; an upload does not, and an upload without a credential is
#: refused by the router anyway.
UNCREDENTIALED_BODY_BYTES = 1024 * 1024

#: The one route whose credential travels in the query string (a media element
#: cannot send a header); it only ever answers GET, so its body is empty.
PLAYBACK_PARAMETER = b"playback_token="

_TOO_LARGE = b'{"detail":"Request body exceeds the maximum size"}'


def _declared_length(headers: list[tuple[bytes, bytes]]) -> int | None:
    """The request's own ``Content-Length``, when it states a usable one."""
    for name, value in headers:
        if name.lower() == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


def _has_credential(scope: Scope) -> bool:
    """Whether the request presents a credential - not whether it is valid."""
    for name, _ in scope.get("headers", []):
        if name.lower() == b"authorization":
            return True
    return PLAYBACK_PARAMETER in scope.get("query_string", b"")


class RequestBodyLimitMiddleware:
    """Refuse an over-large request body before the application reads it."""

    def __init__(self, app: Callable[..., Awaitable[None]], max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    def limit_for(self, scope: Scope) -> int:
        credentialed = self.max_body_bytes
        return credentialed if _has_credential(scope) else min(UNCREDENTIALED_BODY_BYTES, credentialed)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        limit = self.limit_for(scope)
        declared = _declared_length(scope.get("headers", []))
        if declared is not None and declared > limit:
            # Nothing is read: the answer is decided from the headers alone.
            await self._refuse(send)
            return

        state = {"received": 0, "exceeded": False, "started": False}

        async def guarded_receive() -> Message:
            message = await receive()
            if message.get("type") != "http.request":
                return message
            state["received"] += len(message.get("body", b""))
            if state["received"] > limit:
                state["exceeded"] = True
                # The body stops here. A disconnect is what a parser expects
                # when the client goes away, so it unwinds instead of waiting
                # for bytes that will never be passed on.
                return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: Message) -> None:
            if state["exceeded"] and not state["started"]:
                # The application reacted to the truncated body; its answer is
                # replaced by the reason the body was truncated.
                if message.get("type") == "http.response.start":
                    state["started"] = True
                    await self._refuse(send)
                return
            if state["exceeded"]:
                return
            if message.get("type") == "http.response.start":
                state["started"] = True
            await send(message)

        try:
            await self.app(scope, guarded_receive, guarded_send)
        except Exception:
            # A parser that raises on the truncated body - Starlette's
            # `ClientDisconnect` - must still produce the 413 rather than a 500.
            if not (state["exceeded"] and not state["started"]):
                raise
            state["started"] = True
            await self._refuse(send)

    @staticmethod
    async def _refuse(send: Send) -> None:
        await send({
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(_TOO_LARGE)).encode()),
                (b"cache-control", b"no-store"),
                (b"connection", b"close"),
            ],
        })
        await send({"type": "http.response.body", "body": _TOO_LARGE})
