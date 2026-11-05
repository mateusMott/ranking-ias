#!/usr/bin/env python3
"""Collect public leaderboards without guessing missing metrics or model variants."""
from __future__ import annotations
import argparse
import json
import math
import os
import re
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'models.json'
AA = 'https://artificialanalysis.ai/leaderboards/models/'
ARENA = 'https://arena.ai/leaderboard/text'


def norm(value):
    value = unicodedata.normalize('NFKD', str(value)).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', value).strip()


def num(value):
    text = str(value if value is not None else '').strip().replace('\u202f', '').replace('\u00a0', '')
    if text.lower() in {'', 'none', 'nan', 'n/a', '—', '-'} or re.search(r'[<>≤≥]', text):
        return None
    match = re.search(r'-?\d+(?:\.\d+)?', text.replace(',', ''))
    result = float(match.group()) if match else None
    return result if result is not None and math.isfinite(result) else None


def context_tokens(value):
    number = num(value)
    if number is None:
        return None
    text = str(value).strip().lower()
    multiplier = 1_000_000 if re.search(r'\d\s*m', text) else 1_000 if re.search(r'\d\s*k', text) else 1
    return round(number * multiplier)


def fetch(url):
    session = requests.Session()
    session.headers['User-Agent'] = 'ModelScope/2.0 (public leaderboard reader; daily)'
    session.mount('https://', HTTPAdapter(max_retries=Retry(
        total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=['GET'], respect_retry_after_header=False,
    )))
    response = session.get(url, timeout=(10, 40))
    response.raise_for_status()
    return response.text


def leaderboard(html, required):
    soup = BeautifulSoup(html, 'html.parser')
    for table in soup.find_all('table'):
        headers = table.select('thead tr') or [r for r in table.find_all('tr') if r.find('th')]
        for header in reversed(headers):
            columns = [norm(c.get_text(' ', strip=True)) for c in header.find_all(['th', 'td'], recursive=False)]
            if all(any(term in c for c in columns) for term in required):
                rows = []
                for row in table.select('tbody tr') or table.find_all('tr'):
                    cells = row.find_all('td', recursive=False)
                    if len(cells) == len(columns):
                        rows.append(dict(zip(columns, cells)))
                if rows:
                    return rows
    raise ValueError('Tabela com colunas reconhecidas não encontrada.')


def cell(row, *terms):
    matches = [v for key, v in row.items() if all(t in key for t in terms)]
    return matches[0].get_text(' ', strip=True) if len(matches) == 1 else None


def parse_aa(html):
    models, seen = [], set()
    for row in leaderboard(html, ['model', 'intelligence', 'cost']):
        name, score = cell(row, 'model'), num(cell(row, 'intelligence'))
        if not name or score is None:
            continue
        model_id = norm(name).replace(' ', '-')
        if model_id in seen:
            raise ValueError(f'Identificador duplicado: {model_id}')
        seen.add(model_id)
        tokens = context_tokens(cell(row, 'context'))
        # "Time per Task (Minutes)" is not tokens/s. Only explicitly named units qualify.
        latency = num(cell(row, 'first', 'token', 's'))
        if latency is None:
            latency = num(cell(row, 'latency', 's'))
        models.append({
            'id': model_id, 'name': name, 'company': cell(row, 'creator') or 'Não informado',
            'type': 'Não informado', 'intelligence': score,
            'price': num(cell(row, 'cost', 'task')), 'speed': num(cell(row, 'tokens', 's')),
            'task_time_minutes': num(cell(row, 'time', 'task', 'minutes')), 'latency': latency,
            'context': tokens / 1000 if tokens is not None else None, 'context_tokens': tokens,
            'elo': None, 'sources': 'Artificial Analysis', 'arena_name': None,
            'description': 'Métricas coletadas do leaderboard público da Artificial Analysis. Campos ausentes não são estimados.',
        })
    validate_models(models)
    return models


