from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "src-tauri" / "icons"


def chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def make_png(size: int, destination: Path) -> None:
    rows = bytearray()
    center = (size - 1) / 2
    outer = size * 0.46
    inner = size * 0.30

    for y in range(size):
        rows.append(0)
        for x in range(size):
            distance = ((x - center) ** 2 + (y - center) ** 2) ** 0.5
            if distance <= inner:
                rows.extend((236, 240, 245, 255))
            elif distance <= outer:
                rows.extend((99, 102, 241, 255))
            else:
                rows.extend((13, 15, 19, 255))

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )
    destination.write_bytes(png)


def make_ico(source: Path, destination: Path) -> None:
    data = source.read_bytes()
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(data), 22)
    destination.write_bytes(header + entry + data)


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    make_png(32, ICONS / "32x32.png")
    make_png(128, ICONS / "128x128.png")
    make_png(256, ICONS / "128x128@2x.png")
    make_png(512, ICONS / "icon.png")

    temporary = ICONS / "icon_256.png"
    make_png(256, temporary)
    make_ico(temporary, ICONS / "icon.ico")
    temporary.unlink()

    print(f"Iconos generados en {ICONS}")


if __name__ == "__main__":
    main()
