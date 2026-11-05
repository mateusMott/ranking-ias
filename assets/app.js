(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const decimal = (value, digits = 2) => numeric(value) ? new Intl.NumberFormat('pt-BR', {maximumFractionDigits:digits}).format(value) : '—';
  const money = value => numeric(value) ? new Intl.NumberFormat('pt-BR', {style:'currency', currency:'USD', currencyDisplay:'narrowSymbol', minimumFractionDigits:2, maximumFractionDigits:2}).format(value) : '—';
  const context = value => !numeric(value) ? '—' : value >= 1000000 ? `${decimal(value / 1000000)}M` : value >= 1000 ? `${decimal(value / 1000)}k` : decimal(value, 0);
  const date = (value, time = false) => new Intl.DateTimeFormat('pt-BR', {
    timeZone:'America/Sao_Paulo', ...(time ? {hour:'2-digit', minute:'2-digit'} : {day:'2-digit', month:'short', year:'numeric'})
  }).format(new Date(value)).replace(/\./g, '');
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* Storage is optional. */ } }
  };
  const state = {data:null, query:'', company:'all', type:'all', price:'all', sort:'intelligence', direction:-1, selected:[], view:'ranking', network:'snapshot'};
  let loading = false, leaderId = null, toastTimer, dialogMode = null, previousFocus;
  const brandColors = {Google:'#548a6c', Anthropic:'#b8856d', OpenAI:'#5a887a', Meta:'#658fba', Alibaba:'#bc8a58', 'Z AI':'#8574ae', 'SpaceXAI':'#667c90', DeepSeek:'#678bc0'};

  function validateData(data) {
    if (!data || !Array.isArray(data.models) || !data.models.length || !Number.isFinite(Date.parse(data.updated_at))) throw new Error('Snapshot inválido');
    if (data.sources != null && (!Array.isArray(data.sources) || data.sources.some(source => !source || typeof source.name !== 'string'))) throw new Error('Fontes inválidas');
    const ids = new Set();
    for (const model of data.models) {
      if (!model || typeof model.id !== 'string' || !/^[a-z0-9-]+$/.test(model.id) || ids.has(model.id) || typeof model.name !== 'string' || typeof model.company !== 'string' || !numeric(model.intelligence) || model.intelligence > 100) throw new Error('Modelo inválido');
      for (const key of ['price','speed','latency','task_time_minutes','context_tokens','elo']) {
        if (model[key] != null && !numeric(model[key])) throw new Error('Métrica inválida');
      }
      ids.add(model.id);
    }
    return data;
  }
  const find = id => state.data?.models.find(model => model.id === id);
  const extreme = (models, key, direction = -1) => models.filter(m => numeric(m[key])).sort((a,b) => (a[key] - b[key]) * direction || b.intelligence - a.intelligence || a.name.localeCompare(b.name))[0];

  function filteredModels() {
    return (state.data?.models || []).filter(model => {
      const textMatch = `${model.name} ${model.company}`.toLocaleLowerCase('pt-BR').includes(state.query.toLocaleLowerCase('pt-BR'));
      const costMatch = state.price === 'all' || numeric(model.price) && (state.price === '2+' ? model.price > 2 : model.price <= Number(state.price));
      return textMatch && costMatch && (state.company === 'all' || model.company === state.company) && (state.type === 'all' || model.type === state.type);
    }).sort((a,b) => {
      const av = a[state.sort], bv = b[state.sort];
      if (!numeric(av)) return numeric(bv) ? 1 : a.name.localeCompare(b.name);
      if (!numeric(bv)) return -1;
      return (av - bv) * state.direction || b.intelligence - a.intelligence || a.name.localeCompare(b.name);
    });
  }

  function renderTable() {
    const models = filteredModels();
    const max = Math.max(...(state.data?.models || []).map(m => m.intelligence), 1);
    $('#rows').innerHTML = models.map((model, index) => {
      const selected = state.selected.includes(model.id);
      const avatar = model.company === 'Anthropic' ? '✳' : model.company === 'OpenAI' ? '◎' : model.company.charAt(0);
      return `<tr><td><span class="rank-number ${index < 3 ? 'rank-top' : ''}">${String(index + 1).padStart(2,'0')}</span></td><td><div class="model-cell"><span class="model-avatar" style="--avatar:${brandColors[model.company] || '#738b7e'}" aria-hidden="true">${esc(avatar)}</span><div class="model-text"><button class="model-name" data-detail="${esc(model.id)}" title="${esc(model.name)}">${esc(model.name)}</button><div class="model-sub">${esc(model.company)}${model.type === 'Pesos abertos' ? '<span class="open-mark">PESOS ABERTOS</span>' : ''}</div></div></div></td><td><div class="intelligence-cell"><span class="score-value">${decimal(model.intelligence,1)}</span><span class="score-bar" aria-hidden="true"><span style="width:${model.intelligence / max * 100}%"></span></span></div></td><td>${money(model.price)}</td><td>${decimal(model.task_time_minutes)}${numeric(model.task_time_minutes) ? '<span class="unit">min</span>' : ''}</td><td>${decimal(model.latency)}${numeric(model.latency) ? '<span class="unit">s</span>' : ''}</td><td>${context(model.context_tokens)}</td><td><button class="compare-toggle" data-compare="${esc(model.id)}" aria-pressed="${selected}" aria-label="${selected ? 'Remover' : 'Comparar'} ${esc(model.name)}">${selected ? icon('check') : '+'}</button></td></tr>`;
    }).join('');
    $('#emptyState').hidden = models.length !== 0;
    $('#count').textContent = `${models.length} de ${state.data?.models.length || 0} modelos`;
    $('#totalCount').textContent = state.data?.models.length || '—';
    $('#resetFilters').hidden = !state.query && state.company === 'all' && state.type === 'all' && state.price === 'all';
    $$('[data-sort-head]').forEach(th => {
      const active = th.dataset.sortHead === state.sort;
      if (active) th.setAttribute('aria-sort', state.direction === -1 ? 'descending' : 'ascending');
      else th.removeAttribute('aria-sort');
      th.querySelector('span').textContent = active ? state.direction === -1 ? '↓' : '↑' : '↕';
    });
    renderTray();
  }

  function renderTray() {
    const count = state.selected.length;
    $('#compareTray').hidden = !count;
    $('#trayTitle').textContent = `${count} ${count === 1 ? 'modelo selecionado' : 'modelos selecionados'}`;
    $('#selectedCount').textContent = count;
    $('#openCompare').disabled = count < 2;
  }

  function renderHighlights() {
    const models = state.data.models;
    const leader = extreme(models, 'intelligence');
    const cheapest = extreme(models, 'price', 1);
    const fastest = extreme(models, 'task_time_minutes', 1);
    leaderId = leader?.id;
    $('#leaderName').textContent = leader?.name || 'Sem dados';
    $('#leaderCompany').textContent = leader?.company || '—';
    $('#leaderScore').textContent = decimal(leader?.intelligence,1);
    $('#leaderArc').style.strokeDasharray = `${leader?.intelligence || 0} 100`;
    $('#leaderFoot').textContent = `${models.length} modelos · Índice oficial da Artificial Analysis`;
    $('#leaderDetail').disabled = !leader;
    $('#cheapestValue').textContent = money(cheapest?.price);
    $('#cheapestName').textContent = cheapest?.name || 'Métrica não disponível';
    $('#fastestValue').textContent = decimal(fastest?.task_time_minutes);
    $('#fastestName').textContent = fastest?.name || 'Métrica não disponível';
    $('#navCount').textContent = models.length;
  }

  function renderStatus() {
    if (!state.data) return;
    const age = Date.now() - Date.parse(state.data.updated_at);
    const stale = age > 48 * 3600000;
    const sourcesFailed = (state.data.sources || []).some(source => source.ok === false);
    const fallback = state.network !== 'live';
    $('#captureLabel').textContent = date(state.data.updated_at);
    $('#captureTime').textContent = `${date(state.data.updated_at,true)} · horário de Brasília`;
    $('#autoStatus').classList.toggle('warn', stale || sourcesFailed || fallback);
    $('#autoStatusText').textContent = stale ? 'Dados há mais de 48h' : state.network === 'offline' ? 'Sem conexão · cópia salva' : state.network === 'snapshot' ? 'Cópia incorporada' : state.network === 'cache' ? 'Cópia salva no navegador' : sourcesFailed ? 'Atualizado · fonte parcial' : 'Atualização diária ativa';
    const notices = [];
    if (stale) notices.push('A última coleta tem mais de 48 horas. Exibimos os últimos dados válidos; consulte as fontes para confirmar mudanças recentes.');
    if (state.network === 'offline') notices.push('Não foi possível buscar o arquivo publicado. Os dados exibidos foram preservados; uma nova tentativa acontece automaticamente.');
    if (location.protocol === 'file:') notices.push('Você está vendo a cópia incorporada. As novas coletas aparecem automaticamente na versão publicada do site.');
    if (sourcesFailed) notices.push('Uma fonte complementar não respondeu na última coleta. Os valores ausentes não foram estimados.');
    $('#dataNotice').textContent = notices.join(' ');
    $('#dataNotice').hidden = !notices.length;
  }

  function applyData(data, network) {
    const previousVersion = state.data?.updated_at;
    state.data = validateData(data);
    state.network = network;
    state.selected = state.selected.filter(id => find(id));
    const companies = [...new Set(data.models.map(m => m.company))].sort((a,b) => a.localeCompare(b));
    if (!companies.includes(state.company)) state.company = 'all';
    $('#company').innerHTML = '<option value="all">Todas as empresas</option>' + companies.map(company => `<option value="${esc(company)}">${esc(company)}</option>`).join('');
    $('#company').value = state.company;
    renderHighlights(); renderTable(); renderRecs(); renderStatus(); renderLivebench();
    if ($('#dialog').open && dialogMode === 'compare') renderCompare(false);
    if (previousVersion && previousVersion !== data.updated_at && network === 'live') toast('Novos dados recebidos. O ranking foi atualizado.');
  }

  async function loadPublishedData() {
    if (loading || location.protocol === 'file:' || document.visibilityState === 'hidden') return;
    loading = true;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      let response;
      try { response = await fetch(`models.json?t=${Date.now()}`, {cache:'no-store', signal:controller.signal}); }
      finally { clearTimeout(timeout); }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = validateData(await response.json());
      if (state.data && Date.parse(data.updated_at) < Date.parse(state.data.updated_at)) throw new Error('Cópia publicada mais antiga');
      applyData(data,'live');
      storage.set('modelscope:data:v2',JSON.stringify(data));
    } catch {
      state.network = 'offline'; renderStatus();
    } finally { loading = false; }
  }

  function renderLivebench() {
    const benchmark = state.data?.supplementary?.livebench;
    const usable = benchmark && Array.isArray(benchmark.models) && Array.isArray(benchmark.categories) && /^20\d{2}-\d{2}-\d{2}$/.test(benchmark.release);
    $('#livebenchSection').hidden = !usable;
    if (!usable) return;
    const selector = $('#livebenchCategory');
    const previous = selector.value;
    const labels = {'Reasoning':'Raciocínio','Coding':'Código','Agentic Coding':'Código com agentes','Mathematics':'Matemática','Data Analysis':'Análise de dados','Language':'Linguagem','IF':'Seguir instruções'};
    selector.innerHTML = benchmark.categories.map(category => `<option value="${esc(category)}">${esc(labels[category] || category)}</option>`).join('');
    if (benchmark.categories.includes(previous)) selector.value = previous;
    const category = selector.value;
    const rows = benchmark.models.filter(model => typeof model.name === 'string' && numeric(model.scores?.[category]) && model.scores[category] <= 100).sort((a,b) => b.scores[category] - a.scores[category] || a.name.localeCompare(b.name));
    $('#livebenchRows').innerHTML = rows.slice(0,10).map((model,i) => `<tr><td>${String(i+1).padStart(2,'0')}</td><td>${esc(model.name)}</td><td>${decimal(model.scores[category])}</td></tr>`).join('') || '<tr><td colspan="3">Sem resultados completos para esta área.</td></tr>';
    const source = state.data.sources?.find(source => source.name === 'LiveBench');
    $('#livebenchMeta').textContent = `Edição ${date(benchmark.release + 'T12:00:00Z')} · consultado em ${date(benchmark.collected_at)}${source?.ok === false ? ' · cópia preservada, coleta indisponível' : ''}`;
    $('#livebenchCount').textContent = `Top ${Math.min(rows.length,10)} de ${rows.length} modelos com medições completas`;
  }

  function renderRecs() {
    if (!state.data) return;
    const models = state.data.models;
    const options = [
      {title:'Mais capacidade técnica', text:'O maior Intelligence Index da Artificial Analysis. Um ponto de partida para raciocínio e tarefas complexas.', icon:'spark', key:'intelligence', direction:-1, format:m => `${decimal(m.intelligence,1)} pontos`},
      {title:'Menor custo por tarefa', text:'O menor custo observado no benchmark. Avalie a capacidade técnica junto da economia.', icon:'dollar', key:'price', direction:1, format:m => `${money(m.price)} / tarefa`},
      {title:'Menor tempo por tarefa', text:'O menor tempo para concluir uma tarefa no benchmark. Este valor está em minutos, não em tokens por segundo.', icon:'clock', key:'task_time_minutes', direction:1, format:m => `${decimal(m.task_time_minutes)} min`},
      {title:'Mais espaço para contexto', text:'A maior janela de contexto declarada. Mais espaço não garante melhor compreensão de documentos longos.', icon:'book', key:'context_tokens', direction:-1, format:m => `${context(m.context_tokens)} tokens`}
    ];
    $('#recs').innerHTML = options.map(option => {
      const model = extreme(models, option.key, option.direction);
      return `<article class="rec-card">${icon(option.icon)}<h3>${option.title}</h3><p>${option.text}</p><div class="rec-selection">${model ? `<button data-detail="${esc(model.id)}">${esc(model.name)}</button><span>${option.format(model)}</span>` : '<span>Sem dados disponíveis para este critério.</span>'}</div></article>`;
    }).join('');
  }

  function showDialog(kicker, content, mode) {
    previousFocus = document.activeElement;
    $('#dialogKicker').textContent = kicker;
    $('#dialogContent').innerHTML = content;
    dialogMode = mode;
    if (!$('#dialog').open) $('#dialog').showModal();
    $('#closeDialog').focus();
  }
  function closeDialog() {
    $('#dialog').close(); dialogMode = null;
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  const detailMetric = (label, value, unit = '') => `<div class="detail-cell"><span>${esc(label)}</span><strong>${value}${unit && value !== '—' ? `<small>${esc(unit)}</small>` : ''}</strong></div>`;
  function openDetail(model) {
    if (!model) return;
    showDialog(`FICHA DO MODELO · ${model.company}`, `<h2 id="dialogTitle">${esc(model.name)}</h2><p class="dialog-description">${esc(model.description)} Tipo: ${esc(model.type)}.</p><div class="detail-grid">${detailMetric('Intelligence Index',decimal(model.intelligence,1))}${detailMetric('Custo por tarefa',money(model.price),'USD')}${detailMetric('Tempo por tarefa',decimal(model.task_time_minutes),'min')}${detailMetric('Primeiro token de resposta',decimal(model.latency),'s')}${detailMetric('Janela de contexto',context(model.context_tokens),'tokens')}${detailMetric('Score Arena',decimal(model.elo,0))}${detailMetric('Velocidade de geração',decimal(model.speed),'tokens/s')}</div><p class="source-note"><strong>Fontes:</strong> ${esc(model.sources)}.<br>Coleta: ${date(state.data.updated_at)} às ${date(state.data.updated_at,true)} (Brasília).<br>“—” indica ausência na fonte. Scores de variantes diferentes não são combinados. O custo é o custo por tarefa medido pela fonte, não o preço por milhão de tokens.<br><a class="source-link" href="https://artificialanalysis.ai/leaderboards/models/" target="_blank" rel="noopener noreferrer">Consultar Artificial Analysis ↗</a>${model.arena_name ? ' · <a class="source-link" href="https://arena.ai/leaderboard/text" target="_blank" rel="noopener noreferrer">Consultar Arena ↗</a>' : ''}</p>`, 'detail');
  }

  function openSources() {
    const sources = state.data?.sources || [];
    const aa = sources.find(s => s.name === 'Artificial Analysis');
    const arena = sources.find(s => s.name === 'Arena');
    const livebench = sources.find(s => s.name === 'LiveBench');
    const status = source => `<span class="source-status ${source?.ok ? '' : 'warn'}">${source?.ok ? 'Coleta confirmada' : 'Sem confirmação nesta coleta'}</span>`;
    showDialog('PROVENIÊNCIA E ATUALIZAÇÃO', `<h2 id="dialogTitle">Fontes abertas. Critérios claros.</h2><p class="dialog-description">O IAscore reúne dados públicos. Cada fonte mantém sua própria metodologia e pode atualizar seus resultados em horários diferentes.</p><div class="source-block"><h3>Artificial Analysis ${status(aa)}</h3><p>Fonte principal para inteligência, custo por tarefa, tempo por tarefa, primeiro token de resposta e contexto. ${state.data?.models.length || 0} modelos na coleta atual. Não supomos uma versão de índice que a página não declare.</p><a class="source-link" href="https://artificialanalysis.ai/leaderboards/models/" target="_blank" rel="noopener noreferrer">Ver leaderboard ↗</a></div><div class="source-block"><h3>Arena ${status(arena)}</h3><p>Preferência humana expressa no score Arena. Associação apenas quando o nome normalizado e a variante coincidem exatamente. ${Number(arena?.matched_models || 0)} modelos associados na coleta atual. A classificação de pesos também exige declaração da fonte.</p><a class="source-link" href="https://arena.ai/leaderboard/text" target="_blank" rel="noopener noreferrer">Ver Text Arena ↗</a></div><div class="source-block"><h3>LiveBench 1.0 ${status(livebench)}</h3><p>Fonte complementar com tarefas públicas e correção verificável. Dados coletados do repositório oficial, com edição explícita. Cada nota é a média das tarefas de uma área, somente quando a área está completa. Não misturamos essas notas com o índice da Artificial Analysis nem associamos variantes por semelhança.</p><a class="source-link" href="https://github.com/LiveBench/livebench.github.io" target="_blank" rel="noopener noreferrer">Dados e código oficiais ↗</a></div><p class="source-note">Última coleta: ${state.data ? `${date(state.data.updated_at)} às ${date(state.data.updated_at,true)} (Brasília)` : 'indisponível'}.<br>A coleta está programada diariamente no GitHub Actions. Com a página aberta, verificamos novos dados a cada cinco minutos. Falhas na fonte principal preservam a última coleta válida. Agendamentos do GitHub podem sofrer atrasos.<br>SWEN.AI e rankings de imagem ou vídeo não alimentam este conjunto automaticamente.</p>`, 'sources');
  }

  function openMethod() {
    showDialog('COMO LER O RANKING', `<h2 id="dialogTitle">Compare o que é comparável.</h2><p class="dialog-description">A ordenação inicial usa o Intelligence Index da Artificial Analysis. Não criamos uma média que misture inteligência, custo, tempo e preferência humana em uma nota própria.</p><ol class="method-list"><li><strong>Inteligência:</strong> índice técnico publicado pela fonte. Quanto maior, melhor nesse conjunto de avaliações.</li><li><strong>Custo por tarefa:</strong> valor em dólares medido no benchmark. Não equivale ao preço de um milhão de tokens.</li><li><strong>Tempo por tarefa:</strong> minutos para concluir a tarefa. Menor tende a ser melhor. É diferente de velocidade em tokens/s.</li><li><strong>Primeiro token:</strong> segundos até o primeiro token de resposta. Modelos de raciocínio podem levar mais tempo antes de começar a responder.</li><li><strong>Contexto:</strong> janela em tokens. 1k = 1.000 tokens; 1M = 1.000.000 tokens. Maior janela não garante melhor desempenho.</li><li><strong>Arena:</strong> score de preferência humana, mostrado na ficha e na comparação somente quando a variante coincide.</li><li><strong>LiveBench 1.0:</strong> seção independente por área, com média aritmética das tarefas completas. A data da edição é diferente da data em que consultamos os dados; não representa o LiveBench 2.0.</li><li><strong>Dados ausentes:</strong> aparecem como “—” e ficam no fim da ordenação, em qualquer direção. Pesos não confirmados aparecem como “Não informado”.</li><li><strong>Seleções por objetivo:</strong> usam o maior ou menor valor do critério indicado no conjunto atual; não são um benchmark adicional.</li></ol><p class="source-note">O destaque verde na comparação marca o melhor valor observado entre os modelos selecionados. O tipo de licença e os termos comerciais devem ser confirmados com o desenvolvedor antes do uso.</p>`, 'method');
  }

  function renderCompare(open = true) {
    const chosen = state.selected.map(find).filter(Boolean);
    if (chosen.length < 2) {
      if (open) toast('Selecione de 2 a 3 modelos usando o botão + da tabela.');
      else closeDialog();
      return;
    }
    const metrics = [
      ['Inteligência','intelligence',v => decimal(v,1),-1],
      ['Custo por tarefa (USD)','price',money,1],
      ['Tempo por tarefa (min)','task_time_minutes',decimal,1],
      ['Primeiro token (s)','latency',decimal,1],
      ['Contexto (tokens)','context_tokens',context,-1],
      ['Score Arena','elo',v => decimal(v,0),-1],
      ['Velocidade (tokens/s)','speed',decimal,-1]
    ];
    const content = `<h2 id="dialogTitle">Lado a lado. Com mais clareza.</h2><p class="dialog-description">O melhor valor disponível para cada critério aparece em verde.</p><div class="comparison-scroll"><table class="comparison-table"><thead><tr><th scope="col">Critério</th>${chosen.map(m => `<th scope="col">${esc(m.name)}<br><span class="unit">${esc(m.company)}</span></th>`).join('')}</tr></thead><tbody>${metrics.map(([label,key,format,direction]) => {
      const best = extreme(chosen,key,direction)?.[key];
      return `<tr><th scope="row">${label}</th>${chosen.map(m => `<td class="${numeric(m[key]) && m[key] === best ? 'best' : ''}">${format(m[key])}</td>`).join('')}</tr>`;
    }).join('')}</tbody></table></div><p class="source-note">Coleta: ${date(state.data.updated_at)}. Valores ausentes não são estimados. Contexto e velocidade não substituem qualidade de resposta.</p>`;
    if (open) showDialog('BANCADA DE COMPARAÇÃO',content,'compare');
    else $('#dialogContent').innerHTML = content;
  }

  function setView(view) {
    state.view = view;
    const ranking = view === 'ranking';
    $('#rankingView').hidden = !ranking; $('#recommendationsView').hidden = ranking; $('#overview').hidden = !ranking;
    $('#crumb').textContent = ranking ? 'Visão geral' : 'Escolha por objetivo';
    $('#pageTitle').innerHTML = ranking ? 'Encontre a IA certa.<br><span>Decida com dados.</span>' : 'Cada projeto, uma prioridade.<br><span>Encontre o seu equilíbrio.</span>';
    $('#pageDescription').innerHTML = ranking ? 'Inteligência, custo e desempenho. Tudo o que importa,<br class="desktop-break"> em um único lugar para comparar.' : 'Explore seleções por critérios observáveis.<br class="desktop-break"> Elas acompanham cada nova coleta de dados.';
    $$('[data-view]').forEach(button => {
      const active = button.dataset.view === view; button.classList.toggle('active',active);
      if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
    });
    closeMenu(); window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  }
  function closeMenu() { const wasOpen = $('#sidebar').classList.contains('open'); $('#sidebar').classList.remove('open'); $('#sidebar').inert = window.innerWidth <= 950; $('#sidebarOverlay').hidden = true; $('#menuBtn').setAttribute('aria-expanded','false'); if (wasOpen) $('#menuBtn').focus(); }
  function resetFilters() {
    Object.assign(state,{query:'',company:'all',type:'all',price:'all'});
    $('#search').value = ''; $('#company').value = 'all'; $('#price').value = 'all';
    $$('[data-type]').forEach(button => { const active = button.dataset.type === 'all'; button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active)); });
    renderTable();
  }
  function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; },4500); }
  function exportCSV() {
    const header = ['Modelo','Empresa','Tipo','Intelligence Index','Custo por tarefa (USD)','Tempo por tarefa (min)','Primeiro token (s)','Contexto (tokens)','Score Arena','Coleta UTC'];
    const csvCell = value => { const text = String(value ?? ''); return `"${(/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replace(/"/g,'""')}"`; };
    const lines = [header,...filteredModels().map(m => [m.name,m.company,m.type,m.intelligence,m.price,m.task_time_minutes,m.latency,m.context_tokens,m.elo,state.data.updated_at])];
    const url = URL.createObjectURL(new Blob(['\uFEFF'+lines.map(line => line.map(csvCell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = `iascore-${state.data.version}.csv`;link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    toast('Dados exportados com os filtros atuais.');
  }

  document.addEventListener('click',event => {
    const detail = event.target.closest('[data-detail]');
    const compare = event.target.closest('[data-compare]');
    if (detail) openDetail(find(detail.dataset.detail));
    if (compare) {
      const id = compare.dataset.compare;
      if (state.selected.includes(id)) state.selected = state.selected.filter(x => x !== id);
      else if (state.selected.length < 3) state.selected.push(id);
      else { toast('Você pode comparar até 3 modelos. Remova um para trocar.'); return; }
      renderTable();
      $(`[data-compare="${id}"]`)?.focus({preventScroll:true});
    }
  });
  $$('[data-view]').forEach(button => button.addEventListener('click',() => setView(button.dataset.view)));
  $$('[data-type]').forEach(button => button.addEventListener('click',() => {
    state.type = button.dataset.type;
    $$('[data-type]').forEach(other => { other.classList.toggle('active',other === button);other.setAttribute('aria-pressed',String(other === button)); });
    renderTable();
  }));
  $$('[data-sort]').forEach(button => button.addEventListener('click',() => {
    const key = button.dataset.sort;
    state.direction = state.sort === key ? -state.direction : ['price','latency','task_time_minutes'].includes(key) ? 1 : -1;
    state.sort = key; renderTable();
  }));
  $('#livebenchCategory').addEventListener('change',renderLivebench);
  $('#search').addEventListener('input',event => { state.query = event.target.value.trim(); renderTable(); });
  $('#company').addEventListener('change',event => { state.company = event.target.value; renderTable(); });
  $('#price').addEventListener('change',event => { state.price = event.target.value; renderTable(); });
  $('#resetFilters').onclick = resetFilters; $('#emptyReset').onclick = resetFilters;
  $('#clearCompare').onclick = () => { state.selected = []; renderTable(); };
  $('#compareNav').onclick = () => { closeMenu(); renderCompare(); };
  $('#openCompare').onclick = () => renderCompare();
  $('#leaderDetail').onclick = () => openDetail(find(leaderId));
  ['sourcesNav','sidebarSources','footerSources'].forEach(id => { $(`#${id}`).onclick = () => { closeMenu(); openSources(); }; });
  ['methodInline','methodMore'].forEach(id => { $(`#${id}`).onclick = openMethod; });
  $('#methodNav').onclick = () => { closeMenu(); $('#method').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}); };
  $('#exportBtn').onclick = exportCSV;
  $('#closeDialog').onclick = closeDialog;
  $('#dialog').addEventListener('click',event => { if (event.target === $('#dialog')) { const rect = $('#dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(); } });
  $('#dialog').addEventListener('cancel',event => { event.preventDefault(); closeDialog(); });
  $('#sidebar').inert = window.innerWidth <= 950;
  window.addEventListener('resize',() => { $('#sidebar').inert = window.innerWidth <= 950 && !$('#sidebar').classList.contains('open'); if (window.innerWidth > 950) closeMenu(); });
  $('#menuBtn').onclick = () => { const open = !$('#sidebar').classList.contains('open'); $('#sidebar').inert = !open && window.innerWidth <= 950; $('#sidebar').classList.toggle('open',open); $('#sidebarOverlay').hidden = !open; $('#menuBtn').setAttribute('aria-expanded',String(open)); if (open) $('.nav-item').focus(); };
  $('#sidebarOverlay').onclick = closeMenu;
  document.addEventListener('keydown',event => {
    if (event.key === 'Escape') closeMenu();
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !$('#dialog').open && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault();if (state.view !== 'ranking') setView('ranking');$('#search').focus(); }
  });
  $('.brand').onclick = event => { event.preventDefault(); setView('ranking'); };

  function setTheme(theme) { document.documentElement.dataset.theme = theme; $('#themeBtn').setAttribute('aria-pressed',String(theme === 'dark')); $('#themeBtn').setAttribute('aria-label',theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'); }
  setTheme(storage.get('modelscope:theme') === 'dark' ? 'dark' : 'light');
  $('#themeBtn').onclick = () => { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';setTheme(theme);storage.set('modelscope:theme',theme); };

  function setupCursor() {
    const ring = $('#cursorRing'), reduced = matchMedia('(prefers-reduced-motion: reduce)'), fine = matchMedia('(pointer: fine)');
    let enabled = storage.get('modelscope:cursor') !== 'off', frame = 0, x = -100, y = -100, targetX = -100, targetY = -100, hovering = false;
    const allowed = () => enabled && fine.matches && !reduced.matches;
    const updateButton = () => { $('#cursorBtn').setAttribute('aria-pressed',String(enabled));$('#cursorBtn').setAttribute('aria-label',`${enabled ? 'Desativar' : 'Ativar'} efeito do cursor`); };
    function stop() { if (frame) cancelAnimationFrame(frame);frame = 0;ring.classList.remove('active'); }
    function animate() {
      x += (targetX - x) * .25; y += (targetY - y) * .25;
      const offset = hovering ? 21.5 : 15;
      ring.style.transform = `translate3d(${x - offset}px,${y - offset}px,0)`;
      frame = Math.abs(targetX - x) + Math.abs(targetY - y) > .1 ? requestAnimationFrame(animate) : 0;
    }
    document.addEventListener('pointermove',event => {
      if (!allowed() || event.pointerType === 'touch') { stop();return; }
      targetX = event.clientX; targetY = event.clientY;
      if (!ring.classList.contains('active')) { x = targetX;y = targetY; }
      hovering = Boolean(event.target.closest('button,a,input,select'));ring.classList.toggle('hovering',hovering);ring.classList.add('active');
      if (!frame) frame = requestAnimationFrame(animate);
    },{passive:true});
    document.documentElement.addEventListener('pointerleave',stop);window.addEventListener('blur',stop);
    reduced.addEventListener('change',stop);fine.addEventListener('change',stop);
    $('#cursorBtn').onclick = () => { enabled = !enabled;storage.set('modelscope:cursor',enabled ? 'on' : 'off');updateButton();if (!enabled) stop();toast(`Efeito do cursor ${enabled ? 'ativado' : 'desativado'}.`); };
    updateButton();
  }
  setupCursor();
  let initial;
  try { initial = validateData(JSON.parse($('#snapshot').textContent)); } catch { /* A network request can recover an absent snapshot. */ }
  try {
    const saved = validateData(JSON.parse(storage.get('modelscope:data:v2')));
    if (!initial || Date.parse(saved.updated_at) > Date.parse(initial.updated_at)) { initial = saved;state.network = 'cache'; }
  } catch { /* Invalid or unavailable caches are ignored. */ }
  if (initial) applyData(initial,state.network);
  else { $('#dataNotice').hidden = false; $('#dataNotice').textContent = 'Carregando dados publicados. Se a conexão falhar, tente novamente mais tarde.'; }
  loadPublishedData();
  setInterval(() => { renderStatus(); loadPublishedData(); },300000);
  document.addEventListener('visibilitychange',() => { if (document.visibilityState === 'visible') { renderStatus();loadPublishedData(); } });
  window.addEventListener('online',loadPublishedData);
})();