def parse_arena(html):
    entries = {}
    for row in leaderboard(html, ['model', 'score']):
        model_cell = row.get('model')
        if model_cell is None:
            continue
        link = model_cell.find('a')
        name = link.get_text(' ', strip=True) if link else None
        score = num(cell(row, 'score'))
        if not name or score is None or not 100 < score < 5000:
            continue
        details = model_cell.get_text(' ', strip=True)
        model_type = 'Não informado'
        if re.search(r'\bOpen\s+(?:Weights?|Source)\b', details, re.I):
            model_type = 'Pesos abertos'
        elif re.search(r'\bProprietary\b', details, re.I):
            model_type = 'Proprietário'
        key = norm(name)
        entry = {'name': name, 'score': score, 'type': model_type}
        entries[key] = None if key in entries else entry
    if not entries:
        raise ValueError('Nenhum score Arena verificável encontrado.')
    return entries


def validate_models(models):
    if len(models) < 5 or len({m['id'] for m in models}) != len(models):
        raise ValueError('Poucos modelos válidos ou identificadores duplicados.')
    for model in models:
        if not 0 <= model['intelligence'] <= 100:
            raise ValueError('Índice de inteligência fora da escala reconhecida.')
        for key in ['price', 'speed', 'task_time_minutes', 'latency', 'context_tokens']:
            value = model.get(key)
            if value is not None and (not isinstance(value, (float, int)) or not math.isfinite(value) or value < 0):
                raise ValueError(f'Métrica inválida: {key}')


def atomic_write(path, content):
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='.modelscope-')
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            handle.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def refresh_embedded_snapshot(data, index_path=None):
    html = (index_path or ROOT / 'index.html').read_text(encoding='utf-8')
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False).replace('<', '\\u003c')
    html, count = re.subn(r'(<script id="snapshot" type="application/json">).*?(</script>)',
                          lambda m: m[1] + payload + m[2], html, flags=re.S)
    if count != 1:
        raise ValueError('Snapshot incorporado não encontrado no HTML.')
    return html


def update(source_dir=None):
    old = json.loads(DATA.read_text(encoding='utf-8')) if DATA.exists() else {}
    read = (lambda key, url: (source_dir / f'{key}.html').read_text(encoding='utf-8')) if source_dir else (lambda key, url: fetch(url))
    # Primary-source failures never overwrite the last good snapshot.
    models = parse_aa(read('aa', AA))
    if len(models) < len(old.get('models', [])) * .65:
        raise ValueError('Queda inesperada de mais de 35% na quantidade de modelos; verificar a fonte.')
    warnings = []
    try:
        arena = parse_arena(read('arena', ARENA))
    except (requests.RequestException, ValueError, OSError) as error:
        arena = {}
        warnings.append('Arena indisponível nesta coleta. Scores Arena não foram reaproveitados nem estimados.')
        print(f'Aviso Arena: {error}')
    matched = 0
    for model in models:
        match = arena.get(norm(model['name']))  # Exact variant only; no fuzzy matching.
        if match:
            model.update(elo=match['score'], type=match['type'], arena_name=match['name'], sources='Artificial Analysis · Arena')
            matched += 1
    models.sort(key=lambda m: (-m['intelligence'], m['name']))
    now = datetime.now(timezone.utc).isoformat(timespec='seconds')
    result = {
        'schema_version': 2, 'version': now[:10], 'updated_at': now,
        'benchmark_version': 'Artificial Analysis Intelligence Index', 'update_interval_hours': 24,
        'sources': [
            {'name': 'Artificial Analysis', 'url': AA, 'ok': True, 'checked_at': now, 'models': len(models)},
            {'name': 'Arena', 'url': ARENA, 'ok': bool(arena), 'checked_at': now, 'matched_models': matched,
             'note': 'Associação apenas por nome e variante exatos.' if arena else warnings[0]},
        ],
        'models': models, 'warnings': warnings,
        'notes': 'Custo por tarefa em USD; tempo por tarefa em minutos; primeiro token de resposta em segundos; contexto em tokens. Pesos abertos só são declarados quando confirmados na Arena para a mesma variante.',
    }
    html = refresh_embedded_snapshot(result)  # Validate both outputs before writing.
    atomic_write(DATA, json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    atomic_write(ROOT / 'index.html', html)
    print(f'Atualizados {len(models)} modelos; {matched} correspondências exatas na Arena.')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, help='HTMLs públicos já baixados para diagnóstico reproduzível')
    args = parser.parse_args()
    try:
        update(args.source_dir)
    except (requests.RequestException, ValueError, OSError, KeyError) as error:
        raise SystemExit(f'Atualização cancelada; último snapshot preservado. {error}') from error
