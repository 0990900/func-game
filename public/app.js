const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
let ws = null;
let reconnectTimer = null;
let state = null;
let selectedCardId = null;
let selectedMarketId = null;
const $ = (id) => document.getElementById(id);
const containerMeta = {
  Maybe: { symbol: '◇?', className: 'maybe' },
  Either: { symbol: '◐', className: 'either' },
  List: { symbol: '≡', className: 'list' },
  Task: { symbol: 'ϟ', className: 'task' },
};
const operationMeta = {
  map: ['↦', '구조를 유지해 변환'], ap: ['⊛', '함수를 구조 안에서 적용'], pure: ['η', '값을 구조에 올리기'],
  chain: ['⋙', '연산을 순서대로 연결'], alt: ['∨', '실패 시 다른 선택'], zero: ['∅', '빈 선택'],
  bimap: ['⇄', '양쪽 값을 함께 변환'], reduce: ['Σ', '여러 값을 하나로 접기'], traverse: ['⤨', '효과를 유지해 순회'],
};

function connect() {
  clearTimeout(reconnectTimer);
  setConnection('연결 중', 'is-connecting');
  ws = new WebSocket(wsUrl);
  ws.addEventListener('open', () => setConnection('연결됨', 'is-connected'));
  ws.addEventListener('close', () => {
    setConnection('재연결 중', 'is-connecting');
    reconnectTimer = setTimeout(connect, 1000);
  });
  ws.addEventListener('error', () => setConnection('연결 오류', 'is-error'));
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'error') return toast(msg.message);
    if (msg.type === 'state') {
      const wasMyTurn = state?.me?.isMyTurn;
      state = msg.state; selectedCardId = null; selectedMarketId = null;
      if (state.me.isMyTurn && !wasMyTurn) announceMyTurn();
      if (!state.me.isMyTurn) document.title = 'FP Draft Game';
      render();
    }
  });
}
function setConnection(text, className) {
  const indicator = $('connection');
  indicator.textContent = text;
  indicator.className = `pill ${className}`;
}
connect();

const send = (type, payload={}) => {
  if (ws?.readyState !== WebSocket.OPEN) return toast('서버에 연결 중입니다. 잠시 후 다시 시도하세요.');
  ws.send(JSON.stringify({ type, ...payload }));
};

$('create').addEventListener('click', () => send('create_room', { name:$('name').value }));
$('join').addEventListener('click', () => send('join_room', { roomId:$('roomCode').value.trim(), name:$('name').value }));
$('start').addEventListener('click', () => send('start_game'));
$('submitPick').addEventListener('click', () => { if(selectedCardId) send('pick',{cardId:selectedCardId,marketCardId:selectedMarketId}); });
$('clearPick').addEventListener('click', () => { selectedCardId=null; selectedMarketId=null; render(); });

