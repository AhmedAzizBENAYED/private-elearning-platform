"""Read a video's real duration out of its own container.

Playback duration is used by :mod:`app.services.progress_service` to decide when
a lesson is complete, so a wrong value makes a lesson impossible to finish. It
must therefore come from the file rather than from whoever typed it into the
lesson form.

The parser is a deliberately small ISO Base Media (MP4/M4V/MOV) reader: it walks
top-level boxes looking for ``moov``, then its ``mvhd`` child, and converts that
box's ``duration`` by its ``timescale``. Nothing else in the container is read,
no dependency is added, and no external process is ever started.

Every input is untrusted, so the parser is written to be boring:

* it reads only the bounded prefix it is handed, never the whole upload;
* it never allocates anything sized by the file's own declared lengths;
* it bounds how many boxes it will walk, so a pathological file cannot spin;
* every offset is bounds-checked before it is dereferenced;
* it returns ``None`` for anything it does not fully understand, and it never
  raises - a file the parser cannot read is a fallback, not an upload failure.
"""

import logging
from typing import Final

logger = logging.getLogger(__name__)

#: How many leading bytes of an upload are retained for probing.
#:
#: A faststart MP4 places ``moov`` immediately after ``ftyp``, well inside this
#: window even for long videos. The cap is what keeps the probe's memory cost
#: constant: the upload itself keeps streaming to the provider untouched, and a
#: hostile file can never make the server hold more than this.
PROBE_WINDOW_BYTES: Final = 1 << 20  # 1 MiB

_HEADER_BYTES: Final = 8
_LARGE_HEADER_BYTES: Final = 16
#: Enough for any real file's box list; a hostile one is cut off instead of
#: being walked indefinitely.
_MAX_BOXES: Final = 256
#: The lesson schema's own ceiling (``Duration`` is ``le=2147483647``); a longer
#: reading is nonsense and is discarded rather than written.
_MAX_SECONDS: Final = 2_147_483_647


def _boxes(data: bytes, start: int, end: int):
    """Yield ``(type, content_start, content_end)`` for the boxes in a span.

    An ISO box is ``[size:4][type:4]``, optionally followed by a 64-bit size
    when ``size == 1``; ``size == 0`` means "to the end of the file". A box that
    is truncated by the probe window is still yielded, clipped to what is
    actually present, so a ``moov`` that straddles the window boundary can still
    give up its ``mvhd``.
    """
    offset = start
    for _ in range(_MAX_BOXES):
        if offset + _HEADER_BYTES > end:
            return

        size = int.from_bytes(data[offset : offset + 4], "big")
        box_type = bytes(data[offset + 4 : offset + 8])
        content = offset + _HEADER_BYTES

        if size == 1:
            if content + 8 > end:
                return
            size = int.from_bytes(data[content : content + 8], "big")
            content += 8
            # A largesize box that cannot even hold its own header is malformed.
            if size < _LARGE_HEADER_BYTES:
                return
        elif size == 0:
            size = end - offset
        elif size < _HEADER_BYTES:
            # Refusing to advance is the point: a zero or tiny size would
            # otherwise let the walk stand still or run backwards.
            return

        box_end = offset + size
        if box_end <= offset:
            return

        yield box_type, content, min(box_end, end)
        offset = box_end


def _mvhd_seconds(data: bytes, start: int, end: int) -> int | None:
    """Convert an ``mvhd`` box body into whole seconds.

    Version 0 stores 32-bit creation/modification times and a 32-bit duration;
    version 1 widens both to 64 bits. The field order is identical otherwise,
    which is why only the offsets differ below.
    """
    if start + 4 > end:
        return None

    version = data[start]
    if version == 0:
        timescale_at, duration_at, duration_bytes = start + 12, start + 16, 4
    elif version == 1:
        timescale_at, duration_at, duration_bytes = start + 20, start + 24, 8
    else:
        return None

    if duration_at + duration_bytes > end:
        return None

    timescale = int.from_bytes(data[timescale_at : timescale_at + 4], "big")
    duration = int.from_bytes(data[duration_at : duration_at + duration_bytes], "big")

    # A zero timescale would divide by zero; a zero duration says nothing.
    if timescale <= 0 or duration <= 0:
        return None
    # All-ones is the container's own "duration unknown" sentinel.
    if duration >= (1 << (duration_bytes * 8)) - 1:
        return None

    seconds = duration // timescale
    if seconds > _MAX_SECONDS:
        return None
    # Truncating rather than rounding up is the safe direction: the recorded
    # duration can then never exceed the real media, so a lesson can never
    # become harder to complete than the video actually is. The floor of 1
    # keeps a sub-second clip inside the schema's `duration_seconds > 0`.
    return max(1, seconds)


def _find_duration(head: bytes) -> int | None:
    for box_type, start, end in _boxes(head, 0, len(head)):
        if box_type != b"moov":
            continue
        for inner_type, inner_start, inner_end in _boxes(head, start, end):
            if inner_type == b"mvhd":
                return _mvhd_seconds(head, inner_start, inner_end)
        # `moov` was found but holds no readable `mvhd`; there is no second one.
        return None
    return None


def read_box_header(header: bytes) -> tuple[bytes, int] | None:
    """Parse one box header into ``(type, total_size)``, or ``None``.

    Exposed so a caller that can seek - the resource service, which owns the
    storage port - can walk a file's top-level boxes with 16-byte reads instead
    of downloading it. The parsing stays here; the reading stays there, and this
    module keeps no knowledge of any provider.
    """
    if len(header) < _HEADER_BYTES:
        return None

    size = int.from_bytes(header[:4], "big")
    box_type = bytes(header[4:_HEADER_BYTES])

    if size == 1:
        if len(header) < _LARGE_HEADER_BYTES:
            return None
        size = int.from_bytes(header[_HEADER_BYTES:_LARGE_HEADER_BYTES], "big")
        if size < _LARGE_HEADER_BYTES:
            return None
    elif size < _HEADER_BYTES:
        # Includes `size == 0` ("to end of file"), which carries no length and
        # so cannot be stepped over; the walk stops rather than guessing.
        return None

    return box_type, size


def probe_mp4_duration(head: bytes) -> int | None:
    """Return the video's duration in whole seconds, or ``None``.

    ``None`` is an ordinary answer, not an error: it means this prefix does not
    carry a readable ``moov``/``mvhd``. The commonest cause is a non-faststart
    MP4, whose ``moov`` sits after the media data and therefore beyond the probe
    window. Callers fall back to the authored duration.
    """
    if not head:
        return None

    try:
        return _find_duration(head)
    except Exception:  # pragma: no cover - defence in depth
        # An upload must never fail because its container confused the parser.
        logger.debug("Video duration probe did not complete", exc_info=True)
        return None
