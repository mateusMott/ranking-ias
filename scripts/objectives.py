"""Task-specific evidence. Never substitute a general intelligence score."""
import json
import math
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from bs4 import BeautifulSoup

SPECS = [
 ('code','Código','https://artificialanalysis.ai/agents/coding-agents','Artificial Analysis · Coding Agent Index v2.0','Engenharia de software: implementar, corrigir e entender código. A avaliação considera o agente junto do modelo.'),
 ('image','Imagem','https://arena.ai/leaderboard/image/text-to-image','Arena · Text-to-Image','Gerar imagens a partir de descrições. A escolha segue a preferência humana no ranking desta modalidade.'),
 ('video','Vídeo','https://arena.ai/leaderboard/video/text-to-video','Arena · Text-to-Video','Gerar vídeos a partir de texto. O resultado não equivale a um ranking de edição de vídeo ou de áudio.'),
 ('apps','Criar apps','https://arena.ai/leaderboard/code/webdev/fullstack','Arena · WebDev Fullstack','Criar aplicações web completas, com múltiplas etapas e uso de ferramentas. Não mede apps nativos de Android ou iOS.'),
 ('sites','Criar sites','https://arena.ai/leaderboard/code/webdev/frontend','Arena · WebDev Frontend','Criar páginas, interfaces e código HTML ou React. A nota vem de tarefas de desenvolvimento frontend.'),
 ('text','Texto','https://arena.ai/leaderboard/chat/text/creative-writing','Arena · Escrita criativa','Escrever e revisar conteúdo criativo. Para textos factuais ou especializados, confirme as informações na fonte.')
]


def parse_agent(html):
    soup = BeautifulSoup(html,'html.parser')
    stream = ''
    for script in soup.find_all('script'):
        raw = script.string or ''
        if raw.startswith('self.__next_f.push('):
            try:
                value = json.loads(raw[len('self.__next_f.push('):-1])
                if len(value)>1 and isinstance(value[1],str):stream += value[1]
            except (ValueError,TypeError):pass
    frames = {}
    for line in stream.splitlines():
        try:
            key, raw = line.split(':',1);frames[key] = json.loads(raw)
        except ValueError:pass
    def resolve(value):
        if not isinstance(value,str) or not value.startswith('$'):return value
        parts=value[1:].split(':');obj=frames[parts[0]]
        for part in parts[1:]:
            obj=resolve(obj)
            obj=obj[3] if isinstance(obj,list) and part=='props' and len(obj)==4 and obj[0]=='$' else obj[int(part)] if isinstance(obj,list) else obj[part]
        return obj
    def find(value):
        if isinstance(value,dict):
            if isinstance(value.get('benchmarkRows'),list):return value['benchmarkRows']
            children=value.values()
        elif isinstance(value,list):children=value
        else:return None
        for child in children:
            result=find(child)
            if result is not None:return result
        return None
    rows=None
    for value in frames.values():
        rows=find(value)
        if rows is not None:break
    if not rows:raise ValueError('Coding Agent Index: dados públicos não encontrados')
    candidates=[]
    for raw in rows:
        row=resolve(raw)
        if not isinstance(row,dict) or row.get('isRouter') or row.get('isUnavailable') or row.get('indexComponentCount')!=3:continue
        score=row.get('indexScore')
        if not isinstance(score,(int,float)) or isinstance(score,bool) or not math.isfinite(score) or not 0<=score<=1:continue
        candidates.append({'name':row['displayLabel'],'score':round(score*100,2),'preliminary':False})
    if not candidates:raise ValueError('Nenhum agente com avaliação completa')
    candidates.sort(key=lambda x:(-x['score'],x['name']))
    return {'leaders':candidates[:3],'metric':'pontos / 100','source_date':None,'selection':'Maior índice entre agentes com modelo único e três avaliações completas; roteadores excluídos.'}


def parse_arena_task(html,expected):
    soup=BeautifulSoup(html,'html.parser')
    title=soup.title.get_text(' ',strip=True).lower() if soup.title else ''
    if expected.lower() not in title:raise ValueError('Modalidade Arena diferente da solicitada')
    rows=[]
    for table in soup.find_all('table'):
        cols=[x.get_text(' ',strip=True).lower() for x in table.select('thead tr:last-child th')]
        if not all(k in cols for k in ['model','score','rank']):continue
        for tr in table.select('tbody tr'):
            cells=tr.find_all('td',recursive=False)
            if len(cells)!=len(cols):continue
            link=cells[cols.index('model')].find('a')
            score_text=cells[cols.index('score')].get_text(' ',strip=True)
            match=re.match(r'^\s*(\d+(?:\.\d+)?)',score_text)
            if link and match:
                score=float(match[1])
                if not 100<score<5000:raise ValueError('Score Arena fora da escala')
                rows.append({'name':link.get_text(' ',strip=True),'score':score,'preliminary':'preliminary' in score_text.lower()})
        break
    if len(rows)<3:raise ValueError('Poucos resultados Arena válidos')
    rows.sort(key=lambda x:(-x['score'],x['name']))
    text=soup.get_text(' ',strip=True)
    match=re.search(r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+20\d{2}\b',text)
    date=datetime.strptime(match[0],'%b %d, %Y').date().isoformat() if match else None
    return {'leaders':rows[:3],'metric':'score Arena','source_date':date,'selection':'Maior score da modalidade; diferenças pequenas e intervalos sobrepostos não garantem superioridade.'}


def collect_objectives(previous,fetch,source_dir=None):
    old={r['id']:r for r in previous if isinstance(r,dict) and 'id' in r}
    expected={'image':'text-to-image','video':'text-to-video','apps':'fullstack','sites':'frontend','text':'creative writing'}
    def collect(spec):
        key,title,url,source,description=spec
        try:
            html=(source_dir/f'objective-{key}.html').read_text() if source_dir else fetch(url)
            result=parse_agent(html) if key=='code' else parse_arena_task(html,expected[key])
            result.update(id=key,title=title,url=url,source=source,description=description,checked_at=datetime.now(timezone.utc).isoformat(timespec='seconds'),status='live')
            return result
        except Exception as error:
            print(f'Aviso objetivo {key}: {error}')
            result=dict(old.get(key,{}))
            result.update(id=key,title=title,url=url,source=source,description=description,status='preserved' if result.get('leaders') else 'unavailable')
            return result
    with ThreadPoolExecutor(max_workers=6) as pool:return list(pool.map(collect,SPECS))
