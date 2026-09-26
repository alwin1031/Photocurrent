"""Bundle the dependency-free app into a single offline HTML file."""
import json
from pathlib import Path
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--sample', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent
html = (root / 'index.template.html').read_text()
for marker, filename in [('STYLE', 'style.css'), ('CORE', 'core.js'), ('APP', 'app.js')]:
    html = html.replace('/* ' + marker + ' */', (root / filename).read_text())
sample = {'name': args.sample.name, 'csv': args.sample.read_text()}
html = html.replace('/* SAMPLE */', json.dumps(sample, ensure_ascii=True).replace('<', '\\u003c'))
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(html)
print(f'Built {args.output.name}: {len(html.encode()):,} bytes')
