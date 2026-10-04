from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
plugin = root / 'dist' / 'plugin'
if not (plugin / 'Info.json').is_file():
    raise SystemExit('Run npm run build before packaging.')
output = root / 'dist' / 'alldebrid.iinaplgz'
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(plugin.rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(plugin))
print(output)
