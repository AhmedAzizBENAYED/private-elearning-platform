"""Course thumbnail validation, independent of any provider (BE-THUMBNAIL-UPLOAD-01).

As for lesson files, the client's media type is a claim, not a fact: it must be
one of the accepted types, and the bytes must then *be* that format. The check
goes further than a magic number, because a thumbnail is shown to every member:

* PNG - every chunk is walked with its CRC, ``IHDR`` must come first with a
  legal bit depth and colour type, ``IEND`` must end the file, and the image
  data must be a complete zlib stream of the size the header announces.
* JPEG - the marker segments are walked up to the start of scan: a frame header
  with non-zero dimensions must precede it, and an end-of-image marker must
  follow it.

No image library is installed and none is added: this proves the file is a
well-formed image of a supported format, not that every pixel decodes. JPEG's
entropy-coded data in particular is not decoded.
"""

import zlib

from app.core.exceptions import BusinessError

#: Only the formats the application already ships (its own assets are PNG and
#: JPEG); every browser shows both.
PNG = "image/png"
JPEG = "image/jpeg"
THUMBNAIL_MIME_TYPES = frozenset({PNG, JPEG})
#: Enough for any course cover; small enough to validate in memory before storing.
THUMBNAIL_MAX_BYTES = 5 * 1024**2
#: A bound on what a member's browser is asked to decode.
MAX_SIDE = 16_384
MAX_PIXELS = 40_000_000

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
#: Legal bit depths for each PNG colour type (PNG specification, table 11.1).
PNG_BIT_DEPTHS: dict[int, frozenset[int]] = {
    0: frozenset({1, 2, 4, 8, 16}), 2: frozenset({8, 16}), 3: frozenset({1, 2, 4, 8}),
    4: frozenset({8, 16}), 6: frozenset({8, 16}),
}
PNG_CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
#: Start-of-frame markers; C4 (DHT), C8 (JPG) and CC (DAC) share the range.
JPEG_FRAMES = frozenset(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}


class _Invalid(Exception):
    """Internal: the bytes are not a well-formed image of the declared type."""


def validate_thumbnail_type(mime_type: str | None) -> str:
    """Normalise the declared type, refusing anything but PNG and JPEG."""
    declared = (mime_type or "").split(";", 1)[0].strip().lower()
    if declared not in THUMBNAIL_MIME_TYPES:
        raise BusinessError(415, "Thumbnail must be a PNG or JPEG image")
    return declared


def validate_thumbnail(mime_type: str, data: bytes) -> tuple[int, int]:
    """Return ``(width, height)`` if ``data`` really is a ``mime_type`` image."""
    try:
        width, height = _png(data) if mime_type == PNG else _jpeg(data)
    except _Invalid:
        raise BusinessError(422, f"File content is not a valid {mime_type} image") from None
    if width > MAX_SIDE or height > MAX_SIDE or width * height > MAX_PIXELS:
        raise BusinessError(422, "Thumbnail dimensions are too large")
    return width, height


def _be(data: bytes) -> int:
    return int.from_bytes(data, "big")


def _png(data: bytes) -> tuple[int, int]:
    if not data.startswith(PNG_SIGNATURE):
        raise _Invalid
    offset, header, idat = len(PNG_SIGNATURE), None, []
    while True:
        if offset + 12 > len(data):
            raise _Invalid
        length, kind = _be(data[offset:offset + 4]), data[offset + 4:offset + 8]
        end = offset + 12 + length
        if end > len(data):
            raise _Invalid
        body = data[offset + 8:end - 4]
        if zlib.crc32(kind + body) != _be(data[end - 4:end]):
            raise _Invalid
        if header is None:
            if kind != b"IHDR" or length != 13:
                raise _Invalid
            header = body
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            # Nothing may trail the image: bytes after IEND are how polyglots hide.
            if end != len(data) or not idat:
                raise _Invalid
            break
        offset = end

    width, height = _be(header[0:4]), _be(header[4:8])
    depth, colour, compression, filtering, interlace = header[8:13]
    if (not width or not height or depth not in PNG_BIT_DEPTHS.get(colour, ())
            or compression or filtering or interlace not in (0, 1)):
        raise _Invalid
    if width > MAX_SIDE or height > MAX_SIDE or width * height > MAX_PIXELS:
        return width, height  # refused by the caller, without inflating anything
    # One filter byte per row, then the packed samples.
    expected = height * (1 + (width * PNG_CHANNELS[colour] * depth + 7) // 8)
    _inflate(b"".join(idat), expected if interlace == 0 else None)
    return width, height


def _inflate(stream: bytes, expected: int | None) -> None:
    """Check the zlib stream is complete, counting its output without keeping it."""
    inflater, produced, pending = zlib.decompressobj(), 0, stream
    try:
        while pending:
            produced += len(inflater.decompress(pending, 1024**2))
            pending = inflater.unconsumed_tail
            if expected is not None and produced > expected:
                raise _Invalid
        produced += len(inflater.flush())
    except zlib.error:
        raise _Invalid from None
    if not inflater.eof or inflater.unused_data or not produced:
        raise _Invalid
    if expected is not None and produced != expected:
        raise _Invalid


def _jpeg(data: bytes) -> tuple[int, int]:
    if not data.startswith(b"\xff\xd8\xff"):
        raise _Invalid
    offset, size = 2, None
    while offset < len(data):
        if data[offset] != 0xFF:
            raise _Invalid
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1  # fill bytes may pad any marker
        if offset + 3 > len(data):
            raise _Invalid
        marker = data[offset]
        offset += 1
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            continue  # standalone markers carry no length
        if marker in (0x00, 0xD8, 0xD9):
            raise _Invalid  # stuffing, a second SOI, or EOI before any scan
        length = _be(data[offset:offset + 2])
        if length < 2 or offset + length > len(data):
            raise _Invalid
        segment = data[offset + 2:offset + length]
        if marker in JPEG_FRAMES:
            if len(segment) < 6:
                raise _Invalid
            height, width, components = _be(segment[1:3]), _be(segment[3:5]), segment[5]
            if not height or not width or components not in (1, 3, 4) or len(segment) != 6 + 3 * components:
                raise _Invalid
            size = (width, height)
        elif marker == 0xDA:
            if size is None or data.rfind(b"\xff\xd9") < offset + length:
                raise _Invalid
            return size
        offset += length
    raise _Invalid
