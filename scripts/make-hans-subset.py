#!/usr/bin/env python3
"""Cuts the Simplified Chinese face the web build embeds out of Noto Sans CJK SC.

Needs fontTools (pip install fonttools) and a craft-fonts checkout (CRAFT_FONTS=...). The result,
fonts/omnitext-hans/OmnitextHans-Regular.otf, is committed: the build does not run this. It keeps
the 3755 + 3008 hanzi of GB 2312 and its 682 symbols (about 1.5 MB instead of 16 MB), no layout
features and no hinting, and carries its own family name because the OFL asks a modified version
to rename itself.
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont


def gb2312(rows):
    out = []
    for hi in rows:
        for lo in range(0xA1, 0xFF):
            try:
                out.append(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    return out


def main():
    source = os.path.join(os.environ["CRAFT_FONTS"], "fonts/noto-sans-cjk-sc/NotoSansCJKsc-Regular.otf")
    out = os.path.join(os.path.dirname(__file__), "..", "fonts/omnitext-hans/OmnitextHans-Regular.otf")
    text = "".join(gb2312(range(0xA1, 0xAA)) + gb2312(range(0xB0, 0xF8)))
    options = subset.Options()
    options.layout_features = []
    options.hinting = False
    options.name_IDs = ["*"]
    font = TTFont(source)
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    for record in font["name"].names:
        if record.nameID in (1, 16):
            record.string = "Omnitext Hans"
        elif record.nameID in (4,):
            record.string = "Omnitext Hans Regular"
        elif record.nameID == 6:
            record.string = "OmnitextHans-Regular"
        elif record.nameID in (3,):
            record.string = "OmnitextHans-Regular;subset of Noto Sans CJK SC"
    font.save(out)
    print(out, os.path.getsize(out))


if __name__ == "__main__":
    sys.exit(main())
