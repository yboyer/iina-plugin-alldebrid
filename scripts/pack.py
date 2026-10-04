from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
files = ['Info.json', 'main.js', 'global.js', 'library.js', 'library.html', 'library.css', 'library-ui.js']
output = root / 'dist' / 'alldebrid.iinaplgz'
output.parent.mkdir(exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, name)
print(output)
