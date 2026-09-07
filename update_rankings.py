#!/usr/bin/env python3
"""ModelScope automatic public-data updater.

Fetches public leaderboard pages, normalizes metrics, merges sources and writes
`data/models.json`. Designed for GitHub Actions. If a source changes structure,
the script keeps the last good snapshot instead of publishing an empty dataset.
"""
from __future__ import annotations
import json, re, unicodedata, hashlib
from datetime import datetime, timezone
from pathlib import Path
from difflib import SequenceMatcher
import requests
from bs4 import BeautifulSoup
import pandas as pd

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data/models.json'
AA='https://artificialanalysis.ai/leaderboards/models/'
ARENA='https://arena.ai/leaderboard/text'
SWEN='https://swen.ai/'
HEADERS={'User-Agent':'ModelScopeBenchmarkBot/1.0 (+public benchmark aggregation; weekly fetch)'}

def norm(s):
    s=unicodedata.normalize('NFKD',str(s)).encode('ascii','ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+',' ',s).strip()

def slug(s): return re.sub(r'[^a-z0-9]+','-',norm(s)).strip('-')[:80]

def num(v):
    if v is None:return None
    m=re.search(r'-?\d+(?:[.,]\d+)?',str(v).replace(',',''))
    return float(m.group()) if m else None

def context_k(v):
    if v is None:return None
    s=str(v).lower().replace(',','').strip(); n=num(s)
    if n is None:return None
    if 'm' in s:return round(n*1024)
    if 'k' in s:return round(n)
    return round(n)

def fetch(url):
    r=requests.get(url,headers=HEADERS,timeout=35);r.raise_for_status();return r.text

def parse_aa():
    html=fetch(AA)
    tables=pd.read_html(html)
    target=None
    for t in tables:
        cols=' | '.join(map(str,t.columns))
        if 'Intelligence' in cols and 'Cost' in cols and 'Model' in cols:
            target=t;break
    if target is None: raise RuntimeError('Artificial Analysis table not found')
    # Flatten multi-index columns.
    target.columns=[' '.join([str(x) for x in c if str(x)!='nan']).strip() if isinstance(c,tuple) else str(c) for c in target.columns]
    out=[]
    for _,r in target.iterrows():
        def col(*terms):
            for c in target.columns:
                lc=c.lower()
                if all(t.lower() in lc for t in terms): return r[c]
            return None
        name=col('model')
        if not name or str(name)=='nan': continue
        creator=col('creator') or '—'
        intelligence=num(col('intelligence'))
        if intelligence is None: continue
        out.append({
          'id':slug(name),'name':str(name).strip(),'company':re.sub(r'^Image:\s*\S+','',str(creator)).strip() or str(creator).strip(),
          'type':'Proprietário','intelligence':intelligence,'price':num(col('cost','task')),
          'speed':num(col('tokens','s')) or num(col('speed')),'latency':num(col('latency')),
          'context':context_k(col('context')),'elo':None,'sources':'AA v4.2',
          'description':'Métricas atualizadas automaticamente a partir do leaderboard público da Artificial Analysis.','swen':None
        })
    if len(out)<5: raise RuntimeError(f'AA parser returned only {len(out)} rows')
    return out

def parse_arena():
    html=fetch(ARENA)
    tables=pd.read_html(html)
    target=max(tables,key=lambda t: len(t))
    target.columns=[' '.join([str(x) for x in c if str(x)!='nan']).strip() if isinstance(c,tuple) else str(c) for c in target.columns]
    rows=[]
    for _,r in target.iterrows():
        name=score=None
        for c in target.columns:
            lc=c.lower()
            if 'model' in lc and name is None:name=r[c]
            if 'score' in lc and score is None:score=r[c]
        if name is None or score is None:continue
        n=num(score)
        if n:rows.append((str(name).strip(),n))
    return rows

def best_match(name, arena):
    a=norm(name);best=(0,None,None)
    for nm,score in arena:
        b=norm(nm); ratio=SequenceMatcher(None,a,b).ratio()
        # bonus for shared family/version tokens
        ta=set(a.split());tb=set(b.split());ratio+=0.15*(len(ta&tb)/max(len(ta|tb),1))
        if ratio>best[0]:best=(ratio,nm,score)
    return best if best[0]>=0.68 else (0,None,None)

def main():
    old=json.loads(DATA.read_text(encoding='utf-8')) if DATA.exists() else {'models':[]}
    errors=[]
    try: aa=parse_aa()
    except Exception as e: aa=[];errors.append('Artificial Analysis: '+str(e))
    try: arena=parse_arena()
    except Exception as e: arena=[];errors.append('Arena: '+str(e))
    if not aa:
        raise SystemExit('Refusing to overwrite last good snapshot; '+ '; '.join(errors))
    for m in aa:
        score=best_match(m['name'],arena)
        if score[1]:
            m['elo']=round(score[2]);m['sources']='AA v4.2 · Arena'
        # Heuristic openness based on known open-weight labs/families. This is display metadata only.
        if any(x in norm(m['name']+' '+m['company']) for x in ['qwen','kimi','glm','deepseek','granite','llama','mimo','ling']):m['type']='Código aberto'
    aa.sort(key=lambda m:(m.get('intelligence') or -1,m.get('elo') or -1),reverse=True)
    models=aa[:35]
    now=datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')
    result={
      'version':datetime.now().strftime('%Y-%m-%d'),'updated_at':now,
      'benchmark_version':'Artificial Analysis Intelligence Index v4.2',
      'sources':[{'name':'Artificial Analysis','url':AA,'ok':True},{'name':'Arena','url':ARENA,'ok':bool(arena)},{'name':'SWEN.AI','url':SWEN,'ok':False,'note':'mantida como fonte editorial; parser automático não publica sem estrutura verificável'}],
      'models':models,'warnings':errors,
      'notes':'Gerado automaticamente. Artificial Analysis é a fonte técnica primária; Arena adiciona preferência humana quando há correspondência confiável.'
    }
    DATA.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'Updated {len(models)} models; Arena matched {sum(1 for m in models if m.get("elo"))}; warnings={len(errors)}')
if __name__=='__main__':main()
