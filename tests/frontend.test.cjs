const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');
const root = path.resolve(__dirname,'..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const script = fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const base = () => ({schema_version:2, version:'2026-11-05', updated_at:new Date().toISOString(), sources:[{name:'Artificial Analysis',ok:true},{name:'Arena',ok:true,matched_models:2}],models:[
  {id:'alpha-high',name:'Alpha (high)',company:'Lab A',type:'Proprietário',intelligence:60,price:3,task_time_minutes:12,latency:6,context_tokens:1000000,elo:1500,speed:null,sources:'Artificial Analysis · Arena',description:'Alpha description'},
  {id:'beta',name:'Beta',company:'Lab B',type:'Pesos abertos',intelligence:50,price:0,task_time_minutes:2,latency:.5,context_tokens:128000,elo:null,speed:null,sources:'Artificial Analysis',description:'Beta description'},
  {id:'gamma',name:'Gamma',company:'Lab C',type:'Não informado',intelligence:45,price:null,task_time_minutes:null,latency:null,context_tokens:2000000,elo:null,speed:null,sources:'Artificial Analysis',description:'Gamma description'},
  {id:'delta',name:'Delta',company:'Lab A',type:'Proprietário',intelligence:40,price:1,task_time_minutes:5,latency:1,context_tokens:64000,elo:1400,speed:null,sources:'Artificial Analysis · Arena',description:'Delta description'}]});

