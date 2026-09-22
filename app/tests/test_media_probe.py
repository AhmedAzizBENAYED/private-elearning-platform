"""The MP4 duration probe, against well-formed, malformed and hostile input.

Every fixture here is built byte by byte from the ISO Base Media layout, so the
expected durations are arithmetic rather than assertions about a binary blob.
The overriding requirement is that nothing in this file can make the parser
raise: an upload must never fail because its container confused the probe.
"""

import pytest

from app.services.media_probe import (
    PROBE_WINDOW_BYTES, probe_mp4_duration, read_box_header,
)

# The suite's existing stub upload: a valid signature and nothing else.
FAKE_MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 512
PDF = b"%PDF-1.7\n" + b"0" * 512


def box(box_type: bytes, body: bytes) -> bytes:
    return (len(body) + 8).to_bytes(4, "big") + box_type + body


#: A well-formed `ftyp`: major brand, minor version, compatible brands - and a
#: declared size that matches its real length, unlike the stub above.
FTYP = box(b"ftyp", b"mp42" + b"\x00" * 4 + b"mp42isom")


def mvhd_v0(duration: int, timescale: int = 1000) -> bytes:
    body = (
        b"\x00" + b"\x00\x00\x00"          # version 0, flags
        + b"\x00" * 4                       # creation_time
        + b"\x00" * 4                       # modification_time
        + timescale.to_bytes(4, "big")
        + duration.to_bytes(4, "big")
        + b"\x00" * 80                      # rate, volume, matrix, next_track_id
    )
    return box(b"mvhd", body)


def mvhd_v1(duration: int, timescale: int = 90_000) -> bytes:
    body = (
        b"\x01" + b"\x00\x00\x00"          # version 1, flags
        + b"\x00" * 8                       # creation_time
        + b"\x00" * 8                       # modification_time
        + timescale.to_bytes(4, "big")
        + duration.to_bytes(8, "big")
        + b"\x00" * 80
    )
    return box(b"mvhd", body)


def faststart(mvhd: bytes, *, media: bytes = b"") -> bytes:
    """A realistic faststart layout: ftyp, then moov, then the media data."""
    return FTYP + box(b"moov", mvhd + box(b"trak", b"\x00" * 32)) + box(b"mdat", media)


# ------------------------------------------------------------- happy paths

def test_reads_a_faststart_mp4_with_a_known_duration():
    # 27.0 s at a 1000-tick timescale, the real test video's length.
    assert probe_mp4_duration(faststart(mvhd_v0(27_000))) == 27


def test_reads_mvhd_version_0():
    assert probe_mp4_duration(faststart(mvhd_v0(120_000))) == 120


def test_reads_mvhd_version_1():
    # 64-bit duration at a 90 kHz timescale.
    assert probe_mp4_duration(faststart(mvhd_v1(90_000 * 42))) == 42


def test_skips_boxes_that_precede_moov():
    # `free`/`uuid` padding before `moov` is common and must not derail the walk.
    data = FTYP + box(b"free", b"\x00" * 64) + box(b"uuid", b"\x00" * 40)
    data += box(b"moov", mvhd_v0(9_000))
    assert probe_mp4_duration(data) == 9


def test_finds_mvhd_after_other_children_of_moov():
    inner = box(b"udta", b"\x00" * 16) + mvhd_v0(5_000)
    assert probe_mp4_duration(FTYP + box(b"moov", inner)) == 5


# ------------------------------------------------------------- arithmetic

@pytest.mark.parametrize("duration,timescale,expected", [
    (27_000, 1000, 27),
    (27_900, 1000, 27),       # truncated, never rounded up
    (27_999, 1000, 27),
    (28_000, 1000, 28),
    (500, 1000, 1),           # half a second still has to be a legal duration
    (1, 1_000_000, 1),        # a sliver rounds to the schema's minimum, not zero
])
def test_duration_rounding(duration, timescale, expected):
    assert probe_mp4_duration(faststart(mvhd_v0(duration, timescale))) == expected


def test_a_duration_longer_than_the_schema_allows_is_refused():
    # Rather than write a value the lesson column would reject.
    assert probe_mp4_duration(faststart(mvhd_v0(4_000_000_000, 1))) is None


# ------------------------------------------------- unreadable, never fatal

def test_the_existing_fake_mp4_fixture_reads_as_unknown():
    # A valid signature with no `moov` at all: the upload must keep working and
    # fall back to the authored duration.
    assert probe_mp4_duration(FAKE_MP4) is None