function render(){
  $('entry').classList.toggle('hidden', !!state);
  $('room').classList.toggle('hidden', !state);
  if(!state) return;
  document.body.classList.toggle('my-turn', state.me.isMyTurn);
  $('roomId').textContent=`방 ${state.roomId}`;
  $('phase').textContent=state.phase==='draft' ? `Round ${state.round}/3 · Pick ${state.pick}/5 · ${state.progress.turnsTotal-state.progress.turnsCompleted}턴 남음 · ${state.direction==='left'?'← 패스':'→ 패스'}` : phaseName(state.phase);
  for(const id of ['lobby','goals','game','finished']) $(id).classList.add('hidden');
  if(state.phase==='lobby') renderLobby();
  else if(state.phase==='goal') renderGoals();
  else if(state.phase==='draft') renderGame();
  else if(state.phase==='finished') renderFinished();
}
function phaseName(p){ return ({lobby:'대기실',goal:'비밀 목표 선택',finished:'게임 종료'})[p]||p; }
function renderLobby(){
  $('lobby').classList.remove('hidden');
  $('lobbyPlayers').innerHTML=state.players.map(p=>`<div class="player"><strong>${esc(p.name)}</strong>${p.bot?' · Bot':''}</div>`).join('');
  $('start').classList.toggle('hidden', state.me.id!==state.hostPlayerId);
}
function renderGoals(){
  $('goals').classList.remove('hidden');
  if(state.me.goal){ $('goalCards').innerHTML='<p>목표를 선택했습니다. 다른 플레이어를 기다리는 중입니다.</p>'; return; }
  $('goalCards').innerHTML='';
  state.me.goalOptions.forEach(g=>{ const b=document.createElement('button'); b.className='goal'; b.innerHTML=`<strong>${esc(g.name)} · +${g.score}</strong><span>${esc(g.text)}</span>`; b.addEventListener('click',()=>send('choose_goal',{goalId:g.id})); $('goalCards').appendChild(b); });
}
function renderGame(){
  $('game').classList.remove('hidden');
  const current=state.players.find(p=>p.id===state.currentPlayerId);
  $('pickHelp').textContent=state.me.canFinishClaim?'완성한 새 조합을 Claim하거나 턴을 넘기세요.':state.me.isMyTurn?'당신의 턴입니다. 한 장을 선택하세요.':`${current?.name||'다른 플레이어'}의 턴입니다.`;
  $('turnTrack').innerHTML=state.turnOrder.map((id,index)=>{const p=state.players.find(player=>player.id===id);const done=index<state.progress.turnsThisPick;return `<span class="turn-player ${done?'is-done':`status-${p.status}`}"><b>${index+1}</b>${esc(p.name)}<small>${done?'완료':statusName(p.status)}</small></span>`;}).join('<i>→</i>');
  $('roundTrack').innerHTML=Array.from({length:5},(_,index)=>`<span class="round-dot ${index+1<state.pick?'done':index+1===state.pick?'current':''}">${index+1}</span>`).join('');
  $('progressSummary').textContent=`내 선택 ${state.progress.myPicks}/${state.progress.myPicksTotal} · 전체 ${state.progress.turnsCompleted}/${state.progress.turnsTotal}`;
  renderCards('hand', state.me.hand, c=>{ if(!state.me.isMyTurn)return; selectedCardId=c.id; selectedMarketId=null; renderGame(); }, selectedCardId, false, !state.me.isMyTurn);
  renderCards('market', state.market, c=>{ if(!state.me.isMyTurn||!selectedCardId)return; selectedMarketId=(selectedMarketId===c.id?null:c.id); renderGame(); }, selectedMarketId, true, !state.me.isMyTurn||!selectedCardId);
  $('confirmPanel').classList.toggle('hidden', !selectedCardId || !state.me.isMyTurn);
  const selected=state.me.hand.find(c=>c.id===selectedCardId); const market=state.market.find(c=>c.id===selectedMarketId);
  $('confirmText').textContent=selected ? (market ? `${selected.label} 대신 시장의 ${market.label} 획득` : `${selected.label} 획득`) : '';
  const mePublic=state.players.find(p=>p.id===state.me.id); $('myScore').textContent=`공개 ${mePublic.publicScore.total}점`; $('myScore').title=scoreBreakdown(mePublic.publicScore); $('comboProgress').innerHTML=comboProgress(mePublic.playArea); $('myArea').innerHTML=chips(mePublic.playArea);
  $('claims').innerHTML=''; state.me.availableClaims.forEach(c=>{const b=document.createElement('button');b.className='claim-action';b.textContent=`Claim ${c.container} ${c.name} (+1)`;b.addEventListener('click',()=>send('claim',{container:c.container,name:c.name}));$('claims').appendChild(b);});
  if(state.me.canFinishClaim){const skip=document.createElement('button');skip.className='secondary';skip.textContent='Claim 선택을 마치고 턴 넘기기';skip.addEventListener('click',()=>send('finish_claim'));$('claims').appendChild(skip);}
  $('others').innerHTML=state.players.filter(p=>p.id!==state.me.id).map(p=>`<div class="player ${p.status==='playing'?'is-playing':''}"><div class="player-heading"><strong>${esc(p.name)}</strong><span class="player-meta"><span class="score-pill" title="${esc(scoreBreakdown(p.publicScore))}">공개 ${p.publicScore.total}점</span><span class="status-badge status-${p.status}">${statusName(p.status)}</span></span></div><div class="chips">${chips(p.playArea)}</div></div>`).join('');
  $('events').innerHTML=state.events.length?state.events.map(event=>`<div class="event event-${event.type}"><span aria-hidden="true">${eventIcon(event.type)}</span><p>${esc(event.message)}</p></div>`).join(''):'<div class="empty-state"><b>게임을 준비하고 있습니다.</b><span>플레이어의 행동이 여기에 기록됩니다.</span></div>';
}
function renderFinished(){
  $('finished').classList.remove('hidden');
  $('scores').innerHTML=state.scores.map((s,i)=>`<div class="player"><strong>${i+1}위 · ${esc(s.name)} · ${s.total}점</strong><div class="kind">조합 ${s.comboScore} · Utility ${s.utilityScore} · Claim ${s.claimScore} · 목표 ${s.goalScore}</div></div>`).join('');
}
function renderCards(targetId,cards,onClick,selectedId,market=false,disabled=false){
  const target=$(targetId); target.innerHTML=''; cards.forEach(c=>{const b=document.createElement('button');b.className=`card card--${cardTheme(c)}`;if(c.id===selectedId)b.classList.add('selected');b.disabled=disabled;const meta=cardMeta(c);b.innerHTML=`<div class="card-top"><span class="card-sigil">${esc(meta.containerSymbol)}</span><span class="kind">${esc(meta.kindLabel)}</span></div><div class="operation-symbol" aria-hidden="true">${esc(meta.operationSymbol)}</div><div class="label">${esc(meta.operationLabel)}</div><div class="card-hint">${esc(meta.hint)}</div>`;b.addEventListener('click',()=>onClick(c));target.appendChild(b);});
}
function cardTheme(c){if(c.kind==='utility')return'utility';if(c.kind.includes('wildcard'))return'wildcard';return containerMeta[c.container]?.className||'neutral';}
function cardMeta(c){
  if(c.kind==='utility') return {containerSymbol:'λ',kindLabel:'UTILITY',operationSymbol:'ƒ',operationLabel:c.operation,hint:'다양성 점수 카드'};
  if(c.kind.includes('wildcard')) return {containerSymbol:'✦',kindLabel:'WILDCARD',operationSymbol:c.operation==='*'?'⁕':operationMeta[c.operation]?.[0]||'⁕',operationLabel:c.label,hint:'필요한 자리를 대신합니다'};
  const op=operationMeta[c.operation]||['·','함수 연산']; const container=containerMeta[c.container];
  return {containerSymbol:container?.symbol||'ƒ',kindLabel:c.container,operationSymbol:op[0],operationLabel:c.operation,hint:op[1]};
}
function comboProgress(cards){
  const requirements=['map','ap','pure','chain'];
  return Object.entries(containerMeta).map(([container,meta])=>{
    const covered=coveredOperations(cards,container,requirements);
    const steps=requirements.map(op=>`<span class="combo-step ${covered.has(op)?'complete':''}">${operationMeta[op][0]} ${op}</span>`).join('');
    return `<div class="combo-row"><span class="combo-container card--${meta.className}">${meta.symbol} ${container}</span><div>${steps}</div></div>`;
  }).join('');
}
function coveredOperations(cards,container,requirements){
  const available=[...cards]; const covered=new Set();
  for(const op of requirements){
    const index=available.findIndex(c=>(c.kind==='container-function'&&c.container===container&&c.operation===op)||(c.kind==='operation-wildcard'&&c.operation===op)||(c.kind==='container-wildcard'&&c.container===container)||c.kind==='wildcard');
    if(index>=0){covered.add(op);available.splice(index,1);}
  }
  return covered;
}
function chips(cards){return cards.length?cards.map(c=>`<span class="chip card--${cardTheme(c)}"><b>${esc(cardMeta(c).containerSymbol)}</b>${esc(c.label)}</span>`).join(''):'<span class="empty-state"><b>첫 카드를 기다리는 중</b><span>손패에서 한 장을 선택하면 여기에 놓입니다.</span></span>';}
function statusName(status){return ({playing:'플레이 중',claiming:'Claim 선택',waiting:'대기 중',choosing_goal:'목표 선택 중',ready:'선택 완료',disconnected:'연결 끊김',finished:'종료',lobby:'대기실'})[status]||status;}
function eventIcon(type){return ({pick:'↦',market:'⇄',claim:'★',claim_ready:'☆',pass:'➜',round_start:'◆',game_start:'◇',game_end:'■',turn_order:'①',join:'+',disconnect:'!',reconnect:'↻',goal_ready:'✓'})[type]||'·';}
function scoreBreakdown(score){return `조합 ${score.comboScore} · Utility ${score.utilityScore} · Claim ${score.claimScore} · 비밀 목표 제외`;}
function announceMyTurn(){
  document.title='내 턴! · FP Draft';
  toast('내 턴입니다. 손패에서 한 장을 선택하세요.');
  try {
    const audio=new AudioContext(); const oscillator=audio.createOscillator(); const gain=audio.createGain();
    oscillator.frequency.value=660; gain.gain.setValueAtTime(.04,audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.18);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime+.18);
  } catch {}
}
function esc(v){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function toast(text){const t=$('toast');t.textContent=text;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}