async function boot(options = {}) {
  const data = options.data || base();
  const markup = html.replace(/(<script id="snapshot" type="application\/json">).*?(<\/script>)/s, (_,a,b) => a + JSON.stringify(data).replace(/</g,'\\u003c') + b);
  const errors = [];
  const console = new VirtualConsole(); console.on('jsdomError',error => errors.push(error.message));
  const dom = new JSDOM(markup,{url:options.file ? 'file:///tmp/modelscope/index.html' : 'https://example.test/ranking-ias/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
  const w = dom.window;
  w.matchMedia = query => ({matches:query.includes('pointer: fine') ? Boolean(options.fine) : query.includes('reduced-motion') ? Boolean(options.reduced) : false,addEventListener(){},removeEventListener(){}});
  w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLDialogElement.prototype.showModal = function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close = function(){this.removeAttribute('open');};
  const requests = [];
  w.fetch = async url => { requests.push(url);if(options.failFetch) throw new Error('offline');return {ok:true,json:async () => options.fetched || data}; };
  w.URL.createObjectURL = () => 'blob:test';w.URL.revokeObjectURL = () => {};
  if (options.theme) w.localStorage.setItem('modelscope:theme',options.theme);
  w.eval(script);
  await tick();await tick();
  return {dom,w,d:w.document,errors,requests,close:() => dom.window.close()};
}
const names = app => [...app.d.querySelectorAll('#rows .model-name')].map(node => node.textContent);
const click = (app, selector) => app.d.querySelector(selector).click();

test('published JSON uses the correct root path; cards and count use current data',async () => {
  const app = await boot();try {
    assert.match(app.requests[0],/^models\.json\?t=/);assert.equal(app.requests.length,1);
    assert.equal(app.d.querySelector('#leaderName').textContent,'Alpha (high)');
    assert.equal(app.d.querySelector('#totalCount').textContent,'4');
    assert.match(app.d.querySelector('#cheapestValue').textContent,/0,00/);
    assert.equal(app.d.querySelector('#fastestValue').textContent,'2');
    assert.match(app.d.querySelector('#autoStatusText').textContent,/diária ativa/);
    assert.deepEqual(app.errors,[]);
  } finally {app.close();}
});

test('company, search, price and type filters work together and reset',async () => {
  const app = await boot();try {
    const search = app.d.querySelector('#search');search.value = 'lab a';search.dispatchEvent(new app.w.Event('input'));
    assert.deepEqual(names(app),['Alpha (high)','Delta']);
    const price = app.d.querySelector('#price');price.value = '2';price.dispatchEvent(new app.w.Event('change'));
    assert.deepEqual(names(app),['Delta']);click(app,'#resetFilters');
    click(app,'[data-type="Pesos abertos"]');assert.deepEqual(names(app),['Beta']);
    click(app,'#resetFilters');assert.equal(names(app).length,4);
    search.value = 'not found';search.dispatchEvent(new app.w.Event('input'));assert.equal(app.d.querySelector('#emptyState').hidden,false);
    click(app,'#emptyReset');assert.equal(names(app).length,4);
  } finally {app.close();}
});

test('missing metrics remain last in ascending and descending sorts',async () => {
  const app = await boot();try {
    click(app,'[data-sort="price"]');assert.deepEqual(names(app),['Beta','Delta','Alpha (high)','Gamma']);
    click(app,'[data-sort="price"]');assert.deepEqual(names(app),['Alpha (high)','Delta','Beta','Gamma']);
    assert.equal(app.d.querySelector('[data-sort-head="price"]').getAttribute('aria-sort'),'descending');
  } finally {app.close();}
});

test('comparison contains model names and enforces the three-model limit',async () => {
  const app = await boot();try {
    click(app,'[data-compare="alpha-high"]');assert.equal(app.d.querySelector('#openCompare').disabled,true);
    click(app,'[data-compare="beta"]');assert.equal(app.d.querySelector('#openCompare').disabled,false);
    click(app,'#openCompare');assert.equal(app.d.querySelector('#dialog').open,true);
    const comparison = app.d.querySelector('.comparison-table').textContent;
    assert.match(comparison,/Alpha \(high\)/);assert.match(comparison,/Beta/);assert.ok(app.d.querySelectorAll('.best').length > 0);
    click(app,'#closeDialog');click(app,'[data-compare="gamma"]');click(app,'[data-compare="delta"]');
    assert.equal(app.d.querySelector('#selectedCount').textContent,'3');assert.match(app.d.querySelector('#toast').textContent,/até 3/);
    click(app,'#clearCompare');assert.equal(app.d.querySelector('#compareTray').hidden,true);
  } finally {app.close();}
});

test('offline mode preserves the last data and exposes the connection state',async () => {
  const app = await boot({failFetch:true});try {
    assert.equal(names(app).length,4);assert.match(app.d.querySelector('#autoStatusText').textContent,/Sem conexão/);
    assert.equal(app.d.querySelector('#dataNotice').hidden,false);
  } finally {app.close();}
});

test('stale data never receives a fresh status after a successful fetch',async () => {
  const data = base();data.updated_at = '2020-01-01T00:00:00Z';
  const app = await boot({data});try {
    assert.match(app.d.querySelector('#autoStatusText').textContent,/48h/);assert.match(app.d.querySelector('#dataNotice').textContent,/48 horas/);
  } finally {app.close();}
});

test('a new live dataset updates cards and recommendations without hardcoded model IDs',async () => {
  const data = base();data.updated_at = '2026-01-01T00:00:00Z';
  const fetched = base();fetched.models[1].intelligence = 65;
  const app = await boot({data,fetched});try {
    assert.equal(app.d.querySelector('#leaderName').textContent,'Beta');
    click(app,'[data-view="recommendations"]');assert.equal(app.d.querySelector('#rankingView').hidden,true);
    assert.match(app.d.querySelector('#recs .rec-selection').textContent,/Beta/);
    click(app,'#methodNav');assert.equal(app.errors.length,0);
    click(app,'[data-view="ranking"]');assert.equal(app.d.querySelector('#rankingView').hidden,false);
  } finally {app.close();}
});

test('invalid live metrics are rejected and the valid embedded data survives',async () => {
  const fetched = base();fetched.models[0].intelligence = 'not a number';
  const app = await boot({fetched});try {
    assert.equal(app.d.querySelector('#leaderScore').textContent,'60');assert.equal(names(app).length,4);
    assert.match(app.d.querySelector('#autoStatusText').textContent,/Sem conexão/);
  } finally {app.close();}
});

test('external names and descriptions are escaped in rows, filters and dialogs',async () => {
  const data = base();data.models[0].name = '<img src=x onerror=alert(1)>';data.models[0].company = '<script>alert(1)</script>';
  data.models[0].description = '<img src=x>';
  const app = await boot({data});try {
    assert.equal(app.d.querySelector('#rows img'),null);assert.equal(app.d.querySelector('#company script'),null);
    click(app,'[data-detail="alpha-high"]');assert.equal(app.d.querySelector('#dialog img'),null);
    assert.match(app.d.querySelector('#dialogTitle').textContent,/<img/);
  } finally {app.close();}
});

test('local files use their synchronized embedded snapshot without trying to fetch',async () => {
  const app = await boot({file:true});try {
    assert.equal(app.requests.length,0);assert.equal(names(app).length,4);assert.match(app.d.querySelector('#dataNotice').textContent,/incorporada/);
  } finally {app.close();}
});

test('theme persists and search shortcut works',async () => {
  const app = await boot({theme:'dark'});try {
    assert.equal(app.d.documentElement.dataset.theme,'dark');click(app,'#themeBtn');assert.equal(app.w.localStorage.getItem('modelscope:theme'),'light');
    app.d.body.focus();app.d.dispatchEvent(new app.w.KeyboardEvent('keydown',{key:'/',bubbles:true}));assert.equal(app.d.activeElement.id,'search');
  } finally {app.close();}
});

test('cursor preference can be disabled and remains disabled on pointer movement',async () => {
  const app = await boot({fine:true});try {
    click(app,'#cursorBtn');assert.equal(app.w.localStorage.getItem('modelscope:cursor'),'off');
    app.d.dispatchEvent(new app.w.MouseEvent('pointermove',{clientX:50,clientY:50,bubbles:true}));
    assert.equal(app.d.querySelector('#cursorRing').classList.contains('active'),false);
  } finally {app.close();}
});

test('reduced-motion preference prevents the pointer effect',async () => {
  const app = await boot({fine:true,reduced:true});try {
    app.d.dispatchEvent(new app.w.MouseEvent('pointermove',{clientX:50,clientY:50,bubbles:true}));
    assert.equal(app.d.querySelector('#cursorRing').classList.contains('active'),false);
  } finally {app.close();}
});

test('LiveBench stays separate, shows its edition and changes category without changing the main ranking',async () => {
  const data = base();data.sources.push({name:'LiveBench',ok:true});
  data.supplementary = {livebench:{release:'2026-06-25',collected_at:new Date().toISOString(),categories:['Reasoning','Coding'],models:[{name:'LB Alpha',scores:{Reasoning:70,Coding:50}},{name:'LB Beta',scores:{Reasoning:60,Coding:80}},{name:'Incomplete',scores:{Reasoning:null,Coding:null}}]}};
  const app = await boot({data});try {
    assert.equal(app.d.querySelector('#livebenchSection').hidden,false);
    assert.match(app.d.querySelector('#livebenchMeta').textContent,/2026/);
    assert.match(app.d.querySelector('#livebenchRows tr').textContent,/LB Alpha/);
    const selector=app.d.querySelector('#livebenchCategory');selector.value='Coding';selector.dispatchEvent(new app.w.Event('change'));
    assert.match(app.d.querySelector('#livebenchRows tr').textContent,/LB Beta/);
    assert.equal(app.d.querySelectorAll('#livebenchRows tr').length,2);
    assert.equal(app.d.querySelector('#leaderName').textContent,'Alpha (high)');
    assert.deepEqual(app.errors,[]);
    assert.match(app.d.title,/IAscore/);
  } finally {app.close();}
});

test('new cursor follows the pointer, reacts to press and cleans up its trail on exit',async () => {
  const app=await boot({fine:true});try {
    const button=app.d.querySelector('#themeBtn'),ring=app.d.querySelector('#cursorRing');
    button.dispatchEvent(new app.w.MouseEvent('pointermove',{clientX:100,clientY:80,bubbles:true}));
    assert.equal(ring.classList.contains('active'),true);
    assert.equal(ring.classList.contains('hovering'),true);
    assert.equal(app.d.querySelectorAll('.cursor-trail').length,6);
    button.dispatchEvent(new app.w.MouseEvent('pointerdown',{bubbles:true}));
    assert.equal(ring.classList.contains('pressing'),true);
    app.w.dispatchEvent(new app.w.MouseEvent('pointerup'));
    assert.equal(ring.classList.contains('pressing'),false);
    app.d.documentElement.dispatchEvent(new app.w.MouseEvent('pointerleave'));
    assert.equal(ring.classList.contains('active'),false);
    assert.equal(app.d.querySelectorAll('.cursor-trail.active').length,0);
    assert.deepEqual(app.errors,[]);
  } finally {app.close();}
});
