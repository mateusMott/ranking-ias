"""Package only public assets, validating the JSON and embedded fallback agree."""
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / 'index.html').read_text(encoding='utf-8')
match = re.search(r'<script id="snapshot" type="application/json">(.*?)</script>', html, re.S)
data = json.loads((ROOT / 'models.json').read_text(encoding='utf-8'))
if not match or json.loads(match[1]) != data:
    raise SystemExit('Snapshot incorporado difere de models.json; publicação cancelada.')
if not data.get('models'):
    raise SystemExit('Conjunto de dados vazio; publicação cancelada.')
output = ROOT / '_site'
if output.exists():
    shutil.rmtree(output)
output.mkdir()
shutil.copy2(ROOT / 'index.html', output / 'index.html')
shutil.copy2(ROOT / 'models.json', output / 'models.json')
shutil.copytree(ROOT / 'assets', output / 'assets')
(output / '.nojekyll').touch()
print(f'Pacote público pronto: {len(data["models"])} modelos.')
