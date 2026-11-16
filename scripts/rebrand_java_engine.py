#!/usr/bin/env python3
"""Takes the branding of the original project out of the Java engine.

The engine jar is not in the repository, so run this once on every copy of it:

    python3 scripts/rebrand_java_engine.py public/jar/pdmaner-java.jar

It rewrites the jar in place and is safe to run again. What it changes: the logo, the
title text and the author names of the Excel templates inside the jar, and the default module code the
Word and Excel exports use.
"""
import io
import re
import struct
import sys
import zipfile
from pathlib import Path

OLD_TITLE = 'PDManer[元数建模]'
OLD_MODULE = 'PDManer元数建模'
NAME = 'MyPD'
LOGO = Path(__file__).resolve().parent.parent / 'public/icons/icon_256x256.png'
TEMPLATES = 'BOOT-INF/classes/xlsx/'
CLASSES = 'BOOT-INF/classes/cn/com/chiner/java/command/impl/'


def rezip(data, change):
    """Copies a zip, passing every entry through change(name, bytes)."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(out, 'w') as dst:
        for info in src.infolist():
            dst.writestr(info, change(info.filename, src.read(info)), compress_type=info.compress_type)
    return out.getvalue()


def template(name, data):
    if name.startswith('xl/media/') and name.endswith('.png'):
        return LOGO.read_bytes()
    if name == 'xl/sharedStrings.xml':
        return data.decode('utf-8').replace(OLD_TITLE, NAME + ' ').encode('utf-8')
    if name == 'docProps/core.xml':
        return re.sub(r'(<(dc:creator|cp:lastModifiedBy)>)[^<]*', r'\g<1>' + NAME, data.decode('utf-8')).encode('utf-8')
    return data


def java_utf8(text):
    return text.encode('utf-8')  # no NUL or supplementary characters here, so plain UTF-8 is valid


def patch_class(data):
    """Replaces one string constant. A class file addresses constants by index, so a
    constant may change length without anything else moving."""
    old = java_utf8(OLD_MODULE)
    entry = b'\x01' + struct.pack('>H', len(old)) + old
    new = java_utf8(NAME)
    return data.replace(entry, b'\x01' + struct.pack('>H', len(new)) + new)


def engine(name, data):
    if name.startswith(TEMPLATES) and name.endswith('.xlsx'):
        return rezip(data, template)
    if name.startswith(CLASSES) and name.endswith('.class'):
        return patch_class(data)
    return data


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    jar = Path(sys.argv[1])
    before = jar.read_bytes()
    after = rezip(before, engine)
    with zipfile.ZipFile(io.BytesIO(after)) as z:
        left = [n for n in z.namelist()
                if (n.startswith(CLASSES) and java_utf8(OLD_MODULE) in z.read(n))
                or (n.startswith(TEMPLATES) and n.endswith('.xlsx')
                    and OLD_TITLE.encode('utf-8') in zipfile.ZipFile(io.BytesIO(z.read(n))).read('xl/sharedStrings.xml'))]
    if left:
        sys.exit('still branded: ' + ', '.join(left))
    jar.write_bytes(after)
    print('rebranded', jar)


if __name__ == '__main__':
    main()
