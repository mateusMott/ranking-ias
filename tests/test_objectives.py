import json
import unittest
from scripts.objectives import parse_agent,parse_arena_task,collect_objectives

class ObjectivesTests(unittest.TestCase):
    def test_agent_resolves_flight_references_excludes_routers_and_incomplete_evaluations(self):
        row={'displayLabel':'Agent - Model max','indexScore':.62,'indexComponentCount':3}
        router={**row,'displayLabel':'Router','isRouter':True,'indexScore':.9}
        incomplete={**row,'displayLabel':'Incomplete','indexComponentCount':2,'indexScore':.99}
        frames='0:'+json.dumps({'benchmarkRows':['$1:props:rows:0',router,incomplete]})+'\n1:'+json.dumps(['$','component',None,{'rows':[row]}])+'\n'
        html='<script>self.__next_f.push('+json.dumps([1,frames])+')</script>'
        result=parse_agent(html)
        self.assertEqual(result['leaders'][0]['name'],'Agent - Model max')
        self.assertEqual(result['leaders'][0]['score'],62)
        self.assertEqual(len(result['leaders']),1)

    def test_arena_checks_modality_score_and_preliminary_flag(self):
        html='<title>Text-to-Image Leaderboard</title><p>Nov 2, 2026</p><table><thead><tr><th>Rank</th><th>Model</th><th>Score</th></tr></thead><tbody>'
        html+=''.join(f'<tr><td>{i}</td><td><a>Image {i}</a></td><td>{1400-i} ±5 Preliminary</td></tr>' for i in range(3))+'</tbody></table>'
        result=parse_arena_task(html,'text-to-image')
        self.assertEqual(result['source_date'],'2026-11-02')
        self.assertTrue(result['leaders'][0]['preliminary'])
        with self.assertRaises(ValueError):parse_arena_task(html,'fullstack')

    def test_failed_collection_preserves_original_verification_and_models(self):
        previous=[{'id':'image','checked_at':'2026-10-01T00:00:00Z','leaders':[{'name':'Known','score':1400}]}]
        def fail(url):raise OSError('offline')
        result=collect_objectives(previous,fail)
        image=next(r for r in result if r['id']=='image')
        self.assertEqual(image['checked_at'],previous[0]['checked_at'])
        self.assertEqual(image['leaders'],previous[0]['leaders'])
        self.assertEqual(image['status'],'preserved')
        self.assertEqual(next(r for r in result if r['id']=='video')['status'],'unavailable')