def test_missing_moov():
    assert probe_mp4_duration(FTYP + box(b"mdat", b"\x00" * 128)) is None


def test_moov_without_mvhd():
    assert probe_mp4_duration(FTYP + box(b"moov", box(b"trak", b"\x00" * 32))) is None


def test_truncated_moov_box():
    full = faststart(mvhd_v0(27_000))
    assert probe_mp4_duration(full[: len(FTYP) + 12]) is None


def test_truncated_mvhd_body():
    mvhd = mvhd_v0(27_000)
    assert probe_mp4_duration(FTYP + box(b"moov", mvhd[:20])) is None


def test_empty_bytes():
    assert probe_mp4_duration(b"") is None


@pytest.mark.parametrize("payload", [
    b"garbage",
    b"\xff" * 64,
    bytes(range(256)),
    PDF,
    b"MZ\x90\x00 not a video at all",
])
def test_non_video_input(payload):
    assert probe_mp4_duration(payload) is None


def test_zero_timescale():
    assert probe_mp4_duration(faststart(mvhd_v0(27_000, timescale=0))) is None


def test_zero_duration():
    assert probe_mp4_duration(faststart(mvhd_v0(0))) is None


@pytest.mark.parametrize("sentinel,builder", [
    (0xFFFFFFFF, mvhd_v0),
    (0xFFFFFFFFFFFFFFFF, mvhd_v1),
])
def test_the_unknown_duration_sentinel_is_not_taken_literally(sentinel, builder):
    assert probe_mp4_duration(FTYP + box(b"moov", builder(sentinel))) is None


def test_unsupported_mvhd_version():
    body = b"\x07" + b"\x00" * 120
    assert probe_mp4_duration(FTYP + box(b"moov", box(b"mvhd", body))) is None


# --------------------------------------------------------------- hostile

@pytest.mark.parametrize("size", [0, 1, 7])
def test_a_box_size_that_cannot_advance_the_walk_stops_it(size):
    # A zero or tiny size would otherwise let the parser stand still forever.
    data = size.to_bytes(4, "big") + b"moov" + b"\x00" * 64
    assert probe_mp4_duration(data) is None


def test_an_enormous_declared_size_allocates_nothing():
    # 2^63 bytes declared in a 100-byte buffer: the walk must simply end.
    data = FTYP + (1).to_bytes(4, "big") + b"mdat" + (1 << 63).to_bytes(8, "big")
    assert probe_mp4_duration(data + b"\x00" * 32) is None


def test_a_largesize_box_smaller_than_its_own_header_is_refused():
    data = FTYP + (1).to_bytes(4, "big") + b"moov" + (4).to_bytes(8, "big")
    assert probe_mp4_duration(data + b"\x00" * 64) is None


def test_a_long_run_of_tiny_boxes_terminates():
    # Bounded box count: this must return rather than walk 100 000 headers.
    data = FTYP + box(b"free", b"") * 100_000
    assert probe_mp4_duration(data) is None


def test_deeply_nested_moov_does_not_recurse():
    # `mvhd` is only ever a direct child; nesting must not be followed down.
    nested = box(b"moov", box(b"moov", mvhd_v0(27_000)))
    assert probe_mp4_duration(FTYP + nested) is None


def test_a_probe_window_of_padding_is_handled():
    assert probe_mp4_duration(b"\x00" * PROBE_WINDOW_BYTES) is None


# --------------------------------------------------------- box header read

def test_read_box_header_parses_a_plain_header():
    assert read_box_header(box(b"moov", b"\x00" * 8)[:16]) == (b"moov", 16)


def test_read_box_header_parses_a_largesize_header():
    header = (1).to_bytes(4, "big") + b"mdat" + (1 << 32).to_bytes(8, "big")
    assert read_box_header(header) == (b"mdat", 1 << 32)


@pytest.mark.parametrize("header", [
    b"",
    b"\x00\x00",
    b"\x00\x00\x00\x00mdat",                                    # size 0: no length
    b"\x00\x00\x00\x04mdat",                                    # smaller than a header
    (1).to_bytes(4, "big") + b"mdat",                           # largesize truncated
    (1).to_bytes(4, "big") + b"mdat" + (4).to_bytes(8, "big"),  # impossible largesize
])
def test_read_box_header_refuses_what_it_cannot_step_over(header):
    assert read_box_header(header) is None
