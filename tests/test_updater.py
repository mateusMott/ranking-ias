import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import update_rankings as updater


def aa_table(count=5):
    rows = ''.join(f'<tr><td>Model {i} (high)</td><td>1M</td><td>Lab</td><td>{60-i}</td><td>{"$0.00" if i == 0 else "$1.25"}</td><td>3.2</td><td>0.85</td></tr>' for i in range(count))
    return '<table><thead><tr><th colspan="7">Overview</th></tr><tr><th>Model</th><th>Context Window</th><th>Creator</th><th>Artificial Analysis Intelligence Index</th><th>Cost per Task USD</th><th>Time per Task Minutes</th><th>First Answer Token (s)</th></tr></thead><tbody>' + rows + '</tbody></table>'


ARENA = '''<script>self.__next_f.push([])</script><table><thead><tr><th>Rank</th><th>Model</th><th>Score</th></tr></thead><tbody><tr><td>1</td><td><a>Model 0 (High)</a><span>Lab · Open Weights</span></td><td>1512 ±9 Preliminary</td></tr><tr><td>2</td><td><a>Model 1 (low)</a><span>Lab · Proprietary</span></td><td>1450 ±5</td></tr></tbody></table>'''


class CollectorTests(unittest.TestCase):
    def test_explicit_units_and_zero_price(self):
        models = updater.parse_aa(aa_table())
        self.assertEqual(models[0]['price'], 0)
        self.assertEqual(models[0]['task_time_minutes'], 3.2)
        self.assertEqual(models[0]['latency'], .85)
        self.assertIsNone(models[0]['speed'])
        self.assertEqual(models[0]['context_tokens'], 1_000_000)
        self.assertEqual(models[0]['type'], 'Não informado')

    def test_decimal_context_units(self):
        self.assertEqual(updater.context_tokens('1.5M'), 1_500_000)
        self.assertEqual(updater.context_tokens('128k'), 128_000)
        self.assertEqual(updater.context_tokens('128,000'), 128_000)
        self.assertIsNone(updater.context_tokens('N/A'))
        self.assertIsNone(updater.num('<0.01'))

    def test_nextjs_does_not_hide_a_valid_arena_table(self):
        data = updater.parse_arena(ARENA)
        self.assertEqual(data['model 0 high']['score'], 1512)
        self.assertEqual(data['model 0 high']['type'], 'Pesos abertos')
        self.assertNotIn('model 1 high', data)

    def test_bad_primary_data_rejected(self):
        for html in ['<html>Access denied</html>', aa_table(1), aa_table().replace('<td>60</td>', '<td>600</td>')]:
            with self.assertRaises(ValueError):
                updater.parse_aa(html)

    def test_duplicate_models_rejected(self):
        with self.assertRaises(ValueError):
            updater.parse_aa(aa_table().replace('Model 1 (high)', 'Model 0 (high)'))

    def test_success_exact_matching_and_fallback_consistency(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'index.html').write_text('<script id="snapshot" type="application/json">{}</script>')
            (root / 'aa.html').write_text(aa_table())
            (root / 'arena.html').write_text(ARENA)
            with patch.object(updater, 'ROOT', root), patch.object(updater, 'DATA', root / 'models.json'):
                result = updater.update(root)
            self.assertEqual(result['models'][0]['elo'], 1512)
            self.assertIsNone(result['models'][1]['elo'])
            self.assertEqual(result['sources'][1]['matched_models'], 1)
            embedded = (root / 'index.html').read_text().split('>', 1)[1].rsplit('<', 1)[0]
            self.assertEqual(json.loads(embedded), result)

    def test_primary_failure_preserves_both_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            previous = json.dumps({'models': updater.parse_aa(aa_table())})
            (root / 'models.json').write_text(previous)
            (root / 'index.html').write_text('previous HTML')
            (root / 'aa.html').write_text('<html>Unavailable</html>')
            with patch.object(updater, 'ROOT', root), patch.object(updater, 'DATA', root / 'models.json'):
                with self.assertRaises(ValueError):
                    updater.update(root)
            self.assertEqual((root / 'models.json').read_text(), previous)
            self.assertEqual((root / 'index.html').read_text(), 'previous HTML')

    def test_optional_failure_keeps_primary_metrics(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'index.html').write_text('<script id="snapshot" type="application/json">{}</script>')
            (root / 'aa.html').write_text(aa_table())
            (root / 'arena.html').write_text('<html>Unavailable</html>')
            with patch.object(updater, 'ROOT', root), patch.object(updater, 'DATA', root / 'models.json'):
                result = updater.update(root)
            self.assertFalse(result['sources'][1]['ok'])
            self.assertEqual(len(result['models']), 5)
            self.assertTrue(result['warnings'])
            self.assertTrue(all(m['elo'] is None for m in result['models']))

    def test_sharp_count_drop_preserves_previous_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            previous = json.dumps({'models': list(range(20))})
            (root / 'models.json').write_text(previous)
            (root / 'aa.html').write_text(aa_table())
            with patch.object(updater, 'ROOT', root), patch.object(updater, 'DATA', root / 'models.json'):
                with self.assertRaises(ValueError):
                    updater.update(root)
            self.assertEqual((root / 'models.json').read_text(), previous)

    def test_script_termination_cannot_escape_embedded_json(self):
        with tempfile.TemporaryDirectory() as directory:
            index = Path(directory) / 'index.html'
            index.write_text('<script id="snapshot" type="application/json">{}</script>')
            result = updater.refresh_embedded_snapshot({'name': '</script><script>alert(1)</script>'}, index)
            self.assertEqual(result.count('</script>'), 1)
            self.assertIn('\\u003c', result)


if __name__ == '__main__':
    unittest.main()
