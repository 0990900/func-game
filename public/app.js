const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
let ws = null;
let reconnectTimer = null;
let state = null;
let selectedCardId = null;
let selectedMarketId = null;
const $ = (id) => document.getElementById(id);

function connect() {
  clearTimeout(reconnectTimer);
  $('connection').textContent = '연결 중';
  ws = new WebSocket(wsUrl);
  ws.addEventListener('open', () => $('connection').textContent = '연결됨');
  ws.addEventListener('close', () => {
    $('connection').textContent = '재연결 중';
    reconnectTimer = setTimeout(connect, 1000);
  });
  ws.addEventListener('error', () => $('connection').textContent = '연결 오류');
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'error') return toast(msg.message);
    if (msg.type === 'state') { state = msg.state; selectedCardId = null; selectedMarketId = null; render(); }
  });
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
  $('roomId').textContent=`방 ${state.roomId}`;
  $('phase').textContent=state.phase==='draft' ? `Round ${state.round} · Pick ${state.pick} · ${state.direction==='left'?'← 패스':'→ 패스'}` : phaseName(state.phase);
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
  $('pickHelp').textContent=state.me.isMyTurn?'당신의 턴입니다. 한 장을 선택하세요.':`${current?.name||'다른 플레이어'}의 턴입니다.`;
  renderCards('hand', state.me.hand, c=>{ if(!state.me.isMyTurn)return; selectedCardId=c.id; selectedMarketId=null; renderGame(); }, selectedCardId, false, !state.me.isMyTurn);
  renderCards('market', state.market, c=>{ if(!state.me.isMyTurn||!selectedCardId)return; selectedMarketId=(selectedMarketId===c.id?null:c.id); renderGame(); }, selectedMarketId, true, !state.me.isMyTurn||!selectedCardId);
  $('confirmPanel').classList.toggle('hidden', !selectedCardId || !state.me.isMyTurn);
  const selected=state.me.hand.find(c=>c.id===selectedCardId); const market=state.market.find(c=>c.id===selectedMarketId);
  $('confirmText').textContent=selected ? (market ? `${selected.label} 대신 시장의 ${market.label} 획득` : `${selected.label} 획득`) : '';
  const mePublic=state.players.find(p=>p.id===state.me.id); $('myArea').innerHTML=chips(mePublic.playArea);
  $('claims').innerHTML=''; state.me.availableClaims.forEach(c=>{const b=document.createElement('button');b.className='secondary';b.textContent=`Claim ${c.container} ${c.name} (+1)`;b.addEventListener('click',()=>send('claim',{container:c.container,name:c.name}));$('claims').appendChild(b);});
  $('others').innerHTML=state.players.filter(p=>p.id!==state.me.id).map(p=>`<div class="player"><strong>${esc(p.name)}</strong><div class="chips">${chips(p.playArea)}</div></div>`).join('');
  $('reveal').innerHTML=state.lastReveal.length?state.lastReveal.map(r=>`<span class="chip">${esc(r.playerName)} → ${esc(r.card.label)}</span>`).join(''):'<span class="kind">아직 공개된 픽이 없습니다.</span>';
}
function renderFinished(){
  $('finished').classList.remove('hidden');
  $('scores').innerHTML=state.scores.map((s,i)=>`<div class="player"><strong>${i+1}위 · ${esc(s.name)} · ${s.total}점</strong><div class="kind">조합 ${s.comboScore} · Utility ${s.utilityScore} · Claim ${s.claimScore} · 목표 ${s.goalScore}</div></div>`).join('');
}
function renderCards(targetId,cards,onClick,selectedId,market=false,disabled=false){
  const target=$(targetId); target.innerHTML=''; cards.forEach(c=>{const b=document.createElement('button');b.className='card';if(c.id===selectedId)b.classList.add('selected');b.disabled=disabled;b.innerHTML=`<div class="kind">${esc(kind(c))}</div><div class="label">${esc(c.label)}</div>`;b.addEventListener('click',()=>onClick(c));target.appendChild(b);});
}
function kind(c){if(c.kind==='utility')return'UTILITY';if(c.kind.includes('wildcard'))return'JOKER';return c.container||'';}
function chips(cards){return cards.length?cards.map(c=>`<span class="chip">${esc(c.label)}</span>`).join(''):'<span class="kind">아직 없음</span>';}
function esc(v){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function toast(text){const t=$('toast');t.textContent=text;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}
