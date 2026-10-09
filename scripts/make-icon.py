#!/usr/bin/env python3
"""Export the approved Breath e paths as an AppKit template PDF."""
from pathlib import Path

content = b"""q
1 0 0 -1 0 24 cm
0 0 0 RG 2.8 w 1 J 1 j
5 12 m 18 12 l
18 8 15.3 5 11.5 5 c
7.7 5 5 8 5 12 c
5 16 7.7 19 11.5 19 c
14.5 19 15.7 17.2 17.7 17.2 c
18.8 17.2 19.7 17.8 20.5 18.6 c
S Q
"""
objects = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 24 24] /Resources << >> /Contents 4 0 R >>",
    b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"endstream",
]
data = bytearray(b"%PDF-1.4\n")
offsets = [0]
for index, obj in enumerate(objects, 1):
    offsets.append(len(data))
    data.extend(str(index).encode() + b" 0 obj\n" + obj + b"\nendobj\n")
xref = len(data)
data.extend(b"xref\n0 5\n0000000000 65535 f \n")
for offset in offsets[1:]:
    data.extend(f"{offset:010d} 00000 n \n".encode())
data.extend(f"trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
(Path(__file__).resolve().parent.parent / "assets/icons/einsager-breath.pdf").write_bytes(data)
