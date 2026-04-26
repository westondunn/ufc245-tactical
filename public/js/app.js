(()=>{
const __t0=performance.now();

// Math utilities
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// XSS prevention
function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Theme — single source of truth, reads from CSS :root tokens in styles.css.
// Use these in new chart/viz code instead of hardcoded hex literals.
const theme = (() => {
  const s = getComputedStyle(document.documentElement);
  const v = name => s.getPropertyValue(name).trim();
  return {
    red:      v('--red')            || '#FF2D3F',
    blue:     v('--blue')           || '#2DB4FF',
    green:    v('--green')          || '#7CFFC8',
    amber:    v('--amber')          || '#FFB020',
    cyan:     v('--cyan')           || '#2DDCFF',
    warning:  v('--state-warning')  || '#FFB020',
    positive: v('--state-positive') || '#7CFFC8',
    ground:   v('--state-ground')   || '#7CFFC8',
    clinch:   v('--state-clinch')   || '#FFB020',
    fracture: v('--state-fracture') || '#FFB020',
    muted:    v('--muted')          || '#7A8394',
    mutedDim: v('--muted-dim')      || '#464E5C',
    fg:       v('--fg')             || '#E8ECF5',
    fgDim:    v('--fg-dim')         || '#B0B8C9',
    border:   v('--border')         || '#1A2030',
    bg:       v('--bg')             || '#04050A',
  };
})();

/* -----------------------------------------------------------
   DATA MODEL — all verified from UFCStats.com
----------------------------------------------------------- */
const DATA = {
  rounds: [
    {
      n: 1,
      usman: { sig:[34,91], head:[20,72], body:[11,16], leg:[3,3], dist:[30,87], clinch:[4,4], ground:[0,0], kd:0 },
      covington: { sig:[39,111], head:[27,95], body:[7,11], leg:[5,5], dist:[39,111], clinch:[0,0], ground:[0,0], kd:0 },
      winner: 'C',
      judges: ['C','C','C'],
      summary: "Covington wins 3-0 on cards. Explosive opening — no feel-out. Both men come out throwing fire.",
      events: [
        { t:'0:10', text:"Usman slips to the canvas after a kick exchange · recovers before Covington can capitalize.", cat:'neutral' },
        { t:'1:30', text:"Covington lands a hard knee in a combination exchange.", cat:'blue' },
        { t:'2:30', text:"Covington lands a huge left hand that briefly buzzes Usman. Biggest strike of the round.", cat:'blue' },
        { t:'3:30', text:"Usman lands body shot. Straight and uppercut follow.", cat:'red' }
      ]
    },
    {
      n: 2,
      usman: { sig:[40,79], head:[27,59], body:[11,17], leg:[2,3], dist:[40,79], clinch:[0,0], ground:[0,0], kd:0 },
      covington: { sig:[41,97], head:[32,88], body:[8,8], leg:[1,1], dist:[41,97], clinch:[0,0], ground:[0,0], kd:0 },
      winner: '÷',
      judges: ['U','C','C'],
      summary: "Split round · Cleary 10-9 Usman · Colon 10-9 Covington · D'Amato 10-9 Covington",
      events: [
        { t:'5:00', text:"Usman opens with a head kick. Jabs cause damage around Covington's right eye.", cat:'red' },
        { t:'6:30', text:"Covington's overhand left and right hook appear to buzz Usman. Usman responds with a straight right.", cat:'blue' },
        { t:'7:30', text:"⚠ Covington's body kick lands on Usman's cup. Borderline low blow. Goddard briefly halts action.", cat:'foul' },
        { t:'9:00', text:"Usman lands hard body shots · cracks Covington with an uppercut. Heavy body shot closes round.", cat:'red' }
      ]
    },
    {
      n: 3,
      usman: { sig:[29,50], head:[19,37], body:[10,13], leg:[0,0], dist:[28,49], clinch:[1,1], ground:[0,0], kd:0 },
      covington: { sig:[8,51], head:[5,46], body:[3,5], leg:[0,0], dist:[8,51], clinch:[0,0], ground:[0,0], kd:0 },
      winner: 'U',
      judges: ['U','U','U'],
      summary: "TURNING POINT. Covington's output collapses 97→51 attempts · landed only 8 at 15% accuracy. Jaw fracture likely occurs here.",
      events: [
        { t:'11:00', text:"Usman uses right hand and front kicks to the body effectively · pace deliberately slowed.", cat:'red' },
        { t:'13:00', text:"Usman lands 1-2, right cross, left hook. Covington momentarily rallies with head kick + straight left.", cat:'red' },
        { t:'14:15', text:"⚠ Eye poke by Covington during kick-jab combo. Goddard stops action · Octagonside physician clears Usman.", cat:'foul' },
        { t:'14:50', text:"💥 Usman cracks Covington with a massive right cross to close the round · almost certainly the jaw-breaking punch.", cat:'critical' },
        { t:'R3/R4 corner', text:'Covington jaw fracture apparent between rounds. Confirmed by NSAC medical suspension.', cat:'critical' }
      ]
    },
    {
      n: 4,
      usman: { sig:[35,68], head:[20,50], body:[14,17], leg:[1,1], dist:[35,68], clinch:[0,0], ground:[0,0], kd:0 },
      covington: { sig:[36,76], head:[25,59], body:[7,12], leg:[4,5], dist:[36,76], clinch:[0,0], ground:[0,0], kd:0 },
      winner: '÷',
      judges: ['U','U','C'],
      summary: "Toss-up. Covington's resilience is extraordinary — matches Usman output fighting through a broken jaw.",
      events: [
        { t:'15:30', text:"Tentative opening — both cautious after intense R3.", cat:'neutral' },
        { t:'16:30', text:"Covington lands uppercuts. Usman digs body shots. Trading rights in center.", cat:'neutral' },
        { t:'18:00', text:"Covington lands left hand, Usman hurt. 3-punch combination lands. Usman answers with body kick.", cat:'blue' },
        { t:'19:15', text:"Covington throws Superman punch → Usman catches him with a knee. Both fighters laugh and trash-talk mid-round.", cat:'neutral' },
        { t:'19:30', text:"They trade heavy blows to close the round.", cat:'neutral' }
      ]
    },
    {
      n: 5,
      usman: { sig:[37,72], head:[30,61], body:[7,11], leg:[0,0], dist:[23,57], clinch:[0,0], ground:[14,15], kd:2 },
      covington: { sig:[19,60], head:[14,53], body:[3,3], leg:[2,4], dist:[19,60], clinch:[0,0], ground:[0,0], kd:0 },
      winner: 'TKO',
      judges: ['TKO','TKO','TKO'],
      summary: "THE FINISH. Usman drops Covington twice with right hands · unleashes 14 hammerfists in 11s. Goddard stops at 4:10.",
      events: [
        { t:'20:00', text:"Covington comes out aggressive, landing combinations early. Appears to be winning opening 2 min.", cat:'blue' },
        { t:'22:30', text:"Usman begins pushing back. Hard 3-2 combination near fence.", cat:'red' },
        { t:'3:30 R5', text:"💥 FIRST KNOCKDOWN. Usman fakes 2-3, adjusts, lands devastating right hand. Covington rolls out, pops up.", cat:'critical' },
        { t:'3:45 R5', text:"💥 SECOND KNOCKDOWN. Second right straight sends Covington crashing. \"Right into the jaw.\"", cat:'critical' },
        { t:'4:10 R5', text:"🏁 TKO. Covington takedown attempt · Usman defends · ground strikes · Ref Goddard stops fight.", cat:'critical' }
      ]
    }
  ],
  totals: {
    usman:     { sig:[175,360], head:[116,279], body:[53,74], leg:[6,7], dist:[156,340], clinch:[5,5], ground:[14,15], kd:2 },
    covington: { sig:[143,395], head:[103,341], body:[28,39], leg:[12,15], dist:[143,395], clinch:[0,0], ground:[0,0], kd:0 }
  },
  durations: [5, 5, 5, 5, 4.1667],  // minutes per round (R5 = 4:10)
};

/* -----------------------------------------------------------
   SVG UTILITIES
----------------------------------------------------------- */
const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs={}, parent) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};

const tip = document.createElement('div');
tip.className = 'tip';
document.body.appendChild(tip);
function showTip(x, y, html){
  tip.innerHTML = html;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
  tip.classList.add('show');
}
function hideTip(){ tip.classList.remove('show'); }

/* -----------------------------------------------------------
   CHART 1: ROUND-BY-ROUND DIVERGING BARS
----------------------------------------------------------- */
function renderRoundsChart(){
  const svg = document.getElementById('roundsChart');
  const W = 1200, H = 480;
  const M = { t:40, r:80, b:60, l:80 };
  const CX = W / 2;
  const rowH = (H - M.t - M.b) / 5;
  const barH = 28;
  const maxVal = 45;
  const plotW = (W - M.r - M.l) / 2 - 20;

  // Center axis
  el('line', { x1:CX, y1:M.t, x2:CX, y2:H-M.b, stroke:'#1A2030', 'stroke-width':1 }, svg);

  // Header labels
  const headA = el('g', {}, svg);
  el('text', { x:CX - plotW - 4, y:M.t - 14, 'text-anchor':'end', 'font-size':10, 'letter-spacing':'.15em', fill:'#FF2D3F' }, headA).textContent = 'USMAN ←';
  el('text', { x:CX + plotW + 4, y:M.t - 14, 'text-anchor':'start', 'font-size':10, 'letter-spacing':'.15em', fill:'#2DB4FF' }, headA).textContent = '→ COVINGTON';
  el('text', { x:CX, y:M.t - 14, 'text-anchor':'middle', 'font-size':10, 'letter-spacing':'.15em', fill:'#7A8394' }, headA).textContent = 'SIG. STRIKES LANDED';

  // Scale ticks
  for (let v = 10; v <= maxVal; v += 10){
    const dx = v / maxVal * plotW;
    el('line', { x1:CX-dx, y1:M.t, x2:CX-dx, y2:H-M.b, stroke:'#151B28', 'stroke-dasharray':'2 3' }, svg);
    el('line', { x1:CX+dx, y1:M.t, x2:CX+dx, y2:H-M.b, stroke:'#151B28', 'stroke-dasharray':'2 3' }, svg);
    el('text', { x:CX-dx, y:H-M.b+16, 'text-anchor':'middle', 'font-size':9, fill:'#464E5C' }, svg).textContent = v;
    el('text', { x:CX+dx, y:H-M.b+16, 'text-anchor':'middle', 'font-size':9, fill:'#464E5C' }, svg).textContent = v;
  }
  el('text', { x:CX, y:H-M.b+16, 'text-anchor':'middle', 'font-size':9, fill:'#464E5C' }, svg).textContent = '0';

  DATA.rounds.forEach((r, i) => {
    const y = M.t + i * rowH + rowH / 2 - barH / 2;
    const cy = y + barH / 2;
    const uVal = r.usman.sig[0];
    const cVal = r.covington.sig[0];
    const uAttempt = r.usman.sig[1];
    const cAttempt = r.covington.sig[1];
    const uW = uVal / maxVal * plotW;
    const cW = cVal / maxVal * plotW;

    // Round label
    el('text', { x:20, y:cy + 4, 'text-anchor':'start', 'font-size':11, 'letter-spacing':'.15em', fill:'#7A8394' }, svg).textContent = 'R' + r.n;

    // Red bar (left, growing toward center FROM center LEFT)
    const uBar = el('rect', {
      x: CX - uW, y: y, width: uW, height: barH,
      fill: 'url(#gradRed)', stroke:'#FF2D3F', 'stroke-width':0.5
    }, svg);
    uBar.style.cursor = 'pointer';
    uBar.addEventListener('mousemove', e => {
      showTip(e.pageX, e.pageY, `<strong>USMAN · R${r.n}</strong><br>Landed: ${uVal} / ${uAttempt}<br>Accuracy: ${(uVal/uAttempt*100).toFixed(0)}%<br>Head ${r.usman.head[0]} · Body ${r.usman.body[0]} · Leg ${r.usman.leg[0]}`);
    });
    uBar.addEventListener('mouseleave', hideTip);

    // Blue bar (right)
    const cBar = el('rect', {
      x: CX, y: y, width: cW, height: barH,
      fill: 'url(#gradBlue)', stroke:'#2DB4FF', 'stroke-width':0.5
    }, svg);
    cBar.style.cursor = 'pointer';
    cBar.addEventListener('mousemove', e => {
      showTip(e.pageX, e.pageY, `<strong>COVINGTON · R${r.n}</strong><br>Landed: ${cVal} / ${cAttempt}<br>Accuracy: ${(cVal/cAttempt*100).toFixed(0)}%<br>Head ${r.covington.head[0]} · Body ${r.covington.body[0]} · Leg ${r.covington.leg[0]}`);
    });
    cBar.addEventListener('mouseleave', hideTip);

    // Values
    el('text', { x:CX - uW - 8, y:cy + 4, 'text-anchor':'end', 'font-size':14, 'font-weight':700, fill:'#FF2D3F' }, svg).textContent = uVal;
    el('text', { x:CX + cW + 8, y:cy + 4, 'text-anchor':'start', 'font-size':14, 'font-weight':700, fill:'#2DB4FF' }, svg).textContent = cVal;

    // Round winner marker above
    const wLabel = { 'U':'USMAN', 'C':'COVINGTON', '÷':'SPLIT', 'TKO':'TKO · USMAN' }[r.winner] || r.winner;
    const wColor = { 'U':'#FF2D3F', 'C':'#2DB4FF', '÷':'#FFB020', 'TKO':'#FFFFFF' }[r.winner] || '#FFFFFF';
    el('text', {
      x:CX, y:y - 4, 'text-anchor':'middle', 'font-size':10,
      'letter-spacing':'.15em', fill:wColor, 'font-weight':600
    }, svg).textContent = wLabel;

    // Knockdown markers
    if (r.usman.kd > 0){
      for (let k = 0; k < r.usman.kd; k++){
        const star = el('g', { transform: `translate(${CX - uW - 22 - k*14}, ${cy + 4})` }, svg);
        el('path', { d:'M0,-6L1.8,-2L6,-2L2.5,1L4,6L0,3L-4,6L-2.5,1L-6,-2L-1.8,-2Z', fill:'#FFB020' }, star);
      }
    }

    // Differential annotation
    const diff = uVal - cVal;
    if (Math.abs(diff) >= 10){
      const sign = diff > 0 ? '+' : '−';
      el('text', {
        x: CX + Math.max(uW, cW) + 28, y: cy + 4,
        'text-anchor':'start', 'font-size':10,
        fill: diff > 0 ? '#FF5965' : '#5EC2FF', 'letter-spacing':'.12em'
      }, svg).textContent = `${sign}${Math.abs(diff)} diff`;
    }
  });

  // Gradient defs
  const defs = el('defs', {}, svg);
  const gR = el('linearGradient', { id:'gradRed', x1:'1', y1:'0', x2:'0', y2:'0' }, defs);
  el('stop', { offset:'0%', 'stop-color':'#FF2D3F', 'stop-opacity':'1' }, gR);
  el('stop', { offset:'100%', 'stop-color':'#B41E2D', 'stop-opacity':'0.6' }, gR);
  const gB = el('linearGradient', { id:'gradBlue', x1:'0', y1:'0', x2:'1', y2:'0' }, defs);
  el('stop', { offset:'0%', 'stop-color':'#1E78C8', 'stop-opacity':'0.6' }, gB);
  el('stop', { offset:'100%', 'stop-color':'#2DB4FF', 'stop-opacity':'1' }, gB);
}

/* -----------------------------------------------------------
   ROUND CARDS & NARRATIVE
----------------------------------------------------------- */
function renderRoundCards(){
  const container = document.getElementById('roundCards');
  DATA.rounds.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'round-card' + (i === 2 ? ' active' : '');
    card.dataset.round = r.n;

    const winnerClass = { 'U':'red', 'C':'blue', '÷':'split', 'TKO':'tko' }[r.winner];
    const winnerLabel = { 'U':'USMAN', 'C':'COVINGTON', '÷':'SPLIT', 'TKO':'TKO · U' }[r.winner];

    card.innerHTML = `
      <div class="round-card__num">Round 0${r.n}</div>
      <div class="round-card__winner round-card__winner--${winnerClass}">${winnerLabel}</div>
      <div class="round-card__stats"><span class="red">${r.usman.sig[0]}</span> <span style="color:var(--muted-dim)">·</span> <span class="blue">${r.covington.sig[0]}</span></div>
      <div class="round-card__stats" style="margin-top:4px;color:var(--muted);font-size:10px">${r.usman.kd ? '★ '+r.usman.kd+' KD · ' : ''}${Math.round(r.usman.sig[0]/r.usman.sig[1]*100)}% / ${Math.round(r.covington.sig[0]/r.covington.sig[1]*100)}%</div>
    `;
    card.addEventListener('click', () => {
      document.querySelectorAll('.round-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      showNarrative(r);
    });
    container.appendChild(card);
  });
  showNarrative(DATA.rounds[2]);
}

function showNarrative(r){
  const n = document.getElementById('roundNarrative');
  const catColor = { 'red':'#FF5965', 'blue':'#5EC2FF', 'critical':'#FFB020', 'foul':'#8A5EF5', 'neutral':'#B0B8C9' };
  const events = r.events.map(e =>
    `<p><span class="ts">${e.t}</span><span style="color:${catColor[e.cat]||'#B0B8C9'}">${e.text}</span></p>`
  ).join('');
  n.innerHTML = `
    <h4>Round ${r.n} · Play-by-Play</h4>
    <p style="color:var(--fg);font-weight:500;margin-bottom:14px;font-family:var(--f-disp);font-size:14px;letter-spacing:.02em">${r.summary}</p>
    ${events}
  `;
}

/* -----------------------------------------------------------
   CHART 2: ACCURACY TRENDS
----------------------------------------------------------- */
function renderAccuracyChart(){
  const svg = document.getElementById('accuracyChart');
  const W = 1200, H = 400;
  const M = { t:40, r:50, b:60, l:60 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;

  const usmanAcc = DATA.rounds.map(r => r.usman.sig[0] / r.usman.sig[1] * 100);
  const covAcc = DATA.rounds.map(r => r.covington.sig[0] / r.covington.sig[1] * 100);

  // Y-axis (accuracy %)
  for (let v = 0; v <= 60; v += 20){
    const y = M.t + ph - (v / 60 * ph);
    el('line', { x1:M.l, y1:y, x2:W-M.r, y2:y, stroke:'#151B28', 'stroke-dasharray':'2 3' }, svg);
    el('text', { x:M.l - 10, y:y+3, 'text-anchor':'end', 'font-size':9, fill:'#7A8394' }, svg).textContent = v + '%';
  }

  // X-axis (rounds)
  DATA.rounds.forEach((r, i) => {
    const x = M.l + (i / 4) * pw;
    el('line', { x1:x, y1:M.t, x2:x, y2:H-M.b, stroke:'#151B28', 'stroke-dasharray':'2 3' }, svg);
    el('text', { x:x, y:H-M.b+20, 'text-anchor':'middle', 'font-size':10, fill:'#B0B8C9' }, svg).textContent = 'R'+r.n;
  });

  // Annotation: R3 collapse
  const r3x = M.l + (2/4) * pw;
  el('rect', { x:r3x-60, y:M.t, width:120, height:ph, fill:'#FFB020', opacity:0.05 }, svg);
  el('line', { x1:r3x, y1:M.t+10, x2:r3x, y2:H-M.b, stroke:'#FFB020', 'stroke-width':1, 'stroke-dasharray':'4 3' }, svg);
  el('text', { x:r3x, y:M.t-18, 'text-anchor':'middle', 'font-size':9, fill:'#FFB020', 'letter-spacing':'.1em' }, svg).textContent = 'JAW BREAK ZONE';

  function drawLine(data, otherData, color){
    let pathD = '';
    data.forEach((v, i) => {
      const x = M.l + (i/4) * pw;
      const y = M.t + ph - (v / 60 * ph);
      pathD += (i === 0 ? 'M' : 'L') + x + ',' + y;
    });
    // Line
    el('path', { d:pathD, stroke:color, 'stroke-width':2.5, fill:'none', 'stroke-linejoin':'round' }, svg);
    // Points + collision-aware labels (push lower-valued series' label below its point when close)
    data.forEach((v, i) => {
      const x = M.l + (i/4) * pw;
      const y = M.t + ph - (v / 60 * ph);
      const otherY = M.t + ph - (otherData[i] / 60 * ph);
      el('circle', { cx:x, cy:y, r:6, fill:'#04050A', stroke:color, 'stroke-width':2 }, svg);
      el('circle', { cx:x, cy:y, r:2.5, fill:color }, svg);
      const labelY = (Math.abs(y - otherY) < 22 && y > otherY) ? y + 20 : y - 14;
      el('text', { x:x, y:labelY, 'text-anchor':'middle', 'font-size':11, 'font-weight':700, fill:color }, svg).textContent = v.toFixed(0) + '%';
    });
  }
  drawLine(covAcc, usmanAcc, '#2DB4FF');
  drawLine(usmanAcc, covAcc, '#FF2D3F');

  // Y-axis title
  el('text', { x:M.l-36, y:M.t+ph/2, 'text-anchor':'middle', 'font-size':10, fill:'#7A8394', 'letter-spacing':'.15em', transform:`rotate(-90 ${M.l-36} ${M.t+ph/2})` }, svg).textContent = 'ACCURACY %';
}

/* -----------------------------------------------------------
   CHART 3: POSITION BREAKDOWN
----------------------------------------------------------- */
function renderPositionChart(){
  const svg = document.getElementById('positionChart');
  const W = 1200, H = 340;
  const M = { t:40, r:60, b:60, l:60 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const groupH = 16;
  const gap = 4;
  const maxTotal = 45;

  DATA.rounds.forEach((r, i) => {
    const yBase = M.t + (i / 4) * ph;

    // R label
    el('text', { x:M.l-14, y:yBase+24, 'text-anchor':'end', 'font-size':11, fill:'#B0B8C9', 'letter-spacing':'.1em' }, svg).textContent = 'R'+r.n;

    // Usman group (upper)
    const usmanGroup = [
      { val: r.usman.dist[0], color:'#FF2D3F', name:'distance' },
      { val: r.usman.clinch[0], color:'#FFB020', name:'clinch' },
      { val: r.usman.ground[0], color:'#7CFFC8', name:'ground' }
    ];
    let cumU = 0;
    usmanGroup.forEach(g => {
      if (g.val <= 0) return;
      const w = g.val / maxTotal * pw;
      const rect = el('rect', { x:M.l + cumU, y:yBase, width:w, height:groupH, fill:g.color, opacity:.85 }, svg);
      rect.style.cursor = 'pointer';
      rect.addEventListener('mousemove', e => showTip(e.pageX, e.pageY, `<strong>USMAN R${r.n} · ${g.name.toUpperCase()}</strong><br>${g.val} landed`));
      rect.addEventListener('mouseleave', hideTip);
      cumU += w;
    });
    // Usman total
    el('text', { x:M.l + cumU + 8, y:yBase+12, 'text-anchor':'start', 'font-size':10, fill:'#FF2D3F', 'font-weight':600 }, svg).textContent = r.usman.sig[0];

    // Covington group (lower)
    const covGroup = [
      { val: r.covington.dist[0], color:'#2DB4FF', name:'distance' },
      { val: r.covington.clinch[0], color:'#FFB020', name:'clinch' },
      { val: r.covington.ground[0], color:'#7CFFC8', name:'ground' }
    ];
    let cumC = 0;
    const yC = yBase + groupH + gap;
    covGroup.forEach(g => {
      if (g.val <= 0) return;
      const w = g.val / maxTotal * pw;
      const rect = el('rect', { x:M.l + cumC, y:yC, width:w, height:groupH, fill:g.color, opacity:.85 }, svg);
      rect.style.cursor = 'pointer';
      rect.addEventListener('mousemove', e => showTip(e.pageX, e.pageY, `<strong>COVINGTON R${r.n} · ${g.name.toUpperCase()}</strong><br>${g.val} landed`));
      rect.addEventListener('mouseleave', hideTip);
      cumC += w;
    });
    el('text', { x:M.l + cumC + 8, y:yC+12, 'text-anchor':'start', 'font-size':10, fill:'#2DB4FF', 'font-weight':600 }, svg).textContent = r.covington.sig[0];
  });

  // Scale
  for (let v = 10; v <= maxTotal; v += 10){
    const x = M.l + v/maxTotal * pw;
    el('line', { x1:x, y1:M.t-10, x2:x, y2:H-M.b+4, stroke:'#151B28', 'stroke-dasharray':'2 3' }, svg);
    el('text', { x:x, y:H-M.b+20, 'text-anchor':'middle', 'font-size':9, fill:'#464E5C' }, svg).textContent = v;
  }

  // R5 ground annotation
  const y5 = M.t + (4/4) * ph;
  el('text', { x:W-M.r+4, y:y5+12, 'text-anchor':'start', 'font-size':9, fill:'#7CFFC8', 'letter-spacing':'.08em' }, svg).textContent = '← 14 GND';
}

/* -----------------------------------------------------------
   CHART 4: TIMELINE
----------------------------------------------------------- */
function renderTimelineChart(){
  const svg = document.getElementById('timelineChart');
  const W = 1600, H = 380;
  const M = { t:120, r:60, b:100, l:80 };
  const pw = W - M.l - M.r;
  const mainY = H / 2;
  const totalSec = 24 * 60 + 10; // 24:10

  const events = [
    { sec: 10, round:1, label:'Usman slip', text:'Loses footing on kick exchange · recovers', color:'#7A8394', cat:'neutral' },
    { sec: 150, round:1, label:'Big Left (Cov)', text:'Covington lands huge left · briefly buzzes Usman', color:'#2DB4FF', cat:'blue' },
    { sec: 210, round:1, label:'Body work opens', text:'Usman begins targeting the body', color:'#FF2D3F', cat:'red' },
    { sec: 450, round:2, label:'Cup shot', text:'Covington body kick lands low · action halted', color:'#8A5EF5', cat:'foul' },
    { sec: 855, round:3, label:'Eye Poke', text:'Covington\'s fingers in Usman\'s eye · physician check', color:'#8A5EF5', cat:'foul' },
    { sec: 890, round:3, label:'💥 Jaw Break', text:'Massive right cross · likely mandible fracture point', color:'#FFB020', cat:'critical', major:true },
    { sec: 900, round:3, label:'🎙 "I broke my jaw"', text:'Corner audio captured between R3 & R4', color:'#FFB020', cat:'critical', major:true },
    { sec: 1080, round:4, label:'Cov combination', text:'Covington lands 3-punch combination · Usman hurt', color:'#2DB4FF', cat:'blue' },
    { sec: 1155, round:4, label:'Superman / Knee', text:'Cov Superman punch → Usman knee · fighters laugh', color:'#7A8394', cat:'neutral' },
    { sec: 1410, round:5, label:'💥 KD #1', text:'First knockdown · right hand after 2-3 fake', color:'#FF2D3F', cat:'critical', major:true },
    { sec: 1425, round:5, label:'💥 KD #2', text:'Second knockdown · Usman right hand', color:'#FF2D3F', cat:'critical', major:true },
    { sec: 1450, round:5, label:'TKO · REF STOPPAGE', text:'14 of 15 hammerfists in 11s · Goddard stops it', color:'#FFFFFF', cat:'critical', major:true }
  ];

  // Round backgrounds
  const roundColors = ['rgba(45,180,255,.06)', 'rgba(45,180,255,.06)', 'rgba(255,45,63,.06)', 'rgba(255,176,32,.06)', 'rgba(255,45,63,.1)'];
  [0,1,2,3,4].forEach(i => {
    const x1 = M.l + (i*300/totalSec) * pw;
    const x2 = M.l + ((i+1)*300/totalSec) * pw;
    const actualEnd = i === 4 ? M.l + (totalSec/totalSec)*pw : x2;
    el('rect', {
      x:x1, y:M.t-30, width:actualEnd-x1, height:H-M.t-M.b+30,
      fill:roundColors[i]
    }, svg);
    el('text', { x:(x1+actualEnd)/2, y:M.t-10, 'text-anchor':'middle', 'font-size':11, fill:'#7A8394', 'letter-spacing':'.15em' }, svg).textContent = 'ROUND 0'+(i+1);
  });

  // Main timeline spine
  el('line', {
    x1:M.l, y1:mainY, x2:W-M.r, y2:mainY,
    stroke:'url(#tlGrad)', 'stroke-width':3
  }, svg);

  // Time grid every minute
  for (let m = 0; m <= 24; m++){
    const x = M.l + (m*60/totalSec) * pw;
    el('line', { x1:x, y1:mainY-5, x2:x, y2:mainY+5, stroke:'#464E5C', 'stroke-width': m%5===0 ? 1.5 : 0.5 }, svg);
    if (m % 5 === 0){
      el('text', { x:x, y:mainY+22, 'text-anchor':'middle', 'font-size':10, fill:'#7A8394', 'font-weight':500 }, svg).textContent = m + ':00';
    }
  }
  // End marker
  const xEnd = M.l + pw;
  el('circle', { cx:xEnd, cy:mainY, r:6, fill:'#FFFFFF', stroke:'#FF2D3F', 'stroke-width':2 }, svg);
  el('text', { x:xEnd, y:mainY+22, 'text-anchor':'middle', 'font-size':10, fill:'#FFFFFF', 'font-weight':700 }, svg).textContent = '24:10';

  // Gradient
  const defs = el('defs', {}, svg);
  const g = el('linearGradient', { id:'tlGrad', x1:'0', y1:'0', x2:'1', y2:'0' }, defs);
  el('stop', { offset:'0%', 'stop-color':'#2DB4FF' }, g);
  el('stop', { offset:'50%', 'stop-color':'#8A5EF5' }, g);
  el('stop', { offset:'100%', 'stop-color':'#FF2D3F' }, g);

  // Events
  events.forEach((ev, idx) => {
    const x = M.l + (ev.sec / totalSec) * pw;
    const above = idx % 2 === 0;
    const labelY = above ? mainY - 46 - (ev.major ? 12 : 0) : mainY + 46 + (ev.major ? 12 : 0);
    const lineY2 = above ? mainY - 8 : mainY + 8;

    // Connector
    el('line', {
      x1:x, y1:labelY + (above ? 18 : -2), x2:x, y2:lineY2,
      stroke: ev.color, 'stroke-width':1, opacity: ev.major ? 1 : .6
    }, svg);

    // Node
    const nodeR = ev.major ? 7 : 4;
    const node = el('circle', {
      cx:x, cy:mainY, r:nodeR,
      fill:'#04050A', stroke:ev.color, 'stroke-width':2,
      'data-sec': ev.sec
    }, svg);
    node.style.cursor = 'pointer';
    if (ev.major){
      el('circle', { cx:x, cy:mainY, r:nodeR+4, fill:'none', stroke:ev.color, 'stroke-width':1, opacity:.4 }, svg);
    }

    // Inner dot
    el('circle', { cx:x, cy:mainY, r:ev.major ? 3 : 1.5, fill:ev.color }, svg);

    // Label
    const textEl = el('text', {
      x:x, y:labelY, 'text-anchor':'middle',
      'font-size': ev.major ? 11 : 9,
      fill:ev.color, 'font-weight': ev.major ? 700 : 500,
      'letter-spacing':'.05em'
    }, svg);
    textEl.textContent = ev.label;

    // Mouse tip
    node.addEventListener('mousemove', e =>
      showTip(e.pageX, e.pageY, `<strong>R${ev.round} · ${Math.floor(ev.sec/60)}:${String(ev.sec%60).padStart(2,'0')}</strong><br>${ev.text}`)
    );
    node.addEventListener('mouseleave', hideTip);
  });

  // Axis title
  el('text', { x:M.l, y:H-M.b+50, 'font-size':10, fill:'#7A8394', 'letter-spacing':'.15em' }, svg).textContent = 'ELAPSED TIME · MIN:SEC';
}

/* -----------------------------------------------------------
   CHART 5: GAUGE (BIOMECHANICS)
----------------------------------------------------------- */
function renderGaugeChart(){
  const svg = document.getElementById('gaugeChart');
  const W = 600, H = 440;
  const cx = W/2, cy = H * 0.72;
  const r = 180;
  const startA = Math.PI * 1.1;
  const endA = Math.PI * 1.9;  // goes from ~200° to ~340°

  // Gauge arc background
  function arcPath(rr, a1, a2){
    const x1 = cx + Math.cos(a1)*rr;
    const y1 = cy + Math.sin(a1)*rr;
    const x2 = cx + Math.cos(a2)*rr;
    const y2 = cy + Math.sin(a2)*rr;
    const large = Math.abs(a2-a1) > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${rr} ${rr} 0 ${large} 1 ${x2} ${y2}`;
  }

  // Scale: 0 → 4000 N
  const MAX = 4000;
  const angleFor = v => startA + (v/MAX) * (endA - startA);

  // Ticks
  for (let v = 0; v <= MAX; v += 500){
    const a = angleFor(v);
    const x1 = cx + Math.cos(a) * (r - 12);
    const y1 = cy + Math.sin(a) * (r - 12);
    const x2 = cx + Math.cos(a) * (r + 8);
    const y2 = cy + Math.sin(a) * (r + 8);
    const major = v % 1000 === 0;
    el('line', { x1, y1, x2, y2, stroke:major?'#B0B8C9':'#7A8394', 'stroke-width': major ? 1.5 : 1, opacity: major ? 1 : 0.5 }, svg);
    if (major){
      const lx = cx + Math.cos(a) * (r + 26);
      const ly = cy + Math.sin(a) * (r + 26);
      el('text', { x:lx, y:ly+3, 'text-anchor':'middle', 'font-size':10, fill:'#B0B8C9' }, svg).textContent = v;
    }
  }

  // Zones
  // Green zone (safe) 0-1300
  el('path', { d:arcPath(r, startA, angleFor(1300)), stroke:'#7CFFC8', 'stroke-width':12, fill:'none', opacity:.3 }, svg);
  // Amber zone 1300-2151
  el('path', { d:arcPath(r, angleFor(1300), angleFor(2151)), stroke:'#FFB020', 'stroke-width':12, fill:'none', opacity:.5 }, svg);
  // Red zone (above threshold) 2151-4000
  el('path', { d:arcPath(r, angleFor(2151), endA), stroke:'#FF2D3F', 'stroke-width':12, fill:'none', opacity:.6 }, svg);

  // Threshold marker
  const thA = angleFor(2151);
  const thX1 = cx + Math.cos(thA) * (r - 20);
  const thY1 = cy + Math.sin(thA) * (r - 20);
  const thX2 = cx + Math.cos(thA) * (r + 32);
  const thY2 = cy + Math.sin(thA) * (r + 32);
  el('line', { x1:thX1, y1:thY1, x2:thX2, y2:thY2, stroke:'#FFFFFF', 'stroke-width':2 }, svg);
  el('text', { x:thX2 + 4, y:thY2 - 6, 'text-anchor':'start', 'font-size':10, fill:'#FFFFFF', 'font-weight':700, 'letter-spacing':'.12em' }, svg).textContent = 'FRACTURE';
  el('text', { x:thX2 + 4, y:thY2 + 6, 'text-anchor':'start', 'font-size':10, fill:'#FFFFFF' }, svg).textContent = '2,151 N';

  // Needles for different strikes (midpoints)
  const strikes = [
    { val: 1100, name: 'JAB', color: '#5EC2FF' },
    { val: 1800, name: 'CROSS', color: '#FF2D3F' },
    { val: 2400, name: 'HOOK', color: '#FF5965' }
  ];
  strikes.forEach((s, i) => {
    const a = angleFor(s.val);
    const nx = cx + Math.cos(a) * (r - 30);
    const ny = cy + Math.sin(a) * (r - 30);
    el('line', { x1:cx, y1:cy, x2:nx, y2:ny, stroke:s.color, 'stroke-width':2.5, 'stroke-linecap':'round' }, svg);
    el('circle', { cx:nx, cy:ny, r:5, fill:s.color }, svg);
    el('circle', { cx:nx, cy:ny, r:2, fill:'#04050A' }, svg);
  });
  // Hub
  el('circle', { cx:cx, cy:cy, r:10, fill:'#04050A', stroke:'#7A8394', 'stroke-width':2 }, svg);
  el('circle', { cx:cx, cy:cy, r:4, fill:'#2DDCFF' }, svg);

  // Labels below gauge
  const labelY = H - 40;
  strikes.forEach((s, i) => {
    const lx = 80 + i * 180;
    el('rect', { x:lx-44, y:labelY-24, width:88, height:46, fill:'transparent', stroke:s.color, 'stroke-width':0.5, opacity:.5 }, svg);
    el('text', { x:lx, y:labelY-6, 'text-anchor':'middle', 'font-size':10, 'letter-spacing':'.15em', fill:s.color, 'font-weight':700 }, svg).textContent = s.name;
    el('text', { x:lx, y:labelY+12, 'text-anchor':'middle', 'font-size':11, fill:'#E8ECF5', 'font-weight':600 }, svg).textContent = '~' + s.val + ' N';
  });

  // Title
  el('text', { x:W/2, y:36, 'text-anchor':'middle', 'font-size':13, fill:'#7A8394', 'letter-spacing':'.2em' }, svg).textContent = 'ESTIMATED PUNCH FORCE';
  el('text', { x:W/2, y:56, 'text-anchor':'middle', 'font-size':10, fill:'#464E5C', 'letter-spacing':'.15em' }, svg).textContent = 'WELTERWEIGHT · SCALED FROM LITERATURE';
}

/* -----------------------------------------------------------
   CHART 6: PACE / CARDIO
----------------------------------------------------------- */
function renderPaceChart(){
  const svg = document.getElementById('paceChart');
  const W = 1200, H = 400;
  const M = { t:40, r:60, b:60, l:60 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;

  const usmanPPM = DATA.rounds.map((r, i) => r.usman.sig[1] / DATA.durations[i]);
  const covPPM = DATA.rounds.map((r, i) => r.covington.sig[1] / DATA.durations[i]);

  const maxPPM = 25;

  // Y-axis
  for (let v = 0; v <= maxPPM; v += 5){
    const y = M.t + ph - (v / maxPPM * ph);
    el('line', { x1:M.l, y1:y, x2:W-M.r, y2:y, stroke:'#151B28', 'stroke-dasharray':'2 3' }, svg);
    el('text', { x:M.l - 10, y:y+3, 'text-anchor':'end', 'font-size':9, fill:'#7A8394' }, svg).textContent = v;
  }
  el('text', { x:M.l-36, y:M.t+ph/2, 'text-anchor':'middle', 'font-size':10, fill:'#7A8394', 'letter-spacing':'.15em', transform:`rotate(-90 ${M.l-36} ${M.t+ph/2})` }, svg).textContent = 'STRIKES / MIN';

  // X-axis
  DATA.rounds.forEach((r, i) => {
    const x = M.l + (i / 4) * pw;
    el('line', { x1:x, y1:M.t, x2:x, y2:H-M.b, stroke:'#151B28', 'stroke-dasharray':'2 3' }, svg);
    el('text', { x:x, y:H-M.b+20, 'text-anchor':'middle', 'font-size':10, fill:'#B0B8C9' }, svg).textContent = 'R'+r.n;
  });

  // R3 collapse band
  const r3x = M.l + (2/4) * pw;
  el('rect', { x:r3x-36, y:M.t, width:72, height:ph, fill:'#FFB020', opacity:0.05 }, svg);
  el('line', { x1:r3x, y1:M.t+10, x2:r3x, y2:H-M.b, stroke:'#FFB020', 'stroke-width':1, 'stroke-dasharray':'4 3' }, svg);
  el('text', { x:r3x, y:M.t-2, 'text-anchor':'middle', 'font-size':9, fill:'#FFB020', 'letter-spacing':'.1em' }, svg).textContent = 'FRACTURE';

  // Fill area under Covington to highlight fade
  let covPathD = '';
  covPPM.forEach((v, i) => {
    const x = M.l + (i/4) * pw;
    const y = M.t + ph - (v / maxPPM * ph);
    covPathD += (i === 0 ? 'M' : 'L') + x + ',' + y;
  });
  covPathD += ` L ${M.l + pw},${M.t+ph} L ${M.l},${M.t+ph} Z`;
  el('path', { d:covPathD, fill:'#2DB4FF', opacity:0.08 }, svg);

  function drawLine(data, otherData, color, dash){
    let pathD = '';
    data.forEach((v, i) => {
      const x = M.l + (i/4) * pw;
      const y = M.t + ph - (v / maxPPM * ph);
      pathD += (i === 0 ? 'M' : 'L') + x + ',' + y;
    });
    el('path', { d:pathD, stroke:color, 'stroke-width':2.5, fill:'none', 'stroke-linejoin':'round', 'stroke-dasharray': dash||'' }, svg);
    data.forEach((v, i) => {
      const x = M.l + (i/4) * pw;
      const y = M.t + ph - (v / maxPPM * ph);
      const otherY = M.t + ph - (otherData[i] / maxPPM * ph);
      el('circle', { cx:x, cy:y, r:5, fill:'#04050A', stroke:color, 'stroke-width':2 }, svg);
      const labelY = (Math.abs(y - otherY) < 20 && y > otherY) ? y + 18 : y - 12;
      el('text', { x:x, y:labelY, 'text-anchor':'middle', 'font-size':10, 'font-weight':700, fill:color }, svg).textContent = v.toFixed(1);
    });
  }

  drawLine(covPPM, usmanPPM, '#2DB4FF');
  drawLine(usmanPPM, covPPM, '#FF2D3F');

  // Acts annotation
  const acts = [
    { x1:0, x2:1, label:'ACT I · COV DOMINANCE', color:'#2DB4FF' },
    { x1:2, x2:2.2, label:'ACT II · COLLAPSE', color:'#FFB020' },
    { x1:3, x2:4, label:'ACT III · FINISH', color:'#FF2D3F' }
  ];
  acts.forEach(a => {
    const x1 = M.l + (a.x1/4) * pw;
    const x2 = M.l + (a.x2/4) * pw;
    el('line', { x1:x1, y1:H-M.b+35, x2:x2, y2:H-M.b+35, stroke:a.color, 'stroke-width':1 }, svg);
    el('text', { x:(x1+x2)/2, y:H-M.b+48, 'text-anchor':'middle', 'font-size':9, fill:a.color, 'letter-spacing':'.1em' }, svg).textContent = a.label;
  });
}

/* -----------------------------------------------------------
   DOT NAV SCROLL SPY
----------------------------------------------------------- */
function setupNav(){
  const dots = document.querySelectorAll('.dot-nav a');
  const sections = Array.from(dots).map(d => document.querySelector(d.getAttribute('href')));

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting){
        const idx = sections.indexOf(e.target);
        if (idx >= 0){
          dots.forEach(d => d.classList.remove('active'));
          dots[idx].classList.add('active');
        }
      }
    });
  }, { threshold: 0.4 });
  sections.forEach(s => s && obs.observe(s));
}

/* -----------------------------------------------------------
   TC TIMECODE — syncs top-bar TC to the fight-time of whatever
   section the reader is currently looking at.  Each <section>
   declares data-tc="..."; the scroll handler picks the section
   whose top has just crossed the sticky-header horizon and
   swaps the value with a brief cyan flash.
----------------------------------------------------------- */
// Exposed so non-section views (Picks subnav) can force a TC value
let _tcForceValue = null;     // when set, resolveActive uses this verbatim
let _tcForceSet = null;       // function(value) — null until startTicker runs
function startTicker(){
  const tc = document.getElementById('tc');
  if (!tc) return;
  const sections = Array.from(document.querySelectorAll('section[data-tc]'));
  if (!sections.length) return;

  function setTc(value){
    if (!value || tc.textContent === value) return;
    tc.textContent = value;
    tc.classList.add('is-updating');
    clearTimeout(setTc._t);
    setTc._t = setTimeout(() => tc.classList.remove('is-updating'), 520);
  }

  const tabTc = { events:'ALL EVENTS', fighters:'DIRECTORY', stats:'STAT LEADERS', picks:'YOUR PICKS' };

  // Picks subnav can force an overriding label (see activatePicksView)
  _tcForceSet = (value) => {
    _tcForceValue = value;
    resolveActive();
  };

  function resolveActive(){
    // Force override takes precedence (Picks subnav labels)
    if (_tcForceValue) {
      setTc(_tcForceValue);
      return;
    }
    // When a non-dashboard tab is active, use its fixed TC value
    const activeTab = document.querySelector('.primary-tab.active');
    if (activeTab && tabTc[activeTab.dataset.tab]){
      setTc(tabTc[activeTab.dataset.tab]);
      return;
    }
    // Dashboard: section whose top third of viewport owns the read-horizon wins
    const visible = sections.filter(s => s.offsetHeight > 0);
    if (!visible.length) return;
    const viewportH = window.innerHeight;
    const horizon = Math.max(180, viewportH * 0.33);
    let best = null;
    for (const section of visible){
      const rect = section.getBoundingClientRect();
      if (rect.top <= horizon && rect.bottom > horizon){ best = section; break; }
    }
    if (!best){
      let bestArea = 0;
      for (const section of visible){
        const rect = section.getBoundingClientRect();
        const top = Math.max(0, rect.top);
        const bottom = Math.min(viewportH, rect.bottom);
        const area = bottom - top;
        if (area > bestArea){ best = section; bestArea = area; }
      }
    }
    if (!best) best = visible[0];
    setTc(best.dataset.tc);
  }

  resolveActive();

  let pending = false;
  window.addEventListener('scroll', () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; resolveActive(); });
  }, { passive:true });
  window.addEventListener('resize', resolveActive);
  document.querySelectorAll('.primary-tab').forEach(t => {
    t.addEventListener('click', () => setTimeout(resolveActive, 30));
  });
}

/* -----------------------------------------------------------
   INIT
----------------------------------------------------------- */
renderRoundsChart();
renderRoundCards();
renderAccuracyChart();
renderPositionChart();
renderTimelineChart();
renderGaugeChart();
/* -----------------------------------------------------------
   OCTAGON PLAYBACK · ANIMATED TACTICAL LOOP
----------------------------------------------------------- */
// Center of octagon in SVG coords
const OCT_CX = 450, OCT_CY = 310;

// Helper: build a pressure cone polygon points string
// Origin is the fighter position, cone points toward target angle with given width
function conePoints(ox, oy, tx, ty, widthRad, length){
  const baseAngle = Math.atan2(ty - oy, tx - ox);
  const a1 = baseAngle - widthRad / 2;
  const a2 = baseAngle + widthRad / 2;
  const segs = 18;
  let pts = [`${ox},${oy}`];
  for (let i = 0; i <= segs; i++){
    const t = i / segs;
    const a = a1 + (a2 - a1) * t;
    pts.push(`${ox + Math.cos(a) * length},${oy + Math.sin(a) * length}`);
  }
  return pts.join(' ');
}

// Phase definitions · each ~3.5-5.5s
const OCT_PHASES = [
  {
    id: 'R1',
    duration: 3800,
    label: 'Round 01 · Neutral Opening · Center Control',
    tc: 'ROUND 01 · 0:00',
    sub: 'NEUTRAL OPENING · CENTER CONTROL',
    status: 'NEUTRAL',
    red: { x: 390, y: 310, faceRight: true },
    blue: { x: 510, y: 310, faceRight: false },
    closedLanes: [],
    cone: null,
    heat: [],
    events: [],
    groundStrikes: false,
    telemetry: {
      distance: '2.80 m',
      lanes: '8 / 8',
      lanesClass: 'hud-green',
      pressure: '0.00',
      control: 'EVEN',
      strikes: '— / —'
    }
  },
  {
    id: 'R2',
    duration: 4200,
    label: 'Round 02 · Covington Pressure · Volume Peak',
    tc: 'ROUND 02 · 5:30',
    sub: 'COVINGTON FORWARD · USMAN CIRCLES',
    status: 'PRESSURE · BLUE',
    red: { x: 330, y: 332, faceRight: true },
    blue: { x: 430, y: 318, faceRight: false },
    closedLanes: [3, 4],
    cone: { who: 'blue', ox: 430, oy: 318, tx: 330, ty: 332, widthRad: Math.PI * 0.42, length: 220 },
    heat: ['heat-w'],
    events: [],
    groundStrikes: false,
    telemetry: {
      distance: '2.12 m',
      lanes: '6 / 8',
      lanesClass: 'hud-amber',
      pressure: '0.55',
      control: 'COV +',
      strikes: '40 / 41'
    }
  },
  {
    id: 'R3',
    duration: 5200,
    label: 'Round 03 · Inflection · Jaw Break Vector',
    tc: 'ROUND 03 · 14:50',
    sub: 'USMAN TAKES CENTER · RIGHT CROSS LANDS',
    status: 'PRESSURE · RED',
    red: { x: 450, y: 310, faceRight: true },
    blue: { x: 570, y: 330, faceRight: false },
    closedLanes: [0, 1, 6, 7],
    cone: { who: 'red', ox: 450, oy: 310, tx: 570, ty: 330, widthRad: Math.PI * 0.36, length: 230 },
    heat: ['heat-e', 'heat-se'],
    events: ['evtJaw'],
    groundStrikes: false,
    telemetry: {
      distance: '1.95 m',
      lanes: '4 / 8',
      lanesClass: 'hud-amber',
      pressure: '0.72',
      control: 'USMAN +',
      strikes: '29 / 8'
    }
  },
  {
    id: 'R4',
    duration: 3800,
    label: 'Round 04 · Firefight · Broken-Jaw Rally',
    tc: 'ROUND 04 · 18:00',
    sub: 'CENTER EXCHANGE · EVEN OUTPUT',
    status: 'FIREFIGHT',
    red: { x: 440, y: 302, faceRight: true },
    blue: { x: 492, y: 318, faceRight: false },
    closedLanes: [0, 1, 6],
    cone: null,
    heat: [],
    events: [],
    groundStrikes: false,
    telemetry: {
      distance: '1.05 m',
      lanes: '5 / 8',
      lanesClass: 'hud-amber',
      pressure: '0.68',
      control: 'SPLIT',
      strikes: '35 / 36'
    }
  },
  {
    id: 'R5',
    duration: 5600,
    label: 'Round 05 · 4:10 · TKO · 2 KDs · Hammerfists',
    tc: 'ROUND 05 · 4:10',
    sub: 'EAST CAGE · GROUND & POUND · FINISH',
    status: 'TKO · USMAN',
    red: { x: 600, y: 340, faceRight: true },
    blue: { x: 620, y: 390, faceRight: false },
    closedLanes: [0, 1, 2, 3, 6, 7],
    cone: { who: 'red', ox: 600, oy: 340, tx: 620, ty: 390, widthRad: Math.PI * 0.5, length: 80 },
    heat: ['heat-e', 'heat-se'],
    events: ['evtKd1', 'evtKd2', 'evtTko'],
    eventStagger: [200, 1600, 3200],
    groundStrikes: true,
    telemetry: {
      distance: '0.40 m',
      lanes: '2 / 8',
      lanesClass: 'hud-muted',
      pressure: '0.94',
      control: 'USMAN DOM',
      strikes: '37 / 19'
    }
  }
];

const OCT_LANE_IDS = [0, 1, 2, 3, 4, 5, 6, 7];

function applyOctPhase(idx, isUserClick = false){
  const p = OCT_PHASES[idx];
  if (!p) return;

  // Fighter positions (with facing)
  const fRed = document.getElementById('fRed');
  const fBlue = document.getElementById('fBlue');
  const fRedFace = document.getElementById('fRedFace');
  const fBlueFace = document.getElementById('fBlueFace');
  if (fRed) fRed.setAttribute('transform', `translate(${p.red.x},${p.red.y})`);
  if (fBlue) fBlue.setAttribute('transform', `translate(${p.blue.x},${p.blue.y})`);
  if (fRedFace) fRedFace.setAttribute('points', p.red.faceRight ? '20,0 -4,-7 -4,7' : '-20,0 4,-7 4,7');
  if (fBlueFace) fBlueFace.setAttribute('points', p.blue.faceRight ? '20,0 -4,-7 -4,7' : '-20,0 4,-7 4,7');

  // Lane states
  OCT_LANE_IDS.forEach(i => {
    const line = document.querySelector(`.lane-${i}`);
    const head = document.querySelector(`.lane-head-${i}`);
    const closed = p.closedLanes.includes(i);
    if (line) line.classList.toggle('closed', closed);
    if (head){
      head.setAttribute('fill', closed ? '#FF2D3F' : '#5EC2FF');
      head.setAttribute('opacity', closed ? '.7' : '.55');
    }
  });

  // Pressure cones
  const coneRed = document.getElementById('coneRed');
  const coneBlue = document.getElementById('coneBlue');
  coneRed.classList.remove('on');
  coneBlue.classList.remove('on');
  if (p.cone){
    const pts = conePoints(p.cone.ox, p.cone.oy, p.cone.tx, p.cone.ty, p.cone.widthRad, p.cone.length);
    if (p.cone.who === 'red'){
      coneRed.setAttribute('points', pts);
      coneRed.classList.add('on');
    } else {
      coneBlue.setAttribute('points', pts);
      coneBlue.classList.add('on');
    }
  }

  // Heatmap
  ['heat-e', 'heat-se', 'heat-sw', 'heat-w'].forEach(cls => {
    const elH = document.querySelector('.' + cls);
    if (elH) elH.classList.toggle('on', p.heat.includes(cls));
  });

  // Ground strikes
  const gnd = document.getElementById('gndStrikes');
  if (gnd) gnd.classList.toggle('on', p.groundStrikes);

  // Event flashes (space them within the phase)
  ['evtJaw', 'evtKd1', 'evtKd2', 'evtTko'].forEach(id => {
    const evEl = document.getElementById(id);
    if (evEl) evEl.classList.remove('flash');
  });
  if (p.events && p.events.length){
    p.events.forEach((evId, i) => {
      const delay = (p.eventStagger && p.eventStagger[i]) || (600 + i * 1200);
      setTimeout(() => {
        const evEl = document.getElementById(evId);
        if (evEl){
          // Retrigger animation
          evEl.classList.remove('flash');
          void evEl.offsetWidth;
          evEl.classList.add('flash');
        }
      }, delay);
    });
  }

  // HUD updates
  const setText = (id, txt, cls) => {
    const e = document.getElementById(id);
    if (e){
      e.textContent = txt;
      if (cls){
        e.classList.remove('hud-text','hud-muted','hud-cyan','hud-amber','hud-green');
        e.classList.add(cls);
      }
    }
  };
  setText('octPhaseLabel', p.label);
  setText('octRoundTc', p.tc);
  setText('octPhaseSub', p.sub);
  setText('octSeq', `0${idx + 1}/05`);
  setText('octStatus', p.status);
  setText('octDist', p.telemetry.distance);
  setText('octLanes', p.telemetry.lanes, p.telemetry.lanesClass);
  setText('octPres', p.telemetry.pressure);
  setText('octCtrl', p.telemetry.control);
  setText('octStrikes', p.telemetry.strikes);

  // Phase dot active state
  document.querySelectorAll('.oct-phase-dot').forEach(d => {
    d.classList.toggle('active', parseInt(d.dataset.phase, 10) === idx);
  });

  // Progress bar animation within phase
  const prog = document.getElementById('octProgress');
  if (prog){
    const xStart = 60;
    const xEnd = 60 + (idx + 1) * 156;
    const xNow = 60 + idx * 156;
    prog.setAttribute('x1', xStart);
    prog.setAttribute('x2', xNow);
    // Animate to xEnd over duration
    const anim = prog.animate(
      [{ x2: xNow }, { x2: xEnd }],
      { duration: p.duration, fill: 'forwards', easing: 'linear' }
    );
    // Store current anim so we can cancel on click
    if (window._octAnim) try { window._octAnim.cancel(); } catch(e){}
    window._octAnim = anim;
  }
}

let _octIdx = 0;
let _octTimer = null;
function octLoopStart(){
  applyOctPhase(_octIdx);
  _octTimer = setTimeout(() => {
    _octIdx = (_octIdx + 1) % OCT_PHASES.length;
    octLoopStart();
  }, OCT_PHASES[_octIdx].duration);
}

function setupOctPhaseButtons(){
  document.querySelectorAll('.oct-phase-dot').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.phase, 10);
      if (_octTimer) clearTimeout(_octTimer);
      _octIdx = i;
      octLoopStart();
    });
  });
}

/* -----------------------------------------------------------
   FIGHTER SPOTLIGHT · dim opposing fighter's elements
----------------------------------------------------------- */
const SPOT_SELECTORS = {
  red: [
    '.hero-fighter--red', '.tape-col--red', '.stat-card__red',
    '.body-viz--red', '.damage-card--red', '.cell-red',
    '.round-card__winner--red', '.chart-legend__swatch--red',
    '#fRed'
  ],
  blue: [
    '.hero-fighter--blue', '.tape-col--blue', '.stat-card__blue',
    '.body-viz--blue', '.damage-card--blue', '.cell-blue',
    '.round-card__winner--blue', '.chart-legend__swatch--blue',
    '#fBlue'
  ]
};

function tagFighterElements(){
  Object.entries(SPOT_SELECTORS).forEach(([color, sels]) => {
    document.querySelectorAll(sels.join(',')).forEach(el => el.classList.add('is-' + color));
  });
}

let _spotlight = null;
function setSpotlight(color){
  const pill = document.getElementById('spotlightPill');
  const dot = document.getElementById('spotlightDot');
  const text = document.getElementById('spotlightText');

  if (color === _spotlight || color === null){
    document.body.classList.remove('spotlight-red', 'spotlight-blue');
    pill.classList.remove('active');
    _spotlight = null;
    return;
  }
  document.body.classList.remove('spotlight-red', 'spotlight-blue');
  document.body.classList.add('spotlight-' + color);
  _spotlight = color;
  pill.classList.add('active');
  text.textContent = color === 'red' ? 'Spotlighting Usman' : 'Spotlighting Covington';
  dot.style.background = color === 'red' ? '#FF2D3F' : '#2DB4FF';
  dot.style.color = color === 'red' ? '#FF2D3F' : '#2DB4FF';
}

function setupSpotlight(){
  tagFighterElements();

  // Click triggers across all fighter elements
  const bind = (selector, color) => {
    document.querySelectorAll(selector).forEach(el => {
      el.addEventListener('click', (e) => {
        // Don't hijack clicks that are on inner interactive elements
        if (e.target.closest('button') && !el.matches('button')) return;
        setSpotlight(color);
      });
    });
  };
  bind('.hero-fighter--red, .damage-card--red, .tape-col--red', 'red');
  bind('.hero-fighter--blue, .damage-card--blue, .tape-col--blue', 'blue');

  // Octagon fighter clicks
  const fRed = document.getElementById('fRed');
  const fBlue = document.getElementById('fBlue');
  if (fRed) fRed.addEventListener('click', () => setSpotlight('red'));
  if (fBlue) fBlue.addEventListener('click', () => setSpotlight('blue'));

  // Octagon fighter hover tooltips
  const fighterTips = {
    red: '<strong>USMAN · The Nigerian Nightmare</strong><br>15-1-0 · 6\'0" · 76" reach<br>Sig strikes: 175 / 360 · 48%<br>Knockdowns: 2 · 53 body shots',
    blue: '<strong>COVINGTON · Chaos</strong><br>15-1-0 · 5\'11" · 72" reach<br>Sig strikes: 143 / 395 · 36%<br>Knockdowns: 0 · Jaw fractured R3'
  };
  if (fRed){
    fRed.addEventListener('mousemove', e => showTip(e.pageX, e.pageY, fighterTips.red));
    fRed.addEventListener('mouseleave', hideTip);
  }
  if (fBlue){
    fBlue.addEventListener('mousemove', e => showTip(e.pageX, e.pageY, fighterTips.blue));
    fBlue.addEventListener('mouseleave', hideTip);
  }

  // Pill clear
  document.getElementById('spotlightClear').addEventListener('click', () => setSpotlight(null));

  // ESC to clear
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _spotlight) setSpotlight(null);
  });
}

/* -----------------------------------------------------------
   OCTAGON PLAY/PAUSE + KEYBOARD
----------------------------------------------------------- */
let _octPaused = false;
function octPause(){
  _octPaused = true;
  if (_octTimer) clearTimeout(_octTimer);
  if (window._octAnim) try { window._octAnim.pause(); } catch(e){}
  const btn = document.getElementById('octPlayPause');
  if (btn){
    btn.textContent = '▶';
    btn.classList.add('paused');
    btn.setAttribute('aria-label', 'Resume playback');
  }
}
function octResume(){
  _octPaused = false;
  const btn = document.getElementById('octPlayPause');
  if (btn){
    btn.textContent = '❚❚';
    btn.classList.remove('paused');
    btn.setAttribute('aria-label', 'Pause playback');
  }
  // Resume loop from current phase
  if (_octTimer) clearTimeout(_octTimer);
  _octTimer = setTimeout(() => {
    _octIdx = (_octIdx + 1) % OCT_PHASES.length;
    octLoopStart();
  }, OCT_PHASES[_octIdx].duration);
  if (window._octAnim) try { window._octAnim.play(); } catch(e){}
}
function octTogglePause(){
  _octPaused ? octResume() : octPause();
}

function octJumpTo(idx){
  if (_octTimer) clearTimeout(_octTimer);
  _octIdx = ((idx % OCT_PHASES.length) + OCT_PHASES.length) % OCT_PHASES.length;
  if (_octPaused){
    applyOctPhase(_octIdx);
  } else {
    octLoopStart();
  }
}

function setupOctControls(){
  const btn = document.getElementById('octPlayPause');
  if (btn) btn.addEventListener('click', octTogglePause);

  // Keyboard · arrows + space when #geometry section is near viewport
  document.addEventListener('keydown', e => {
    const geom = document.getElementById('geometry');
    if (!geom) return;
    const rect = geom.getBoundingClientRect();
    const inView = rect.top < window.innerHeight * 0.6 && rect.bottom > window.innerHeight * 0.4;
    if (!inView) return;
    // Don't hijack if user is typing
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

    if (e.key === 'ArrowRight'){ e.preventDefault(); octJumpTo(_octIdx + 1); }
    else if (e.key === 'ArrowLeft'){ e.preventDefault(); octJumpTo(_octIdx - 1); }
    else if (e.key === ' '){ e.preventDefault(); octTogglePause(); }
  });
}

/* -----------------------------------------------------------
   CROSS-PANEL LINKS · timeline ↔ octagon ↔ round cards
----------------------------------------------------------- */
// Map fight seconds to octagon phase index
function secToOctPhase(sec){
  if (sec < 300) return 0;  // R1
  if (sec < 600) return 1;  // R2
  if (sec < 900) return 2;  // R3
  if (sec < 1200) return 3; // R4
  return 4;                 // R5
}

function smoothScrollTo(id){
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setupCrossLinks(){
  // Round cards → scroll to timeline, flash
  document.querySelectorAll('.round-card').forEach(card => {
    card.addEventListener('click', () => {
      // Narrative is already handled by existing click handler (renderRoundCards)
      // Add: scroll to geometry section and jump octagon to this round
      const roundNum = parseInt(card.dataset.round, 10);
      if (!isNaN(roundNum)) octJumpTo(roundNum - 1);
    });
  });

  // Timeline event nodes → link to octagon phase + scroll to #geometry
  // These are added dynamically in renderTimelineChart; we extend here by
  // adding click handlers to all circles in the timeline SVG
  const timelineSvg = document.getElementById('timelineChart');
  if (timelineSvg){
    // Listen for clicks on any circle inside the timeline SVG
    timelineSvg.addEventListener('click', (e) => {
      const target = e.target;
      // Identify event nodes (they set style.cursor to pointer)
      if (target.tagName === 'circle' && target.style.cursor === 'pointer'){
        // The matching tip shows round info — we stashed round # in a data attr via monkey-patch below
        const sec = parseInt(target.getAttribute('data-sec') || '0', 10);
        octJumpTo(secToOctPhase(sec));
        smoothScrollTo('geometry');
      }
    });
  }
}

/* -----------------------------------------------------------
   INIT
----------------------------------------------------------- */
/* -----------------------------------------------------------
   FIGHT RECREATION · AUDIENCE-POV STICK-FIGURE PLAYBACK
----------------------------------------------------------- */
const REC_GROUND_Y = 340;
const REC_SCALE = 1.35;

/**
 * Fighter param abbreviations:
 *   x   base x position (ground contact midpoint)
 *   le  lead arm extension (0 guard → 1 full punch)
 *   re  rear arm extension
 *   ln  forward lean radians
 *   ws  weight shift (-1 back to +1 forward)
 *   hox head x offset (slips)
 *   dn  downness (0 standing, 1 fully horizontal)
 */
const FIGHT_KEYFRAMES = [
  // ROUND 1 · 0–20s
  // New params: lk=lead kick, rk=rear kick, ky=kick height(0 calf→1 head), cl=clinch, cr=crouch
  { t: 0.0,  r:{x:420,le:.2,re:.3,ln:0,ws:0,hox:0,dn:0},                                b:{x:680,le:.2,re:.3,ln:0,ws:0,hox:0,dn:0},                                cap:'R1 · Opening · Center control',                           rd:1, tc:'0:00' },
  { t: 1.5,  r:{x:425,le:.3,re:.2,ln:.03,ws:.05,hox:0,dn:0,lk:.15,ky:.1},               b:{x:675,le:.3,re:.3,ln:.03,ws:-.05,hox:0,dn:0},                             cap:'Usman feints calf kick',                                  rd:1, tc:'0:15' },
  { t: 3.0,  r:{x:432,le:.3,re:.3,ln:.05,ws:.05,hox:0,dn:0},                             b:{x:672,le:.15,re:.15,ln:.02,ws:-.05,hox:0,dn:0,rk:.7,ky:.15},             cap:'Covington inside leg kick',                                     rd:1, tc:'0:40', ev:{color:'#2DB4FF', x:548, y:310, label:'LEG KICK'} },
  { t: 4.5,  r:{x:440,le:.85,re:.2,ln:.1,ws:.2,hox:0,dn:0},                              b:{x:680,le:.1,re:.3,ln:-.08,ws:-.15,hox:-6,dn:0},                           cap:'Usman jab · Covington slips',                             rd:1, tc:'1:00', ev:{color:'#FF2D3F', x:570, y:200, label:'JAB'} },
  { t: 6.5,  r:{x:450,le:.2,re:.2,ln:-.08,ws:-.2,hox:8,dn:0},                            b:{x:680,le:.8,re:.1,ln:.1,ws:.25,hox:0,dn:0},                               cap:'Covington jab',                                          rd:1, tc:'1:30' },
  { t: 8.0,  r:{x:470,le:.15,re:.1,ln:-.3,ws:-.5,hox:16,dn:0},                           b:{x:660,le:.2,re:.95,ln:.25,ws:.55,hox:0,dn:0},                             cap:'Covington lands left hand · Usman hurt',                        rd:1, tc:'2:30', ev:{color:'#2DB4FF', x:570, y:180, label:'LEFT HAND', big:true} },
  { t: 9.5,  r:{x:465,le:.15,re:.15,ln:.1,ws:-.1,hox:6,dn:0,cl:.7},                      b:{x:665,le:.15,re:.15,ln:.05,ws:.1,hox:0,dn:0,cl:.7},                       cap:'Clinch',               rd:1, tc:'2:45' },
  { t:11.0,  r:{x:460,le:.3,re:.3,ln:.05,ws:0,hox:4,dn:0},                               b:{x:670,le:.2,re:.3,ln:.05,ws:.1,hox:0,dn:0},                               cap:'Break · fighters reset',                                      rd:1, tc:'3:00' },
  { t:12.5,  r:{x:460,le:.2,re:.88,ln:.2,ws:.45,hox:0,dn:0},                             b:{x:660,le:.2,re:.2,ln:-.12,ws:-.2,hox:12,dn:0},                            cap:'Usman lands body shot',                 rd:1, tc:'3:30', ev:{color:'#FFB020', x:600, y:250, label:'BODY'} },
  { t:14.0,  r:{x:455,le:.15,re:.15,ln:.08,ws:.15,hox:0,dn:0,rk:.85,ky:.45},             b:{x:665,le:.3,re:.3,ln:-.1,ws:-.12,hox:0,dn:0},                             cap:'Usman lands body kick',                              rd:1, tc:'3:45', ev:{color:'#FF2D3F', x:590, y:260, label:'BODY KICK'} },
  { t:15.5,  r:{x:450,le:.4,re:.4,ln:.1,ws:.1,hox:0,dn:0},                               b:{x:660,le:.4,re:.4,ln:.05,ws:0,hox:0,dn:0},                                cap:'Striking exchange',                         rd:1, tc:'4:00' },
  { t:17.0,  r:{x:445,le:.2,re:.3,ln:.05,ws:0,hox:0,dn:0},                               b:{x:668,le:.15,re:.15,ln:.05,ws:.05,hox:0,dn:0,rk:.6,ky:.1},               cap:'Covington outside leg kick',                                    rd:1, tc:'4:30', ev:{color:'#2DB4FF', x:555, y:315, label:'LEG KICK'} },
  { t:18.5,  r:{x:435,le:.2,re:.2,ln:0,ws:0,hox:0,dn:0},                                 b:{x:680,le:.2,re:.2,ln:0,ws:0,hox:0,dn:0},                                  cap:'R1 ends · Judges: 10-9 Covington (all three cards)',                          rd:1, tc:'5:00' },

  // ROUND 2 · 20–40s
  { t:20.0,  r:{x:440,le:.3,re:.3,ln:.05,ws:0,hox:0,dn:0},                               b:{x:680,le:.3,re:.3,ln:.05,ws:0,hox:0,dn:0},                                cap:'R2 begins',                     rd:2, tc:'5:00' },
  { t:21.5,  r:{x:445,le:.15,re:.15,ln:.08,ws:.1,hox:0,dn:0,rk:.9,ky:.5},                b:{x:680,le:.3,re:.25,ln:-.05,ws:-.1,hox:0,dn:0},                            cap:'Usman lands body kick',                 rd:2, tc:'5:20', ev:{color:'#FFB020', x:585, y:255, label:'BODY KICK'} },
  { t:23.0,  r:{x:450,le:.85,re:.2,ln:.1,ws:.2,hox:0,dn:0},                              b:{x:680,le:.2,re:.3,ln:-.08,ws:-.15,hox:-8,dn:0},                           cap:'Usman lands jab',                    rd:2, tc:'5:30', ev:{color:'#FF2D3F', x:565, y:195, label:'JAB'} },
  { t:25.0,  r:{x:460,le:.2,re:.2,ln:-.18,ws:-.3,hox:14,dn:0},                           b:{x:670,le:.3,re:.88,ln:.18,ws:.4,hox:0,dn:0},                              cap:'Covington lands overhand left',                                 rd:2, tc:'6:30', ev:{color:'#2DB4FF', x:570, y:190, label:'OVERHAND'} },
  { t:26.5,  r:{x:450,le:.2,re:.2,ln:.25,ws:-.1,hox:0,dn:0,cr:.15},                      b:{x:670,le:.15,re:.15,ln:.1,ws:.1,hox:0,dn:0,lk:.5,ky:.0},                  cap:'⚠ Covington low blow · Ref Goddard halts action',                    rd:2, tc:'7:30', ev:{color:'#8A5EF5', x:565, y:305, label:'⚠ LOW BLOW'} },
  { t:29.0,  r:{x:440,le:.3,re:.3,ln:0,ws:0,hox:0,dn:0},                                 b:{x:680,le:.3,re:.3,ln:.05,ws:0,hox:0,dn:0},                                cap:'Action resumes · Ref Goddard restarts',                                rd:2, tc:'7:45' },
  { t:30.5,  r:{x:448,le:.15,re:.15,ln:.12,ws:.18,hox:0,dn:0,lk:.85,ky:.45},             b:{x:670,le:.3,re:.3,ln:-.08,ws:-.12,hox:0,dn:0},                            cap:'Usman lands front kick to body',                    rd:2, tc:'8:30', ev:{color:'#FFB020', x:578, y:258, label:'FRONT KICK'} },
  { t:32.0,  r:{x:450,le:.2,re:.82,ln:.18,ws:.4,hox:0,dn:0},                             b:{x:670,le:.2,re:.2,ln:-.12,ws:-.2,hox:12,dn:0},                            cap:'Usman lands body shot',                                   rd:2, tc:'9:00', ev:{color:'#FFB020', x:600, y:235, label:'BODY'} },
  { t:33.5,  r:{x:455,le:.15,re:.15,ln:.05,ws:0,hox:0,dn:0,cl:.6},                       b:{x:665,le:.15,re:.15,ln:.05,ws:0,hox:0,dn:0,cl:.6},                        cap:'Clinch',                            rd:2, tc:'9:15' },
  { t:35.0,  r:{x:460,le:.3,re:.3,ln:.1,ws:0,hox:0,dn:0},                                b:{x:660,le:.8,re:.3,ln:.1,ws:.15,hox:0,dn:0},                               cap:'Covington lands uppercut',                                      rd:2, tc:'9:30' },
  { t:37.5,  r:{x:460,le:.3,re:.88,ln:.2,ws:.45,hox:0,dn:0},                             b:{x:670,le:.2,re:.2,ln:-.1,ws:-.15,hox:10,dn:0},                            cap:'Usman lands body shot at bell',                         rd:2, tc:'9:50', ev:{color:'#FFB020', x:600, y:235, label:'BODY'} },
  { t:39.5,  r:{x:450,le:.3,re:.3,ln:0,ws:0,hox:0,dn:0},                                 b:{x:680,le:.3,re:.3,ln:.05,ws:0,hox:0,dn:0},                                cap:'R2 ends · Judges: D\'Amato 20-18 Cov · Colon 19-19 · Cleary 20-18 Usman',              rd:2, tc:'10:00' },

  // ROUND 3 · 40–60s · TURNING POINT
  { t:40.0,  r:{x:460,le:.3,re:.3,ln:.1,ws:.1,hox:0,dn:0},                               b:{x:680,le:.3,re:.3,ln:0,ws:-.05,hox:0,dn:0},                               cap:'R3 begins · Usman moves to center',             rd:3, tc:'10:00' },
  { t:41.5,  r:{x:465,le:.15,re:.15,ln:.1,ws:.15,hox:0,dn:0,rk:.8,ky:.15},               b:{x:680,le:.3,re:.3,ln:-.05,ws:-.08,hox:0,dn:0},                            cap:'Usman lands calf kick',                                 rd:3, tc:'10:30', ev:{color:'#FF2D3F', x:575, y:315, label:'CALF KICK'} },
  { t:43.0,  r:{x:470,le:.9,re:.2,ln:.12,ws:.3,hox:0,dn:0},                              b:{x:690,le:.2,re:.3,ln:-.1,ws:-.18,hox:-10,dn:0},                           cap:'Usman lands right hand · Covington moves to cage',                rd:3, tc:'11:00', ev:{color:'#FF2D3F', x:580, y:195, label:'RIGHT'} },
  { t:44.5,  r:{x:478,le:.15,re:.3,ln:.1,ws:.2,hox:0,dn:0,lk:.95,ky:.5},                 b:{x:695,le:.2,re:.3,ln:-.05,ws:-.1,hox:0,dn:0},                             cap:'Usman lands front kick to body',          rd:3, tc:'12:00', ev:{color:'#FFB020', x:590, y:245, label:'FRONT KICK'} },
  { t:46.0,  r:{x:475,le:.3,re:.3,ln:.1,ws:.15,hox:0,dn:0},                              b:{x:690,le:.3,re:.4,ln:0,ws:0,hox:0,dn:0},                                  cap:'Striking exchange',                rd:3, tc:'13:00' },
  { t:47.5,  r:{x:470,le:.15,re:.15,ln:.08,ws:.1,hox:0,dn:0,rk:.85,ky:.45},              b:{x:688,le:.3,re:.3,ln:-.08,ws:-.1,hox:0,dn:0},                             cap:'Usman lands body kick',                    rd:3, tc:'13:30', ev:{color:'#FFB020', x:585, y:260, label:'BODY KICK'} },
  { t:49.0,  r:{x:470,le:.3,re:.3,ln:.05,ws:.05,hox:0,dn:0},                             b:{x:685,le:.15,re:.15,ln:.05,ws:.05,hox:0,dn:0,rk:.7,ky:.1},               cap:'Covington lands leg kick',                                    rd:3, tc:'14:00', ev:{color:'#2DB4FF', x:572, y:312, label:'LEG KICK'} },
  { t:50.5,  r:{x:470,le:.2,re:.2,ln:-.1,ws:-.15,hox:14,dn:0},                           b:{x:680,le:.8,re:.2,ln:.15,ws:.25,hox:0,dn:0},                              cap:'⚠ Covington eye poke · Ref Goddard halts · physician clears Usman',                       rd:3, tc:'14:15', ev:{color:'#8A5EF5', x:570, y:175, label:'⚠ EYE POKE'} },
  { t:52.5,  r:{x:460,le:.3,re:.3,ln:.05,ws:0,hox:0,dn:0},                               b:{x:680,le:.3,re:.3,ln:.05,ws:0,hox:0,dn:0},                                cap:'Action resumes · Ref Goddard restarts',                            rd:3, tc:'14:30' },
  { t:54.5,  r:{x:470,le:.3,re:.3,ln:.15,ws:.2,hox:0,dn:0},                              b:{x:680,le:.3,re:.3,ln:.05,ws:0,hox:0,dn:0},                                cap:'Usman shifts weight',          rd:3, tc:'14:45' },
  { t:56.5,  r:{x:480,le:.3,re:.97,ln:.35,ws:.65,hox:0,dn:0},                            b:{x:680,le:.1,re:.1,ln:-.45,ws:-.6,hox:24,dn:0},                            cap:'Usman lands right cross · Covington jaw fracture (confirmed NSAC medical)',              rd:3, tc:'14:50', ev:{color:'#FF2D3F', x:595, y:175, label:'RIGHT CROSS', big:true} },
  { t:58.0,  r:{x:478,le:.15,re:.15,ln:.1,ws:.1,hox:0,dn:0,cl:.5},                       b:{x:682,le:.1,re:.1,ln:-.08,ws:-.1,hox:12,dn:0,cl:.5},                      cap:'Clinch',               rd:3, tc:'14:55' },
  { t:59.5,  r:{x:475,le:.3,re:.3,ln:.1,ws:.1,hox:0,dn:0},                               b:{x:685,le:.1,re:.1,ln:-.15,ws:-.2,hox:15,dn:0},                            cap:'R3 ends · Covington jaw injury apparent between rounds',            rd:3, tc:'15:00', ev:{color:'#FFB020', x:685, y:120, label:'R3 ENDS'} },

  // ROUND 4 · 60–80s
  { t:60.0,  r:{x:460,le:.3,re:.3,ln:.05,ws:0,hox:0,dn:0},                               b:{x:680,le:.3,re:.3,ln:0,ws:-.05,hox:0,dn:0},                               cap:'R4 begins',        rd:4, tc:'15:00' },
  { t:61.5,  r:{x:465,le:.15,re:.15,ln:.1,ws:.15,hox:0,dn:0,rk:.8,ky:.5},                b:{x:678,le:.3,re:.3,ln:-.08,ws:-.1,hox:0,dn:0},                             cap:'Usman lands body kick',                   rd:4, tc:'15:20', ev:{color:'#FFB020', x:582, y:255, label:'BODY KICK'} },
  { t:63.0,  r:{x:470,le:.2,re:.85,ln:.2,ws:.4,hox:0,dn:0},                              b:{x:670,le:.2,re:.2,ln:-.12,ws:-.2,hox:10,dn:0},                            cap:'Usman lands body shots',            rd:4, tc:'15:40', ev:{color:'#FFB020', x:600, y:240, label:'BODY'} },
  { t:64.5,  r:{x:468,le:.15,re:.15,ln:.05,ws:0,hox:0,dn:0,cl:.65},                      b:{x:668,le:.15,re:.15,ln:.05,ws:.05,hox:0,dn:0,cl:.65},                     cap:'Clinch · Usman lands from collar tie',              rd:4, tc:'16:00' },
  { t:66.0,  r:{x:465,le:.3,re:.2,ln:-.12,ws:-.2,hox:12,dn:0},                           b:{x:670,le:.82,re:.82,ln:.2,ws:.35,hox:0,dn:0},                             cap:'Covington lands uppercut combo',              rd:4, tc:'16:30', ev:{color:'#2DB4FF', x:575, y:185, label:'UPPERCUT'} },
  { t:68.0,  r:{x:460,le:.2,re:.2,ln:-.3,ws:-.55,hox:18,dn:0,cr:.2},                     b:{x:665,le:.92,re:.92,ln:.28,ws:.5,hox:0,dn:0},                             cap:'Covington lands 3-punch combination · Usman hurt',               rd:4, tc:'18:00', ev:{color:'#2DB4FF', x:570, y:190, label:'COMBINATION', big:true} },
  { t:69.5,  r:{x:465,le:.15,re:.15,ln:.1,ws:.05,hox:0,dn:0,cl:.55},                     b:{x:670,le:.15,re:.15,ln:.08,ws:0,hox:0,dn:0,cl:.55},                       cap:'Clinch · Usman lands knee',                  rd:4, tc:'18:20' },
  { t:71.0,  r:{x:470,le:.15,re:.15,ln:.15,ws:.2,hox:0,dn:0,rk:.9,ky:.5},                b:{x:680,le:.3,re:.3,ln:-.05,ws:-.1,hox:0,dn:0},                             cap:'Usman lands body kick',                   rd:4, tc:'18:40', ev:{color:'#FF2D3F', x:582, y:260, label:'BODY KICK'} },
  { t:73.0,  r:{x:475,le:.3,re:.3,ln:.1,ws:.15,hox:0,dn:0},                              b:{x:675,le:.85,re:.4,ln:.25,ws:.35,hox:0,dn:0,lk:.4,ky:.2},                 cap:'Covington superman punch and kick',                        rd:4, tc:'19:15', ev:{color:'#2DB4FF', x:580, y:200, label:'SUPERMAN'} },
  { t:75.0,  r:{x:470,le:.15,re:.15,ln:.05,ws:.05,hox:0,dn:0,lk:.7,ky:.15},              b:{x:678,le:.3,re:.3,ln:0,ws:-.05,hox:0,dn:0},                               cap:'Calf kick exchange',                                rd:4, tc:'19:30', ev:{color:'#FF2D3F', x:572, y:315, label:'CALF KICK'} },
  { t:76.5,  r:{x:465,le:.45,re:.45,ln:.1,ws:0,hox:0,dn:0},                              b:{x:680,le:.45,re:.45,ln:.1,ws:.05,hox:0,dn:0},                             cap:'Striking exchange',                rd:4, tc:'19:45' },
  { t:78.5,  r:{x:460,le:.3,re:.3,ln:0,ws:0,hox:0,dn:0},                                 b:{x:680,le:.3,re:.3,ln:0,ws:0,hox:0,dn:0},                                  cap:'R4 ends · Judges: D\'Amato 39-37 Cov · Colon 38-38 · Cleary 39-37 Usman',                rd:4, tc:'20:00' },

  // ROUND 5 · 80–100s · TKO
  { t:80.0,  r:{x:450,le:.3,re:.3,ln:0,ws:-.1,hox:0,dn:0},                               b:{x:690,le:.4,re:.4,ln:.1,ws:.25,hox:0,dn:0},                               cap:'R5 begins',              rd:5, tc:'20:00' },
  { t:81.5,  r:{x:448,le:.3,re:.3,ln:-.05,ws:-.1,hox:0,dn:0},                            b:{x:688,le:.3,re:.2,ln:.08,ws:.12,hox:0,dn:0,rk:.7,ky:.15},                cap:'Covington lands leg kick',                    rd:5, tc:'21:00', ev:{color:'#2DB4FF', x:565, y:312, label:'LEG KICK'} },
  { t:83.0,  r:{x:455,le:.15,re:.15,ln:.12,ws:.18,hox:0,dn:0,rk:.85,ky:.5},              b:{x:685,le:.3,re:.3,ln:-.05,ws:-.1,hox:0,dn:0},                             cap:'Usman lands body kick',                      rd:5, tc:'21:30', ev:{color:'#FFB020', x:580, y:255, label:'BODY KICK'} },
  { t:84.5,  r:{x:460,le:.85,re:.85,ln:.2,ws:.4,hox:0,dn:0},                             b:{x:680,le:.2,re:.2,ln:-.1,ws:-.15,hox:12,dn:0},                            cap:'Usman lands combination near fence',                         rd:5, tc:'22:30', ev:{color:'#FF2D3F', x:580, y:190, label:'3-2 COMBO'} },
  { t:86.0,  r:{x:468,le:.15,re:.15,ln:.05,ws:0,hox:0,dn:0,cl:.55},                      b:{x:678,le:.15,re:.15,ln:-.05,ws:-.05,hox:0,dn:0,cl:.55},                   cap:'Clinch exchange',                    rd:5, tc:'22:45' },
  { t:87.5,  r:{x:475,le:.3,re:.3,ln:.1,ws:.15,hox:0,dn:0},                              b:{x:680,le:.3,re:.3,ln:-.05,ws:-.1,hox:0,dn:0},                             cap:'Striking exchange · Covington hurt',                                  rd:5, tc:'23:15' },
  { t:89.0,  r:{x:482,le:.2,re:.97,ln:.4,ws:.7,hox:0,dn:0},                              b:{x:675,le:.1,re:.1,ln:-.55,ws:-.75,hox:22,dn:.55,cr:.3},                   cap:'Knockdown 1 · Usman right hand',             rd:5, tc:'23:30', ev:{color:'#FF2D3F', x:595, y:180, label:'KD 1', big:true} },
  { t:90.5,  r:{x:485,le:.3,re:.3,ln:.2,ws:.3,hox:0,dn:0},                               b:{x:660,le:.3,re:.3,ln:-.25,ws:-.35,hox:10,dn:0},                           cap:'Covington returns to feet',                     rd:5, tc:'23:40' },
  { t:91.5,  r:{x:495,le:.2,re:.97,ln:.45,ws:.8,hox:0,dn:0},                             b:{x:650,le:.1,re:.1,ln:-.7,ws:-.85,hox:26,dn:.95},                          cap:'Knockdown 2 · Usman right hand',                          rd:5, tc:'23:45', ev:{color:'#FF2D3F', x:590, y:200, label:'KD 2', big:true} },
  { t:93.0,  r:{x:515,le:.2,re:.3,ln:.4,ws:.6,hox:0,dn:.15,cr:.4},                       b:{x:630,le:.2,re:.1,ln:0,ws:0,hox:0,dn:.85,cr:.6},                          cap:'Covington takedown attempt · Usman defends',                 rd:5, tc:'23:55' },
  { t:95.0,  r:{x:550,le:.3,re:.88,ln:.35,ws:.35,hox:0,dn:.2},                           b:{x:620,le:0,re:0,ln:0,ws:0,hox:0,dn:1},                                    cap:'Usman ground strikes · hammerfists',               rd:5, tc:'24:00', ev:{color:'#FFB020', x:620, y:305, label:'G&P'} },
  { t:97.0,  r:{x:553,le:.3,re:.95,ln:.3,ws:.3,hox:0,dn:.2},                             b:{x:620,le:0,re:0,ln:0,ws:0,hox:0,dn:1},                                    cap:'Usman ground strikes continue',                       rd:5, tc:'24:08', ev:{color:'#FFB020', x:620, y:305, label:'G&P'} },
  { t:98.5,  r:{x:555,le:.15,re:.92,ln:.28,ws:.28,hox:0,dn:.2},                          b:{x:620,le:0,re:0,ln:0,ws:0,hox:0,dn:1},                                    cap:'Ref Goddard observing · Covington not defending',                     rd:5, tc:'24:09' },
  { t:100.0, r:{x:555,le:.3,re:.3,ln:0,ws:0,hox:0,dn:.2},                                b:{x:620,le:0,re:0,ln:0,ws:0,hox:0,dn:1},                                    cap:'Ref Goddard stops fight · TKO 4:10 R5',                          rd:5, tc:'24:10', ev:{color:'#FFFFFF', x:590, y:180, label:'TKO · REF STOPPAGE', big:true} }
];
const REC_TOTAL = FIGHT_KEYFRAMES[FIGHT_KEYFRAMES.length - 1].t;
const REC_ROUND_STARTS = [0, 20, 40, 60, 80];

// Cache stick figure line elements
function cachePartsFor(prefix){
  return {
    rearShin:    document.getElementById(prefix + '-rearShin'),
    rearThigh:   document.getElementById(prefix + '-rearThigh'),
    leadShin:    document.getElementById(prefix + '-leadShin'),
    leadThigh:   document.getElementById(prefix + '-leadThigh'),
    torso:       document.getElementById(prefix + '-torso'),
    shoulders:   document.getElementById(prefix + '-shoulders'),
    rearUpper:   document.getElementById(prefix + '-rearUpper'),
    rearFore:    document.getElementById(prefix + '-rearFore'),
    leadUpper:   document.getElementById(prefix + '-leadUpper'),
    leadFore:    document.getElementById(prefix + '-leadFore'),
    neck:        document.getElementById(prefix + '-neck'),
    head:        document.getElementById(prefix + '-head')
  };
}
let _recPartsR = null, _recPartsB = null;

function setLineAttr(line, x1, y1, x2, y2){
  line.setAttribute('x1', x1); line.setAttribute('y1', y1);
  line.setAttribute('x2', x2); line.setAttribute('y2', y2);
}

// Render a standing stick figure from params
function renderStanding(parts, p, dir){
  const s = REC_SCALE;
  const D = dir;
  const gy = REC_GROUND_Y;

  // Defaults for new params (backward-compat)
  const lk = p.lk || 0;  // lead kick extension 0→1
  const rk = p.rk || 0;  // rear kick extension 0→1
  const ky = p.ky || 0;  // kick height 0 low→1 head
  const cl = p.cl || 0;  // clinch factor 0→1
  const cr = p.cr || 0;  // crouch / level change 0→1

  // Crouch drops the hips
  const crouchDrop = cr * 80 * s;
  const hipCX     = p.x + D * p.ws * 10 * s;
  const hipY      = gy - (190 - crouchDrop * 0.5) * s;

  // === LEGS ===
  // Lead leg — either planted or kicking
  let leadFootX, leadFootY, leadKneeX, leadKneeY;
  if (lk > 0.05){
    // Kicking: lead leg extends forward and up
    const kickAngle = -0.3 - ky * 1.1;  // radians from horizontal
    const thighLen = 80 * s;
    const shinLen  = 75 * s;
    const chamberAmt = Math.min(lk * 2, 1);  // chamber first half, extend second
    const extendAmt  = Math.max((lk - 0.5) * 2, 0);

    leadKneeX = hipCX + D * thighLen * Math.cos(kickAngle) * chamberAmt;
    leadKneeY = hipY + thighLen * Math.sin(kickAngle) * chamberAmt + thighLen * (1 - chamberAmt);
    leadFootX = leadKneeX + D * shinLen * extendAmt;
    leadFootY = leadKneeY - shinLen * ky * extendAmt * 0.3;
  } else {
    // Normal stance with weight shift
    leadFootX = p.x + D * (38 + p.ws * 8 + cr * 20) * s;
    leadFootY = gy;
    leadKneeX = lerp(hipCX, leadFootX, 0.5) + D * 6 * s;
    leadKneeY = lerp(hipY, gy, 0.55) + cr * 30 * s;
  }

  // Rear leg — either planted or kicking (roundhouse / body kick)
  let rearFootX, rearFootY, rearKneeX, rearKneeY;
  if (rk > 0.05){
    const kickAngle = -0.2 - ky * 1.0;
    const thighLen = 80 * s;
    const shinLen  = 78 * s;
    const chamberAmt = Math.min(rk * 2, 1);
    const extendAmt  = Math.max((rk - 0.5) * 2, 0);

    // Rear kick swings forward (roundhouse arc)
    rearKneeX = hipCX + D * thighLen * 0.5 * chamberAmt;
    rearKneeY = hipY + thighLen * Math.sin(kickAngle) * chamberAmt + thighLen * (1 - chamberAmt) * 0.6;
    rearFootX = rearKneeX + D * shinLen * extendAmt;
    rearFootY = rearKneeY - shinLen * ky * extendAmt * 0.4;
  } else {
    rearFootX = p.x - D * (40 + cr * 16) * s;
    rearFootY = gy;
    rearKneeX = lerp(hipCX, rearFootX, 0.5) - D * 4 * s;
    rearKneeY = lerp(hipY, gy, 0.55) + cr * 30 * s;
  }

  // === TORSO ===
  const effectiveLean = p.ln + cr * 0.35;  // crouch adds forward lean
  const torsoLen = (110 - cr * 30) * s;
  const chestX    = hipCX + D * effectiveLean * torsoLen * 0.7;
  const chestY    = hipY - torsoLen * Math.cos(effectiveLean);

  // === SHOULDERS ===
  const shLeadX   = chestX + D * 20 * s;
  const shLeadY   = chestY;
  const shRearX   = chestX - D * 25 * s;
  const shRearY   = chestY - 4 * s;

  // === ARMS ===
  let fistLeadX, fistLeadY, elbowLeadX, elbowLeadY;
  let fistRearX, fistRearY, elbowRearX, elbowRearY;

  if (cl > 0.3){
    // Clinch: arms wrap inward toward opponent
    const clFactor = (cl - 0.3) / 0.7;  // 0→1 over cl 0.3→1
    const wrapX = D * (50 + 40 * clFactor) * s;
    const wrapY = chestY + 20 * s * clFactor;

    elbowLeadX = shLeadX + D * 30 * s;
    elbowLeadY = shLeadY + 10 * s;
    fistLeadX  = shLeadX + wrapX;
    fistLeadY  = wrapY;

    elbowRearX = shRearX + D * 20 * s;
    elbowRearY = shRearY + 8 * s;
    fistRearX  = shRearX + wrapX * 0.6;
    fistRearY  = wrapY + 10 * s;
  } else {
    // Normal punch arms
    const fistLeadDist = (90 + 80 * p.le) * s;
    fistLeadX = shLeadX + D * fistLeadDist;
    fistLeadY = shLeadY - 8 * s + p.le * 6 * s;
    elbowLeadX = (shLeadX + fistLeadX)/2 + D * 10 * (1 - p.le) * s;
    elbowLeadY = (shLeadY + fistLeadY)/2 - 6 * s;

    const fistRearDist = (20 + 130 * p.re) * s;
    fistRearX = shRearX + D * fistRearDist;
    fistRearY = shRearY - 18 * s + p.re * 24 * s;
    elbowRearX = (shRearX + fistRearX)/2 + D * 8 * (1 - p.re) * s;
    elbowRearY = (shRearY + fistRearY)/2 - 8 * s;
  }

  // === HEAD ===
  const headCX = chestX + D * Math.sin(effectiveLean) * 10 * s + (p.hox || 0);
  const hr = 16 * s;
  const headCY = chestY - 18 * s - hr - cr * 20 * s;
  const neckBottomY = chestY - 2 * s;
  const neckTopY    = headCY + hr;

  // === SET ATTRIBUTES ===
  setLineAttr(parts.rearShin, rearFootX, rearFootY, rearKneeX, rearKneeY);
  setLineAttr(parts.rearThigh, rearKneeX, rearKneeY, hipCX, hipY);
  setLineAttr(parts.leadShin, leadFootX, leadFootY, leadKneeX, leadKneeY);
  setLineAttr(parts.leadThigh, leadKneeX, leadKneeY, hipCX, hipY);
  setLineAttr(parts.torso, hipCX, hipY, chestX, chestY);
  setLineAttr(parts.shoulders, shLeadX, shLeadY, shRearX, shRearY);
  setLineAttr(parts.rearUpper, shRearX, shRearY, elbowRearX, elbowRearY);
  setLineAttr(parts.rearFore, elbowRearX, elbowRearY, fistRearX, fistRearY);
  setLineAttr(parts.leadUpper, shLeadX, shLeadY, elbowLeadX, elbowLeadY);
  setLineAttr(parts.leadFore, elbowLeadX, elbowLeadY, fistLeadX, fistLeadY);
  setLineAttr(parts.neck, chestX, neckBottomY, headCX, neckTopY);
  parts.head.setAttribute('cx', headCX);
  parts.head.setAttribute('cy', headCY);
  parts.head.setAttribute('r', hr);
}

// Render a horizontal/lying stick figure (knockdowns, ground-and-pound)
function renderLying(parts, p, dir){
  const s = REC_SCALE;
  const D = dir;
  const gy = REC_GROUND_Y;

  // Body slightly elevated (propped on back, not flat)
  const pelvisX = p.x;
  const pelvisY = gy - 22 * s;   // raised higher for visibility
  const chestX  = p.x + D * 70 * s;
  const chestY  = gy - 40 * s;   // torso propped up (turtle/shell guard)
  const shLeadX = chestX + D * 14 * s;
  const shLeadY = chestY + 2 * s;
  const shRearX = chestX - D * 16 * s;
  const shRearY = chestY - 6 * s;
  const headCX  = chestX + D * 38 * s;
  const headCY  = chestY - 10 * s;
  const hr      = 16 * s;

  // Legs bent / defensive — knees up, feet on ground
  const leadKneeX = pelvisX - D * 20 * s;
  const leadKneeY = gy - 40 * s;  // knee raised (guard position)
  const leadFootX = pelvisX - D * 45 * s;
  const leadFootY = gy - 5 * s;
  const rearKneeX = pelvisX - D * 38 * s;
  const rearKneeY = gy - 30 * s;
  const rearFootX = pelvisX - D * 65 * s;
  const rearFootY = gy - 5 * s;

  // Arms: one guarding face, one bracing
  const elbowLeadX = shLeadX + D * 18 * s;
  const elbowLeadY = shLeadY - 10 * s;  // arm up guarding
  const fistLeadX  = shLeadX + D * 6 * s;
  const fistLeadY  = shLeadY - 30 * s;  // fist near face (shell)
  const elbowRearX = shRearX + D * 4 * s;
  const elbowRearY = shRearY - 18 * s;
  const fistRearX  = shRearX + D * 14 * s;
  const fistRearY  = shRearY - 34 * s;  // other fist also guarding

  setLineAttr(parts.rearShin, rearFootX, rearFootY, rearKneeX, rearKneeY);
  setLineAttr(parts.rearThigh, rearKneeX, rearKneeY, pelvisX, pelvisY);
  setLineAttr(parts.leadShin, leadFootX, leadFootY, leadKneeX, leadKneeY);
  setLineAttr(parts.leadThigh, leadKneeX, leadKneeY, pelvisX, pelvisY);
  setLineAttr(parts.torso, pelvisX, pelvisY, chestX, chestY);
  setLineAttr(parts.shoulders, shLeadX, shLeadY, shRearX, shRearY);
  setLineAttr(parts.rearUpper, shRearX, shRearY, elbowRearX, elbowRearY);
  setLineAttr(parts.rearFore, elbowRearX, elbowRearY, fistRearX, fistRearY);
  setLineAttr(parts.leadUpper, shLeadX, shLeadY, elbowLeadX, elbowLeadY);
  setLineAttr(parts.leadFore, elbowLeadX, elbowLeadY, fistLeadX, fistLeadY);
  setLineAttr(parts.neck, chestX, chestY - 2 * s, headCX, headCY + hr);
  parts.head.setAttribute('cx', headCX);
  parts.head.setAttribute('cy', headCY);
  parts.head.setAttribute('r', hr);
}

function renderFighter(parts, p, dir){
  if ((p.dn || 0) > 0.5) renderLying(parts, p, dir);
  else renderStanding(parts, p, dir);
}

// Lerp between two fighter param objects (with defaults for new params)
function lerpFighter(f1, f2, t){
  return {
    x:   lerp(f1.x,   f2.x,   t),
    le:  lerp(f1.le,  f2.le,  t),
    re:  lerp(f1.re,  f2.re,  t),
    ln:  lerp(f1.ln,  f2.ln,  t),
    ws:  lerp(f1.ws,  f2.ws,  t),
    hox: lerp(f1.hox||0, f2.hox||0, t),
    dn:  lerp(f1.dn||0,  f2.dn||0,  t),
    lk:  lerp(f1.lk||0,  f2.lk||0,  t),
    rk:  lerp(f1.rk||0,  f2.rk||0,  t),
    ky:  lerp(f1.ky||0,  f2.ky||0,  t),
    cl:  lerp(f1.cl||0,  f2.cl||0,  t),
    cr:  lerp(f1.cr||0,  f2.cr||0,  t)
  };
}

/* -----------------------------------------------------------
   EASING FUNCTIONS · strike snap, recoil, smooth movement
----------------------------------------------------------- */
function easeSmooth(t){ return t * t * (3 - 2 * t); }                    // smooth S-curve
function easeSnap(t){ return 1 - Math.pow(1 - t, 3); }                   // fast start → slow end (strike extension)
function easeRecoil(t){ return t < .4 ? t/.4 * 1.08 : 1.08 - .08 * ((t-.4)/.6); } // overshoot then settle
function easeWhip(t){                                                     // chamber then snap (kicks)
  if (t < 0.35) return (t / 0.35) * 0.3;                                 // slow chamber
  return 0.3 + ((t - 0.35) / 0.65) * 0.7;                               // fast extension
}

// Determine easing curve based on keyframe content
function pickEase(prev, next){
  // If the next keyframe has a strike event → snap easing
  if (next.ev && next.ev.big) return easeSnap;
  if (next.ev) return easeSnap;
  // If either fighter is throwing a kick → whip easing
  const nR = next.r, nB = next.b;
  if ((nR.lk||0) > 0.3 || (nR.rk||0) > 0.3 || (nB.lk||0) > 0.3 || (nB.rk||0) > 0.3) return easeWhip;
  // If either fighter is entering/exiting clinch → smooth
  if (Math.abs((nR.cl||0) - (prev.r.cl||0)) > 0.2 || Math.abs((nB.cl||0) - (prev.b.cl||0)) > 0.2) return easeSmooth;
  // If fighter is getting hit (head offset or lean changes sharply) → recoil
  const dHoxR = Math.abs((nR.hox||0) - (prev.r.hox||0));
  const dHoxB = Math.abs((nB.hox||0) - (prev.b.hox||0));
  if (dHoxR > 10 || dHoxB > 10) return easeRecoil;
  // Default → smooth
  return easeSmooth;
}

/* -----------------------------------------------------------
   IDLE BOUNCE · procedural micro-animation layer
----------------------------------------------------------- */
function idleOffset(time, seed){
  // Breathing-like vertical oscillation + slight lateral sway
  const freq1 = 1.8 + seed * 0.3;   // ~2Hz bounce (bouncing on balls of feet)
  const freq2 = 0.7 + seed * 0.15;  // slower sway
  return {
    dy: Math.sin(time * freq1 * Math.PI * 2) * 2.2 + Math.sin(time * freq2 * Math.PI * 2) * 0.8,
    dx: Math.sin(time * freq2 * Math.PI * 2 + 1.2) * 1.5,
    headDx: Math.sin(time * freq1 * Math.PI * 2 + 0.5) * 0.8,
    leanOsc: Math.sin(time * freq2 * Math.PI * 2 + 2.0) * 0.015
  };
}

function getRecFrameAt(time){
  let prev = FIGHT_KEYFRAMES[0], next = FIGHT_KEYFRAMES[0];
  let prevIdx = 0;
  for (let i = 0; i < FIGHT_KEYFRAMES.length - 1; i++){
    if (FIGHT_KEYFRAMES[i].t <= time && FIGHT_KEYFRAMES[i+1].t > time){
      prev = FIGHT_KEYFRAMES[i];
      next = FIGHT_KEYFRAMES[i+1];
      prevIdx = i;
      break;
    }
  }
  if (time >= FIGHT_KEYFRAMES[FIGHT_KEYFRAMES.length-1].t){
    prev = next = FIGHT_KEYFRAMES[FIGHT_KEYFRAMES.length-1];
    prevIdx = FIGHT_KEYFRAMES.length - 1;
  }
  const span = next.t - prev.t;
  const rawT = span > 0 ? (time - prev.t) / span : 0;

  // Apply easing curve
  const easeFn = pickEase(prev, next);
  const tt = easeFn(rawT);

  const red = lerpFighter(prev.r, next.r, tt);
  const blue = lerpFighter(prev.b, next.b, tt);

  // Layer idle oscillation (suppressed when lying down or in clinch or actively kicking)
  const suppressR = (red.dn || 0) > 0.3 || (red.cl || 0) > 0.4 || (red.lk || 0) > 0.3 || (red.rk || 0) > 0.3 ? 0 : 1;
  const suppressB = (blue.dn || 0) > 0.3 || (blue.cl || 0) > 0.4 || (blue.lk || 0) > 0.3 || (blue.rk || 0) > 0.3 ? 0 : 1;
  const idleR = idleOffset(time, 0.0);
  const idleB = idleOffset(time, 0.5);

  red.x += idleR.dx * suppressR;
  red.hox = (red.hox || 0) + idleR.headDx * suppressR;
  red.ln += idleR.leanOsc * suppressR;
  red._idleDy = idleR.dy * suppressR;

  blue.x += idleB.dx * suppressB;
  blue.hox = (blue.hox || 0) + idleB.headDx * suppressB;
  blue.ln += idleB.leanOsc * suppressB;
  blue._idleDy = idleB.dy * suppressB;

  return {
    red, blue,
    caption: prev.cap,
    round: prev.rd,
    tc: prev.tc,
    event: prev.ev,
    prevIdx,
    rawT
  };
}

// Hit flash burst at a given position + stage shake
function spawnHitFlash(ev){
  const layer = document.getElementById('recHitLayer');
  if (!layer) return;
  const g = document.createElementNS('http://www.w3.org/2000/svg','g');
  g.setAttribute('class','rec-hit show');
  const r1 = document.createElementNS('http://www.w3.org/2000/svg','circle');
  r1.setAttribute('cx', ev.x); r1.setAttribute('cy', ev.y); r1.setAttribute('r', ev.big ? 26 : 16);
  r1.setAttribute('fill','none'); r1.setAttribute('stroke', ev.color); r1.setAttribute('stroke-width', ev.big ? 3 : 2);
  g.appendChild(r1);
  if (ev.big){
    const r2 = document.createElementNS('http://www.w3.org/2000/svg','circle');
    r2.setAttribute('cx', ev.x); r2.setAttribute('cy', ev.y); r2.setAttribute('r', 14);
    r2.setAttribute('fill','none'); r2.setAttribute('stroke', ev.color); r2.setAttribute('stroke-width', 1.5);
    g.appendChild(r2);
  }
  const label = document.createElementNS('http://www.w3.org/2000/svg','text');
  label.setAttribute('x', ev.x);
  label.setAttribute('y', ev.y - (ev.big ? 38 : 28));
  label.setAttribute('text-anchor','middle');
  label.setAttribute('font-family','Barlow Condensed');
  label.setAttribute('font-size', ev.big ? 16 : 12);
  label.setAttribute('font-weight','700');
  label.setAttribute('letter-spacing','.18em');
  label.setAttribute('fill', ev.color);
  label.textContent = ev.label;
  g.appendChild(label);
  layer.appendChild(g);
  setTimeout(() => g.remove(), 1400);

  // Stage shake
  const stage = document.querySelector('.rec-stage');
  if (stage){
    stage.classList.remove('shake', 'shake-big');
    void stage.offsetWidth;  // force reflow to restart animation
    stage.classList.add(ev.big ? 'shake-big' : 'shake');
    setTimeout(() => stage.classList.remove('shake', 'shake-big'), ev.big ? 500 : 350);
  }

  // 3D effects
  const evX3d = (ev.x - 550) * 0.01;
  const evY3d = Math.max((REC_GROUND_Y - ev.y) * 0.01 + 0.06, 0.06);
  spawn3DParticles(evX3d, evY3d, parseInt(ev.color.replace('#',''), 16), ev.big ? 18 : 8);
  trigger3DShake(ev.big ? 1.2 : 0.4);
}

/* -----------------------------------------------------------
   MOTION TRAIL TRACKING
----------------------------------------------------------- */
// Store previous fist/foot positions to draw trails
let _trailPrev = { rFistX: 0, rFistY: 0, rFootX: 0, rFootY: 0, bFistX: 0, bFistY: 0, bFootX: 0, bFootY: 0 };
let _trailInited = false;

function updateTrails(partsR, partsB, red, blue){
  // Read current fist positions from the lead forearm endpoint
  const rFistX = parseFloat(partsR.leadFore.getAttribute('x2')) || 0;
  const rFistY = parseFloat(partsR.leadFore.getAttribute('y2')) || 0;
  const rFootX = parseFloat(partsR.leadShin.getAttribute('x1')) || 0;
  const rFootY = parseFloat(partsR.leadShin.getAttribute('y1')) || 0;
  const bFistX = parseFloat(partsB.leadFore.getAttribute('x2')) || 0;
  const bFistY = parseFloat(partsB.leadFore.getAttribute('y2')) || 0;
  const bFootX = parseFloat(partsB.leadShin.getAttribute('x1')) || 0;
  const bFootY = parseFloat(partsB.leadShin.getAttribute('y1')) || 0;

  if (!_trailInited){
    _trailPrev = { rFistX, rFistY, rFootX, rFootY, bFistX, bFistY, bFootX, bFootY };
    _trailInited = true;
    return;
  }

  const threshold = 18;  // min distance to show trail
  const pairs = [
    { id: 'trailR1', px: _trailPrev.rFistX, py: _trailPrev.rFistY, cx: rFistX, cy: rFistY, active: red.le > 0.5 || red.re > 0.5 },
    { id: 'trailR2', px: _trailPrev.rFootX, py: _trailPrev.rFootY, cx: rFootX, cy: rFootY, active: (red.lk||0) > 0.3 || (red.rk||0) > 0.3 },
    { id: 'trailB1', px: _trailPrev.bFistX, py: _trailPrev.bFistY, cx: bFistX, cy: bFistY, active: blue.le > 0.5 || blue.re > 0.5 },
    { id: 'trailB2', px: _trailPrev.bFootX, py: _trailPrev.bFootY, cx: bFootX, cy: bFootY, active: (blue.lk||0) > 0.3 || (blue.rk||0) > 0.3 }
  ];

  pairs.forEach(p => {
    const el = document.getElementById(p.id);
    if (!el) return;
    const dist = Math.hypot(p.cx - p.px, p.cy - p.py);
    if (p.active && dist > threshold){
      setLineAttr(el, p.px, p.py, p.cx, p.cy);
      el.classList.remove('active');
      void el.offsetWidth;
      el.classList.add('active');
    }
  });

  // Also track rear arm trails
  const rRFistX = parseFloat(partsR.rearFore.getAttribute('x2')) || 0;
  const rRFistY = parseFloat(partsR.rearFore.getAttribute('y2')) || 0;
  const bRFistX = parseFloat(partsB.rearFore.getAttribute('x2')) || 0;
  const bRFistY = parseFloat(partsB.rearFore.getAttribute('y2')) || 0;

  const rearPairs = [
    { id: 'trailR3', px: _trailPrev.rRFistX||rRFistX, py: _trailPrev.rRFistY||rRFistY, cx: rRFistX, cy: rRFistY, active: red.re > 0.6 },
    { id: 'trailB3', px: _trailPrev.bRFistX||bRFistX, py: _trailPrev.bRFistY||bRFistY, cx: bRFistX, cy: bRFistY, active: blue.re > 0.6 }
  ];
  rearPairs.forEach(p => {
    const el = document.getElementById(p.id);
    if (!el) return;
    const dist = Math.hypot(p.cx - p.px, p.cy - p.py);
    if (p.active && dist > threshold){
      setLineAttr(el, p.px, p.py, p.cx, p.cy);
      el.classList.remove('active');
      void el.offsetWidth;
      el.classList.add('active');
    }
  });

  _trailPrev = { rFistX, rFistY, rFootX, rFootY, bFistX, bFistY, bFootX, bFootY, rRFistX, rRFistY, bRFistX, bRFistY };
}

// Animation state
let _recPlaying = false;
let _recTime = 0;
let _recLastFrameT = 0;
let _recSpeed = 1.0;
const REC_SPEEDS = [0.5, 1.0, 1.5, 2.0];
let _recSpeedIdx = 1;
let _recLastEventIdx = -1;
let _recLastCaption = '';
let _recDt = 0.016;

function applyRecFrame(time){
  const f = getRecFrameAt(time);

  renderFighter(_recPartsR, f.red, 1);
  renderFighter(_recPartsB, f.blue, -1);

  // 3D scene update (reads from SVG joint positions)
  render3DFrame(_recDt);

  // Motion trails (after rendering so limb positions are set)
  if (_recPartsR && _recPartsB) updateTrails(_recPartsR, _recPartsB, f.red, f.blue);

  // Shadows follow fighters
  const shR = document.getElementById('recShadowR');
  const shB = document.getElementById('recShadowB');
  if (shR){
    shR.setAttribute('cx', f.red.x);
    shR.setAttribute('cy', REC_GROUND_Y + 2);
    shR.setAttribute('rx', (f.red.dn||0) > 0.5 ? 55 : 40);
  }
  if (shB){
    shB.setAttribute('cx', f.blue.x);
    shB.setAttribute('cy', REC_GROUND_Y + 2);
    shB.setAttribute('rx', (f.blue.dn||0) > 0.5 ? 55 : 40);
  }

  // Fighter name labels follow
  const labelR = document.getElementById('recLabelR');
  const labelB = document.getElementById('recLabelB');
  if (labelR){
    labelR.setAttribute('x', f.red.x);
    labelR.setAttribute('y', (f.red.dn||0) > 0.5 ? REC_GROUND_Y - 40 : 70);
  }
  if (labelB){
    labelB.setAttribute('x', f.blue.x);
    labelB.setAttribute('y', (f.blue.dn||0) > 0.5 ? REC_GROUND_Y - 40 : 70);
  }

  // Caption / round / TC updates
  if (f.caption !== _recLastCaption){
    const capEl = document.getElementById('recCaption');
    capEl.style.opacity = '0';
    setTimeout(() => {
      capEl.textContent = f.caption;
      capEl.style.opacity = '1';
    }, 120);
    _recLastCaption = f.caption;
  }
  document.getElementById('recChapter').textContent = 'ROUND 0' + f.round;
  document.getElementById('recChapterSub').textContent = (f.round === 3 ? 'Turning point' : f.round === 5 ? 'The finish' : 'Round ' + f.round);
  document.getElementById('recTc').textContent = f.tc;

  // Fire event flash once per keyframe crossing
  if (f.event && f.prevIdx !== _recLastEventIdx){
    spawnHitFlash(f.event);
    _recLastEventIdx = f.prevIdx;
  }

  // Progress bar
  const frac = clamp(time / REC_TOTAL, 0, 1);
  document.getElementById('recProgressFill').style.width = (frac * 100) + '%';

  // Time readout
  const elapsedMin = Math.floor(time / 60);
  const elapsedSec = Math.floor(time % 60);
  const elapsedStr = `${String(elapsedMin).padStart(2,'0')}:${String(elapsedSec).padStart(2,'0')}`;
  document.getElementById('recTime').textContent = `${elapsedStr} / 01:40`;

  // Finish overlay when done
  const fin = document.getElementById('recFinishOverlay');
  if (fin){
    if (time >= REC_TOTAL - 0.3) fin.classList.add('show');
    else fin.classList.remove('show');
  }

  // Active round button
  document.querySelectorAll('[data-recjump]').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.recjump, 10) === (f.round - 1));
  });
}

function recTick(){
  if (!_recPlaying) return;
  const now = performance.now() / 1000;
  const dt = now - _recLastFrameT;
  _recDt = dt;
  _recLastFrameT = now;
  _recTime += dt * _recSpeed;
  if (_recTime >= REC_TOTAL){
    _recTime = REC_TOTAL;
    applyRecFrame(_recTime);
    recPause();
    return;
  }
  applyRecFrame(_recTime);
  requestAnimationFrame(recTick);
}

function recPlay(){
  if (_recTime >= REC_TOTAL) _recTime = 0;
  _recPlaying = true;
  _recLastFrameT = performance.now() / 1000;
  const btn = document.getElementById('recPlayBtn');
  btn.textContent = '❚❚ PAUSE';
  btn.classList.add('paused');
  requestAnimationFrame(recTick);
}
function recPause(){
  _recPlaying = false;
  const btn = document.getElementById('recPlayBtn');
  btn.textContent = '▶ PLAY';
  btn.classList.remove('paused');
}
function recToggle(){ _recPlaying ? recPause() : recPlay(); }

function recSeek(fraction){
  _recTime = clamp(fraction, 0, 1) * REC_TOTAL;
  _recLastEventIdx = -1;  // allow re-firing if scrubbed backward
  applyRecFrame(_recTime);
  // Reset last-event tracker to match current keyframe
  const f = getRecFrameAt(_recTime);
  _recLastEventIdx = f.prevIdx;
}

function recJumpToRound(roundIdx){
  const start = REC_ROUND_STARTS[roundIdx] || 0;
  recSeek(start / REC_TOTAL);
  if (!_recPlaying) recPlay();
}

function recCycleSpeed(){
  _recSpeedIdx = (_recSpeedIdx + 1) % REC_SPEEDS.length;
  _recSpeed = REC_SPEEDS[_recSpeedIdx];
  document.getElementById('recSpeedBtn').textContent = _recSpeed.toFixed(1) + '×';
}

/* -----------------------------------------------------------
   THREE.JS · 3D RECREATION RENDERER
   Reads joint positions from hidden SVG, renders as 3D cylinders
----------------------------------------------------------- */
const REC_3D = { ready: false };

function init3DScene(){
  if (typeof THREE === 'undefined') { console.warn('[3D] Three.js not loaded — skipping'); return; }
  const canvas = document.getElementById('recCanvas3d');
  if (!canvas) return;
  try {
  const stage = canvas.parentElement;
  const W = stage.clientWidth || 900;
  const H = stage.clientHeight || 440;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04050a);
  scene.fog = new THREE.FogExp2(0x04050a, 0.025);

  const camera = new THREE.PerspectiveCamera(50, W/H, 0.1, 100);
  camera.position.set(0, 1.6, 12);
  camera.lookAt(0, 1.0, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  // Lighting
  scene.add(new THREE.AmbientLight(0x303850, 0.5));
  const topLight = new THREE.DirectionalLight(0xe8ecf5, 0.7);
  topLight.position.set(0, 10, 4);
  topLight.castShadow = true;
  topLight.shadow.mapSize.set(1024, 1024);
  topLight.shadow.camera.near = 0.5; topLight.shadow.camera.far = 20;
  topLight.shadow.camera.left = -8; topLight.shadow.camera.right = 8;
  topLight.shadow.camera.top = 6; topLight.shadow.camera.bottom = -1;
  scene.add(topLight);

  const rimLight = new THREE.DirectionalLight(0x2ddcff, 0.25);
  rimLight.position.set(0, 3, -6);
  scene.add(rimLight);

  const redPt = new THREE.PointLight(0xff2d3f, 1.0, 6);
  const bluePt = new THREE.PointLight(0x2db4ff, 1.0, 6);
  redPt.position.set(-2, 1.5, 1);
  bluePt.position.set(2, 1.5, 1);
  scene.add(redPt); scene.add(bluePt);

  // Ground
  const gMat = new THREE.MeshStandardMaterial({ color: 0x080a12, roughness: 0.92, metalness: 0.05 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), gMat);
  ground.rotation.x = -Math.PI/2; ground.position.y = -0.08; ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(16, 32, 0x151b28, 0x0a0e1a);
  grid.position.y = -0.07;
  scene.add(grid);

  // Cage posts + fence hint
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a3045, metalness: 0.3, roughness: 0.7 });
  [-4.5, 4.5].forEach(x => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.5, 8), postMat);
    post.position.set(x, 1.75, 0); post.castShadow = true;
    scene.add(post);
    // Fence horizontal wires
    for (let h = 0.3; h < 3.2; h += 0.5){
      const wireMat = new THREE.LineBasicMaterial({ color: 0x12182a, transparent: true, opacity: 0.4 });
      const pts = [new THREE.Vector3(x, h, -1.5), new THREE.Vector3(x, h, 1.5)];
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
    }
  });

  // Fighter mesh factory
  function makeLimb(color, radius){
    const geo = new THREE.CylinderGeometry(radius, radius*0.9, 1, 8);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, roughness: 0.55, metalness: 0.15 });
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; scene.add(m); return m;
  }
  function makeJoint(color, r){
    const geo = new THREE.SphereGeometry(r, 10, 10);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5 });
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; scene.add(m); return m;
  }
  function createFighter(col){
    const lr = 0.035;
    return {
      rearShin: makeLimb(col, lr), rearThigh: makeLimb(col, lr*1.2),
      leadShin: makeLimb(col, lr), leadThigh: makeLimb(col, lr*1.2),
      torso: makeLimb(col, lr*1.8), shoulders: makeLimb(col, lr*1.3),
      rearUpper: makeLimb(col, lr*.9), rearFore: makeLimb(col, lr*.8),
      leadUpper: makeLimb(col, lr*.9), leadFore: makeLimb(col, lr*.8),
      neck: makeLimb(col, lr*.7),
      hip: makeJoint(col, .055), chest: makeJoint(col, .055),
      rearKnee: makeJoint(col, .045), leadKnee: makeJoint(col, .045),
      shLead: makeJoint(col, .04), shRear: makeJoint(col, .04),
      elbowLead: makeJoint(col, .035), elbowRear: makeJoint(col, .035),
      fistLead: makeJoint(col, .045), fistRear: makeJoint(col, .045),
      head: makeJoint(col, .14)
    };
  }

  Object.assign(REC_3D, {
    scene, camera, renderer,
    redF: createFighter(0xff2d3f), blueF: createFighter(0x2db4ff),
    redPt, bluePt,
    particles: [], shakeAmt: 0,
    baseCamPos: camera.position.clone(), baseCamLook: new THREE.Vector3(0, 1.0, 0),
    ready: true
  });

  new ResizeObserver(() => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (w < 1 || h < 1) return;
    camera.aspect = w/h; camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }).observe(stage);
  } catch(err) {
    console.error('[3D] init failed (WebGL may not be supported):', err.message);
    // Fall back: show SVG instead
    const svg = document.getElementById('recStage');
    if (svg) svg.style.display = '';
    if (canvas) canvas.style.display = 'none';
  }
}

// Position a cylinder between two 3D points
const _tmpDir = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
const _tmpUp = typeof THREE !== 'undefined' ? new THREE.Vector3(0,1,0) : null;
const _tmpQuat = typeof THREE !== 'undefined' ? new THREE.Quaternion() : null;
function posLimb3D(mesh, ax,ay,az, bx,by,bz){
  if (!_tmpDir) return; // Three.js not loaded
  const dx=bx-ax, dy=by-ay, dz=bz-az;
  const len = Math.sqrt(dx*dx+dy*dy+dz*dz);
  if (len < 0.001){ mesh.visible=false; return; }
  mesh.visible = true;
  mesh.position.set((ax+bx)/2, (ay+by)/2, (az+bz)/2);
  mesh.scale.y = len;
  _tmpDir.set(dx,dy,dz).normalize();
  if (Math.abs(_tmpDir.dot(_tmpUp)) > 0.9999){
    mesh.quaternion.identity();
    if (_tmpDir.y < 0) mesh.rotation.x = Math.PI;
  } else {
    _tmpQuat.setFromUnitVectors(_tmpUp, _tmpDir);
    mesh.quaternion.copy(_tmpQuat);
  }
}

// Read SVG joints → place 3D meshes
function update3DFighter(prefix, meshes, dir){
  const S = 0.01;
  const CX = 550;
  const GY_OFFSET = 0.06; // lift everything slightly above ground plane
  const zLead = dir * 0.22;  // lead limbs closer to camera
  const zRear = dir * -0.18; // rear limbs further

  function sv(id, a){ const e = document.getElementById(id); return e ? parseFloat(e.getAttribute(a))||0 : 0; }
  function toX(svgX){ return (svgX - CX) * S; }
  function toY(svgY){ return Math.max((REC_GROUND_Y - svgY) * S + GY_OFFSET, GY_OFFSET); }

  // Detect lying state: if hip (torso y1) is very close to ground
  const hipSvgY = sv(prefix + '-torso', 'y1');
  const isLying = (REC_GROUND_Y - hipSvgY) < 30;

  // When lying, spread z more for visibility from audience angle
  const zSpread = isLying ? 1.8 : 1.0;

  const limbMap = {
    rearShin:  { z1: zRear * zSpread, z2: zRear * zSpread },
    rearThigh: { z1: zRear * zSpread, z2: 0 },
    leadShin:  { z1: zLead * zSpread, z2: zLead * zSpread },
    leadThigh: { z1: zLead * zSpread, z2: 0 },
    torso:     { z1: 0, z2: 0 },
    shoulders: { z1: zLead * zSpread * 0.5, z2: zRear * zSpread * 0.5 },
    rearUpper: { z1: zRear * zSpread * 0.8, z2: zRear * zSpread * 0.8 },
    rearFore:  { z1: zRear * zSpread * 0.8, z2: zRear * zSpread * 0.8 },
    leadUpper: { z1: zLead * zSpread * 0.8, z2: zLead * zSpread * 0.8 },
    leadFore:  { z1: zLead * zSpread * 0.8, z2: zLead * zSpread * 0.8 },
    neck:      { z1: 0, z2: 0 }
  };

  Object.keys(limbMap).forEach(name => {
    const id = prefix + '-' + name;
    const lz = limbMap[name];
    posLimb3D(meshes[name],
      toX(sv(id,'x1')), toY(sv(id,'y1')), lz.z1,
      toX(sv(id,'x2')), toY(sv(id,'y2')), lz.z2);
  });

  // Joints
  const setJ = (m, id, a1, a2, z) => m.position.set(toX(sv(id,a1)), toY(sv(id,a2)), z||0);
  setJ(meshes.hip, prefix+'-torso', 'x1','y1', 0);
  setJ(meshes.chest, prefix+'-torso', 'x2','y2', 0);
  setJ(meshes.rearKnee, prefix+'-rearShin', 'x2','y2', zRear * zSpread);
  setJ(meshes.leadKnee, prefix+'-leadShin', 'x2','y2', zLead * zSpread);
  setJ(meshes.shLead, prefix+'-leadUpper', 'x1','y1', zLead * zSpread * 0.8);
  setJ(meshes.shRear, prefix+'-rearUpper', 'x1','y1', zRear * zSpread * 0.8);
  setJ(meshes.elbowLead, prefix+'-leadFore', 'x1','y1', zLead * zSpread * 0.8);
  setJ(meshes.elbowRear, prefix+'-rearFore', 'x1','y1', zRear * zSpread * 0.8);
  setJ(meshes.fistLead, prefix+'-leadFore', 'x2','y2', zLead * zSpread);
  setJ(meshes.fistRear, prefix+'-rearFore', 'x2','y2', zRear * zSpread);

  // Head
  const hx = sv(prefix+'-head','cx'), hy = sv(prefix+'-head','cy');
  const hr = (sv(prefix+'-head','r') || 20) * S;
  meshes.head.position.set(toX(hx), toY(hy), 0);
  meshes.head.scale.setScalar(hr / 0.14);

  // Fighter point light follows chest
  return { x: meshes.chest.position.x, y: meshes.chest.position.y };
}

// Particle burst (impact sparks)
function spawn3DParticles(worldX, worldY, color, count){
  if (!REC_3D.ready) return;
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
  for (let i = 0; i < count; i++){
    const geo = new THREE.SphereGeometry(0.025 + Math.random() * 0.02, 6, 6);
    const m = new THREE.Mesh(geo, mat.clone());
    m.position.set(worldX + (Math.random()-.5)*.2, worldY + (Math.random()-.5)*.2, (Math.random()-.5)*.3);
    m._vel = new THREE.Vector3((Math.random()-.5)*3, Math.random()*2+1, (Math.random()-.5)*2);
    m._life = 1.0;
    REC_3D.scene.add(m);
    REC_3D.particles.push(m);
  }
}
function updateParticles(dt){
  if (!REC_3D.ready) return;
  for (let i = REC_3D.particles.length - 1; i >= 0; i--){
    const m = REC_3D.particles[i];
    m._life -= dt * 2.5;
    if (m._life <= 0){
      REC_3D.scene.remove(m);
      m.geometry.dispose(); m.material.dispose();
      REC_3D.particles.splice(i, 1);
      continue;
    }
    m._vel.y -= 9.8 * dt;  // gravity
    m.position.addScaledVector(m._vel, dt);
    m.material.opacity = m._life;
    m.scale.setScalar(m._life);
    if (m.position.y < 0) { m.position.y = 0; m._vel.y *= -0.3; m._vel.x *= 0.8; m._vel.z *= 0.8; }
  }
}

// Camera shake
function trigger3DShake(intensity){
  if (!REC_3D.ready) return;
  REC_3D.shakeAmt = intensity;
}
function updateCameraShake(){
  if (!REC_3D.ready) return;
  const c = REC_3D.camera;
  const base = REC_3D.baseCamPos;
  if (REC_3D.shakeAmt > 0.01){
    const a = REC_3D.shakeAmt;
    c.position.set(
      base.x + (Math.random()-.5) * a * 0.3,
      base.y + (Math.random()-.5) * a * 0.15,
      base.z + (Math.random()-.5) * a * 0.1
    );
    REC_3D.shakeAmt *= 0.88;  // decay
  } else {
    c.position.copy(base);
    REC_3D.shakeAmt = 0;
  }
  c.lookAt(REC_3D.baseCamLook);
}

// Main 3D render call (called from applyRecFrame)
function render3DFrame(dt){
  if (!REC_3D.ready) return;
  // Update fighter meshes from SVG joint data
  const rPos = update3DFighter('rR', REC_3D.redF, 1);
  const bPos = update3DFighter('rB', REC_3D.blueF, -1);

  // Point lights follow fighters
  REC_3D.redPt.position.set(rPos.x, rPos.y + 0.5, 1.5);
  REC_3D.bluePt.position.set(bPos.x, bPos.y + 0.5, 1.5);

  updateParticles(dt || 0.016);
  updateCameraShake();
  REC_3D.renderer.render(REC_3D.scene, REC_3D.camera);
}

/* -----------------------------------------------------------
   RECREATION · FULLSCREEN
----------------------------------------------------------- */
function _recFsEl(){
  return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
}
function recToggleFullscreen(){
  const panel = document.querySelector('.recreation-panel');
  if (!panel) return;
  if (!_recFsEl()){
    const req = panel.requestFullscreen || panel.webkitRequestFullscreen || panel.msRequestFullscreen;
    if (req){
      const p = req.call(panel);
      if (p && p.catch) p.catch(err => console.warn('Fullscreen rejected:', err && err.message));
      // Auto-play on entering fullscreen if paused and not yet at end
      if (!_recPlaying && _recTime < REC_TOTAL - 0.1) recPlay();
    }
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (exit) exit.call(document);
  }
}
// Update FS button label on state change
['fullscreenchange','webkitfullscreenchange','msfullscreenchange'].forEach(evName => {
  document.addEventListener(evName, () => {
    const btn = document.getElementById('recFsBtn');
    if (!btn) return;
    const panel = document.querySelector('.recreation-panel');
    const inFs = _recFsEl() === panel;
    btn.innerHTML = inFs ? '⛶× EXIT' : '⛶ FS';
    btn.classList.toggle('active', inFs);
  });
});

function setupRecreation(){
  _recPartsR = cachePartsFor('rR');
  _recPartsB = cachePartsFor('rB');

  // Initialize Three.js 3D scene
  init3DScene();

  // Render initial frame
  applyRecFrame(0);

  // Button wiring
  document.getElementById('recPlayBtn').addEventListener('click', recToggle);
  document.getElementById('recSpeedBtn').addEventListener('click', recCycleSpeed);
  const fsBtn = document.getElementById('recFsBtn');
  if (fsBtn) fsBtn.addEventListener('click', recToggleFullscreen);

  // Progress bar click/drag
  const prog = document.getElementById('recProgress');
  prog.addEventListener('click', e => {
    const rect = prog.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    recSeek(frac);
  });

  // Round jump buttons
  document.querySelectorAll('[data-recjump]').forEach(btn => {
    btn.addEventListener('click', () => recJumpToRound(parseInt(btn.dataset.recjump, 10)));
  });

  // Keyboard shortcuts
  // F globally toggles fullscreen when recreation is visible or already fullscreen
  // When recreation is fullscreen: Space toggles play/pause, arrows seek ±3s
  document.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const panel = document.querySelector('.recreation-panel');
    if (!panel) return;
    const isFs = _recFsEl() === panel;
    const rect = panel.getBoundingClientRect();
    const inView = rect.top < window.innerHeight * 0.7 && rect.bottom > window.innerHeight * 0.3;

    // F key · toggle fullscreen (requires panel in view or already fs)
    if ((e.key === 'f' || e.key === 'F') && (isFs || inView)){
      e.preventDefault();
      recToggleFullscreen();
      return;
    }

    // When fullscreen · priority keys
    if (isFs){
      if (e.key === ' '){
        e.preventDefault();
        recToggle();
      } else if (e.key === 'ArrowRight'){
        e.preventDefault();
        recSeek(Math.min(1, (_recTime + 3) / REC_TOTAL));
      } else if (e.key === 'ArrowLeft'){
        e.preventDefault();
        recSeek(Math.max(0, (_recTime - 3) / REC_TOTAL));
      }
    }
  });

  // Auto-play when scrolled into view for first time
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting && !_recPlaying && _recTime < 1){
        recPlay();
        obs.disconnect();
      }
    });
  }, { threshold: 0.3 });
  const stage = document.querySelector('.rec-stage');
  if (stage) obs.observe(stage);
}

/* -----------------------------------------------------------
   FIGHT DATABASE · MULTI-EVENT SELECTOR
----------------------------------------------------------- */
const FIGHTS = {
  ufc245: {
    event: 'UFC 245 · Welterweight Title', date: 'Dec 14, 2019', venue: 'T-Mobile Arena, Las Vegas',
    red: { tag:'Red Corner · Champion', nick:'"The Nigerian Nightmare"', name:'Kamaru<br>Usman', record:'<strong>15 – 1 – 0</strong> · 10-0 UFC', style:'Pressure Wrestler · Power Striker' },
    blue: { tag:'Blue Corner · Challenger', nick:'"Chaos"', name:'Colby<br>Covington', record:'<strong>15 – 1 – 0</strong> · 10-1 UFC', style:'Volume Striker · Elite Wrestler' },
    result: 'TKO · R5 4:10', full: true
  }
};

let _currentFight = 'ufc245';

// Sections that require full UFC 245 data
const SCOPED_SECTIONS = ['tape','result','totals','rounds','targets','accuracy','positions','timeline','geometry','biomech','pace','aftermath'];

function selectFight(fightId){
  const fight = FIGHTS[fightId];
  if (!fight) return;
  _currentFight = fightId;

  // Update selector chips
  document.querySelectorAll('.fight-chip').forEach(c => c.classList.toggle('active', c.dataset.fight === fightId));

  // ── RESET ALL ANIMATIONS & COUNTERS ──

  // Recreation: pause + reset to start
  try {
    if (_recPlaying) recPause();
    _recTime = 0;
    _recLastEventIdx = -1;
    _recLastCaption = '';
    _trailInited = false;
    const fin = document.getElementById('recFinishOverlay');
    if (fin) fin.classList.remove('show');
    const progFill = document.getElementById('recProgressFill');
    if (progFill) progFill.style.width = '0%';
    const recTimeEl = document.getElementById('recTime');
    if (recTimeEl) recTimeEl.textContent = '00:00 / 01:40';
    const capEl = document.getElementById('recCaption');
    if (capEl) capEl.textContent = 'Ready · Press play';
    const chEl = document.getElementById('recChapter');
    if (chEl) chEl.textContent = 'ROUND 01';
    const playBtn = document.getElementById('recPlayBtn');
    if (playBtn){ playBtn.textContent = '▶ PLAY'; playBtn.classList.remove('paused'); }
    // Reset fighter poses to frame 0
    if (_recPartsR && _recPartsB) applyRecFrame(0);
    // Clear 3D particles
    if (REC_3D.ready && REC_3D.particles) {
      REC_3D.particles.forEach(p => { REC_3D.scene.remove(p); p.geometry.dispose(); p.material.dispose(); });
      REC_3D.particles.length = 0;
      REC_3D.shakeAmt = 0;
    }
  } catch(e){ console.warn('[reset] recreation:', e.message); }

  // Octagon: reset to phase 0
  try {
    if (_octTimer) clearTimeout(_octTimer);
    _octIdx = 0;
    _octPaused = false;
    applyOctPhase(0);
    const octBtn = document.getElementById('octPlayPause');
    if (octBtn){ octBtn.textContent = '❚❚'; octBtn.classList.remove('paused'); }
    // Restart the loop
    octLoopStart();
  } catch(e){ console.warn('[reset] octagon:', e.message); }

  // Spotlight: clear any active filter
  try { if (_spotlight) setSpotlight(null); } catch(e){}

  // Round buttons: reset active state
  document.querySelectorAll('[data-recjump]').forEach(btn => btn.classList.remove('active'));

  // Close any open panels
  try {
    document.getElementById('fighterPanel').style.display = 'none';
    document.getElementById('comparePanel').classList.remove('show');
  } catch(e){}

  // ── UPDATE HERO TEXT ──
  const setHtml = (id, html) => { const e = document.getElementById(id); if (e) e.innerHTML = html; };
  setHtml('heroEvent', fight.event);
  setHtml('heroRedTag', fight.red.tag + ' <span class="dot"></span>');
  setHtml('heroRedNick', fight.red.nick);
  setHtml('heroRedName', fight.red.name);
  setHtml('heroRedRecord', fight.red.record);
  setHtml('heroRedStyle', fight.red.style);
  setHtml('heroBlueTag', '<span class="dot"></span> ' + fight.blue.tag);
  setHtml('heroBlueNick', fight.blue.nick);
  setHtml('heroBlueName', fight.blue.name);
  setHtml('heroBlueRecord', fight.blue.record);
  setHtml('heroBlueStyle', fight.blue.style);

  // ── SCOPE DETAILED SECTIONS ──
  // Hide generic stats panel when viewing full UFC 245 breakdown
  const gsp = document.getElementById('genericStatsPanel');
  if (gsp) gsp.style.display = 'none';

  if (fight.full){
    SCOPED_SECTIONS.forEach(id => {
      const sec = document.getElementById(id);
      if (sec){ sec.style.opacity = ''; sec.style.pointerEvents = ''; }
    });
    document.querySelectorAll('.scope-msg').forEach(e => e.classList.remove('show'));
  } else {
    SCOPED_SECTIONS.forEach(id => {
      const sec = document.getElementById(id);
      if (sec){ sec.style.opacity = '0.18'; sec.style.pointerEvents = 'none'; }
    });
    document.querySelectorAll('.scope-msg').forEach(e => e.classList.add('show'));
  }

  // Scroll to top
  document.getElementById('hero').scrollIntoView({ behavior: 'smooth' });
}

function setupFightSelector(){
  // Populate event dropdown from API
  const dropdown = document.getElementById('eventDropdown');
  const strip = document.getElementById('eventFightStrip');

  fetch('/api/events').then(r=>r.json()).then(events => {
    const numbered = events.filter(e => e.number).sort((a,b) => b.number - a.number);
    dropdown.innerHTML = '<option value="">— Select Event —</option>' +
      numbered.map(e =>
        '<option value="' + e.id + '" data-num="' + e.number + '"' +
        (e.number === 245 ? ' selected' : '') + '>' +
        'UFC ' + e.number +
        '</option>'
      ).join('');
    // Auto-load UFC 245
    const ufc245 = numbered.find(e => e.number === 245);
    if (ufc245) loadEventFightStrip(ufc245.id);
  }).catch(() => {
    dropdown.innerHTML = '<option value="">Error loading</option>';
  });

  dropdown.addEventListener('change', function(){
    const eventId = this.value;
    if (!eventId) {
      strip.innerHTML = '<span style="font-family:var(--f-mono);font-size:9px;color:var(--muted-dim)">Select an event</span>';
      return;
    }
    loadEventFightStrip(parseInt(eventId, 10));
  });

  // Fighter search autocomplete
  const input = document.getElementById('fighterSearch');
  const results = document.getElementById('searchResults');
  let searchTimeout = null;

  input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = input.value.trim();
    if (q.length < 2){ results.style.display = 'none'; return; }
    searchTimeout = setTimeout(async () => {
      try {
        const res = await fetch('/api/fighters/search?q=' + encodeURIComponent(q));
        const fighters = await res.json();
        if (!fighters.length){
          results.innerHTML = '<div style="padding:10px 14px;color:var(--muted);font-family:var(--f-mono);font-size:10px">No fighters found</div>';
        } else {
          results.innerHTML = fighters.map(f =>
            '<div class="search-result" data-fid="' + f.id + '" style="padding:8px 14px;cursor:pointer;' +
            'font-family:var(--f-mono);font-size:11px;letter-spacing:.1em;color:var(--fg-dim);' +
            'border-bottom:1px solid var(--border-soft);transition:background .15s;display:flex;align-items:center"' +
            ' onmouseover="this.style.background=\'rgba(45,220,255,.06)\'"' +
            ' onmouseout="this.style.background=\'none\'">' +
            '<div style="flex:1">' +
            '<strong style="color:var(--fg)">' + escHtml(f.name) + '</strong>' +
            (f.nickname ? ' <span style="color:var(--muted)">"' + escHtml(f.nickname) + '"</span>' : '') +
            ' <span style="color:var(--muted-dim);font-size:9px;margin-left:8px">' + escHtml(f.weight_class) + '</span>' +
            '</div>' +
            '<button class="add-compare-btn" data-cfid="' + f.id + '" data-cfname="' + escHtml(f.name) +
            '" data-cfnick="' + escHtml(f.nickname||'') + '" data-cfwc="' + escHtml(f.weight_class) +
            '" onclick="event.stopPropagation();addToCompare(this.dataset)">⊕</button>' +
            '</div>'
          ).join('');
        }
        results.style.display = 'block';

        results.querySelectorAll('.search-result').forEach(el => {
          el.addEventListener('click', () => {
            const fid = el.dataset.fid;
            results.style.display = 'none';
            input.value = el.querySelector('strong').textContent;
            loadFighterEvents(fid);
          });
        });
      } catch(e){ console.error('search error', e); }
    }, 250);
  });

  // Close panel
  document.getElementById('closeFighterPanel').addEventListener('click', () => {
    document.getElementById('fighterPanel').style.display = 'none';
  });
}

// Load fight card into the horizontal strip
async function loadEventFightStrip(eventId){
  const strip = document.getElementById('eventFightStrip');
  strip.innerHTML = '<span style="font-family:var(--f-mono);font-size:9px;color:var(--muted-dim)">Loading…</span>';
  try {
    const res = await fetch('/api/events/' + eventId + '/card');
    const data = await res.json();
    if (!data.card || !data.card.length) {
      strip.innerHTML = '<span style="font-family:var(--f-mono);font-size:9px;color:var(--muted-dim)">No fights</span>';
      return;
    }
    strip.innerHTML = data.card.map((f,i) => {
      const isWR = f.winner_id === f.red_id;
      const isWB = f.winner_id === f.blue_id;
      const isDraw = !f.winner_id;
      const method = (f.method||'').replace('KO/TKO','TKO').replace('U-DEC','DEC').replace('S-DEC','SDEC').replace('M-DEC','MDEC').replace('CNC','NC');
      let label;
      if (isDraw) {
        label = escHtml(f.red_name.split(' ').pop()) +
          ' <span style="color:var(--muted-dim);font-size:8px">vs</span> ' +
          escHtml(f.blue_name.split(' ').pop());
      } else {
        const wName = isWR ? f.red_name.split(' ').pop() : f.blue_name.split(' ').pop();
        const lName = isWR ? f.blue_name.split(' ').pop() : f.red_name.split(' ').pop();
        label = '<span style="color:var(--green);font-weight:700">' + escHtml(wName) + '</span>' +
          ' <span style="color:var(--muted-dim);font-size:8px">def</span> ' + escHtml(lName);
      }
      const mainAttr = (i === 0 && f.is_main) ? ' data-main="1"' : '';
      return '<button class="fight-chip" data-dbfight="' + f.id + '" data-event="' + data.event.number + '"' + mainAttr + ' onclick="selectDbFight(' + f.id + ',this)">' +
        label +
        '<br><span style="font-size:8px;color:var(--muted)">' + escHtml(method) + (isDraw ? '' : ' R' + (f.round||'')) + '</span>' +
        '</button>';
    }).join('');

    // Auto-select the main event chip (or first chip if no main)
    const mainChip = strip.querySelector('.fight-chip[data-main="1"]') || strip.querySelector('.fight-chip');
    if (mainChip) mainChip.click();
    updateFightStripScrollState(strip);
  } catch(e){
    strip.innerHTML = '<span style="font-family:var(--f-mono);font-size:9px;color:var(--red)">Error</span>';
  }
}

function updateFightStripScrollState(strip){
  if (!strip) return;
  const max = strip.scrollWidth - strip.clientWidth;
  if (max <= 1) {
    strip.classList.add('at-start','at-end');
    return;
  }
  strip.classList.toggle('at-start', strip.scrollLeft <= 1);
  strip.classList.toggle('at-end', strip.scrollLeft >= max - 1);
}

(function wireFightStripScroll(){
  const strip = document.getElementById('eventFightStrip');
  if (!strip) return;
  strip.addEventListener('scroll', () => updateFightStripScrollState(strip), { passive:true });
  window.addEventListener('resize', () => updateFightStripScrollState(strip));
})();

// Render a generic stats panel for any fight with stats data
function renderGenericStatsPanel(f) {
  const panel = document.getElementById('genericStatsPanel');
  const body = document.getElementById('gspBody');
  if (!panel || !body) return;

  const hasStats = f.stats && f.stats.length >= 2;
  const hasRounds = f.has_round_stats && f.round_stats && f.round_stats.length > 0;
  if (!hasStats && !hasRounds) { panel.style.display = 'none'; return; }

  const setHtml = (id, html) => { const e = document.getElementById(id); if (e) e.innerHTML = html; };
  setHtml('gspTitle', escHtml(f.red_name) + ' vs ' + escHtml(f.blue_name));
  setHtml('gspSub', 'UFC ' + (f.event_number || '') + ' · ' + escHtml(f.method || '') +
    (f.round ? ' R' + f.round : '') + (f.time ? ' ' + escHtml(f.time) : '') +
    ' · Source: UFCStats.com');

  let html = '';

  // -- Totals table --
  if (hasStats) {
    const rs = f.stats.find(s => s.fighter_id === f.red_fighter_id) || f.stats[0];
    const bs = f.stats.find(s => s.fighter_id === f.blue_fighter_id) || f.stats[1];
    const rName = escHtml((f.red_name || '').split(' ').pop());
    const bName = escHtml((f.blue_name || '').split(' ').pop());

    const rSig = rs.sig_str_landed || 0;
    const bSig = bs.sig_str_landed || 0;
    const rSigAtt = rs.sig_str_attempted || 0;
    const bSigAtt = bs.sig_str_attempted || 0;
    const rAcc = rSigAtt > 0 ? Math.round(rSig / rSigAtt * 100) : 0;
    const bAcc = bSigAtt > 0 ? Math.round(bSig / bSigAtt * 100) : 0;
    const rKd = rs.knockdowns || 0;
    const bKd = bs.knockdowns || 0;
    const rTd = rs.takedowns_landed || 0;
    const bTd = bs.takedowns_landed || 0;
    const rTdAtt = rs.takedowns_attempted || 0;
    const bTdAtt = bs.takedowns_attempted || 0;
    const rCtrl = rs.control_time_sec || 0;
    const bCtrl = bs.control_time_sec || 0;
    const fmtCtrl = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">';

    // Totals card
    html += '<div style="background:var(--bg-card);border:1px solid var(--border);padding:20px">' +
      '<div style="font-family:var(--f-disp);font-size:14px;font-weight:700;letter-spacing:.15em;margin-bottom:14px;color:var(--fg)">STRIKING TOTALS</div>' +
      '<table style="width:100%;font-family:var(--f-mono);font-size:11px;letter-spacing:.06em;border-collapse:collapse">' +
      '<thead><tr style="color:var(--muted);font-size:9px;letter-spacing:.15em">' +
      '<th style="text-align:left;padding:4px 0">STAT</th>' +
      '<th style="text-align:center;padding:4px 0;color:var(--red)">' + rName + '</th>' +
      '<th style="text-align:center;padding:4px 0;color:var(--blue)">' + bName + '</th></tr></thead><tbody>';

    const statRow = (label, rv, bv, hi) => {
      const rStyle = hi && rv > bv ? 'color:var(--green);font-weight:700' : 'color:var(--fg)';
      const bStyle = hi && bv > rv ? 'color:var(--green);font-weight:700' : 'color:var(--fg)';
      return '<tr style="border-top:1px solid var(--border-soft)"><td style="padding:6px 0;color:var(--muted)">' + label + '</td>' +
        '<td style="text-align:center;padding:6px 0;' + rStyle + '">' + rv + '</td>' +
        '<td style="text-align:center;padding:6px 0;' + bStyle + '">' + bv + '</td></tr>';
    };

    html += statRow('Sig. Strikes', rSig + '/' + rSigAtt, bSig + '/' + bSigAtt, false);
    html += statRow('Accuracy', rAcc + '%', bAcc + '%', true);
    html += statRow('Knockdowns', rKd, bKd, true);
    html += statRow('Takedowns', rTd + '/' + rTdAtt, bTd + '/' + bTdAtt, false);
    html += statRow('Control Time', fmtCtrl(rCtrl), fmtCtrl(bCtrl), true);
    html += statRow('Sub. Attempts', rs.sub_attempts || 0, bs.sub_attempts || 0, true);
    html += '</tbody></table></div>';

    // Target distribution card
    const rHead = rs.head_landed || 0;
    const rBody = rs.body_landed || 0;
    const rLeg = rs.leg_landed || 0;
    const bHead = bs.head_landed || 0;
    const bBody = bs.body_landed || 0;
    const bLeg = bs.leg_landed || 0;
    const rTotal = rHead + rBody + rLeg || 1;
    const bTotal = bHead + bBody + bLeg || 1;

    html += '<div style="background:var(--bg-card);border:1px solid var(--border);padding:20px">' +
      '<div style="font-family:var(--f-disp);font-size:14px;font-weight:700;letter-spacing:.15em;margin-bottom:14px;color:var(--fg)">TARGET DISTRIBUTION</div>';

    const targetBar = (name, color, head, body, leg, total) => {
      const hPct = Math.round(head / total * 100);
      const bPct = Math.round(body / total * 100);
      const lPct = Math.round(leg / total * 100);
      return '<div style="margin-bottom:14px">' +
        '<div style="font-family:var(--f-mono);font-size:10px;letter-spacing:.12em;color:' + color + ';margin-bottom:6px">' + name + '</div>' +
        '<div style="display:flex;gap:2px;height:18px;margin-bottom:4px">' +
        '<div style="flex:' + hPct + ';background:' + color + ';opacity:.9;border-radius:2px 0 0 2px"></div>' +
        '<div style="flex:' + bPct + ';background:' + color + ';opacity:.55"></div>' +
        '<div style="flex:' + lPct + ';background:' + color + ';opacity:.3;border-radius:0 2px 2px 0"></div></div>' +
        '<div style="font-family:var(--f-mono);font-size:10px;color:var(--muted);letter-spacing:.08em">' +
        'Head ' + hPct + '% (' + head + ') · Body ' + bPct + '% (' + body + ') · Leg ' + lPct + '% (' + leg + ')</div></div>';
    };

    html += targetBar(rName, 'var(--red)', rHead, rBody, rLeg, rTotal);
    html += targetBar(bName, 'var(--blue)', bHead, bBody, bLeg, bTotal);
    html += '</div></div>';
  }

  // -- Per-round table --
  if (hasRounds) {
    const rounds = {};
    f.round_stats.forEach(rs => {
      if (!rounds[rs.round]) rounds[rs.round] = {};
      if (rs.fighter_id === f.red_fighter_id) rounds[rs.round].red = rs;
      else rounds[rs.round].blue = rs;
    });
    const rNums = Object.keys(rounds).map(Number).sort();
    const rName = escHtml((f.red_name || '').split(' ').pop());
    const bName = escHtml((f.blue_name || '').split(' ').pop());

    html += '<div style="background:var(--bg-card);border:1px solid var(--border);padding:20px;margin-top:0">' +
      '<div style="font-family:var(--f-disp);font-size:14px;font-weight:700;letter-spacing:.15em;margin-bottom:14px;color:var(--fg)">ROUND-BY-ROUND</div>' +
      '<table style="width:100%;font-family:var(--f-mono);font-size:10px;letter-spacing:.06em;border-collapse:collapse">' +
      '<thead><tr style="color:var(--muted);font-size:9px;letter-spacing:.15em">' +
      '<th style="text-align:left;padding:4px 0">RD</th>' +
      '<th style="text-align:center;padding:4px 0;color:var(--red)">' + rName + ' SIG</th>' +
      '<th style="text-align:center;padding:4px 0;color:var(--blue)">' + bName + ' SIG</th>' +
      '<th style="text-align:center;padding:4px 0">KD</th>' +
      '<th style="text-align:center;padding:4px 0">TD</th>' +
      '<th style="text-align:center;padding:4px 0">CTRL</th></tr></thead><tbody>';

    const fmtCtrl = (s) => s > 0 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : '-';

    for (const rn of rNums) {
      const r = rounds[rn];
      const rSig = (r.red ? r.red.sig_str_landed : 0) || 0;
      const bSig = (r.blue ? r.blue.sig_str_landed : 0) || 0;
      const rKd = (r.red ? r.red.kd : 0) || 0;
      const bKd = (r.blue ? r.blue.kd : 0) || 0;
      const rTd = (r.red ? r.red.td_landed : 0) || 0;
      const bTd = (r.blue ? r.blue.td_landed : 0) || 0;
      const rCtrl = (r.red ? r.red.ctrl_sec : 0) || 0;
      const bCtrl = (r.blue ? r.blue.ctrl_sec : 0) || 0;

      html += '<tr style="border-top:1px solid var(--border-soft)">' +
        '<td style="padding:5px 0;color:var(--muted)">R' + rn + '</td>' +
        '<td style="text-align:center;padding:5px 0;color:' + (rSig > bSig ? 'var(--green)' : 'var(--fg)') + '">' + rSig + '</td>' +
        '<td style="text-align:center;padding:5px 0;color:' + (bSig > rSig ? 'var(--green)' : 'var(--fg)') + '">' + bSig + '</td>' +
        '<td style="text-align:center;padding:5px 0;color:var(--fg)">' +
          (rKd > 0 ? '<span style="color:var(--red)">' + rKd + '</span>' : '') +
          (rKd > 0 && bKd > 0 ? '/' : '') +
          (bKd > 0 ? '<span style="color:var(--blue)">' + bKd + '</span>' : '') +
          (rKd === 0 && bKd === 0 ? '-' : '') + '</td>' +
        '<td style="text-align:center;padding:5px 0;color:var(--fg)">' +
          (rTd > 0 ? '<span style="color:var(--red)">' + rTd + '</span>' : '') +
          (rTd > 0 && bTd > 0 ? '/' : '') +
          (bTd > 0 ? '<span style="color:var(--blue)">' + bTd + '</span>' : '') +
          (rTd === 0 && bTd === 0 ? '-' : '') + '</td>' +
        '<td style="text-align:center;padding:5px 0;color:var(--fg)">' +
          (rCtrl > 0 || bCtrl > 0 ? fmtCtrl(rCtrl) + '/' + fmtCtrl(bCtrl) : '-') + '</td></tr>';
    }
    html += '</tbody></table></div>';
  }

  body.innerHTML = html;
  panel.style.display = 'block';
}

// Select a fight from the DB and update the dashboard hero
async function selectDbFight(fightId, chipEl){
  document.querySelectorAll('.fight-chip').forEach(c => c.classList.remove('active'));
  if (chipEl) chipEl.classList.add('active');

  // Check if this is the hardcoded UFC 245 main event
  const eventNum = chipEl ? parseInt(chipEl.dataset.event, 10) : 0;
  if (eventNum === 245 && chipEl && chipEl.dataset.main === '1' && FIGHTS.ufc245) {
    selectFight('ufc245');
    return;
  }

  try {
    const res = await fetch('/api/fights/' + fightId + '/rounds');
    const f = await res.json();
    const titleTag = f.is_title ? ' · ' + (f.weight_class||'') + ' Title' : '';

    const setHtml = (id, html) => { const e = document.getElementById(id); if (e) e.innerHTML = html; };
    setHtml('heroEvent', 'UFC ' + (f.event_number||'') + titleTag);
    setHtml('heroRedTag', 'Red Corner <span class="dot"></span>');
    setHtml('heroRedNick', f.red_nickname ? '&ldquo;' + escHtml(f.red_nickname) + '&rdquo;' : '');
    setHtml('heroRedName', escHtml(f.red_name));
    setHtml('heroRedRecord', (f.red_height ? f.red_height + 'cm' : '') + (f.red_reach ? ' · ' + f.red_reach + 'cm reach' : ''));
    setHtml('heroRedStyle', f.red_stance ? escHtml(f.red_stance) + (f.red_nationality ? ' · ' + escHtml(f.red_nationality) : '') : '');

    setHtml('heroBlueTag', '<span class="dot"></span> Blue Corner');
    setHtml('heroBlueNick', f.blue_nickname ? '&ldquo;' + escHtml(f.blue_nickname) + '&rdquo;' : '');
    setHtml('heroBlueName', escHtml(f.blue_name));
    setHtml('heroBlueRecord', (f.blue_height ? f.blue_height + 'cm' : '') + (f.blue_reach ? ' · ' + f.blue_reach + 'cm reach' : ''));
    setHtml('heroBlueStyle', f.blue_stance ? escHtml(f.blue_stance) + (f.blue_nationality ? ' · ' + escHtml(f.blue_nationality) : '') : '');

    // Dim hardcoded sections
    SCOPED_SECTIONS.forEach(id => {
      const sec = document.getElementById(id);
      if (sec){ sec.style.opacity = '0.18'; sec.style.pointerEvents = 'none'; }
    });
    document.querySelectorAll('.scope-msg').forEach(e => e.classList.add('show'));

    // Show generic stats panel if fight has data
    renderGenericStatsPanel(f);

    try {
      document.getElementById('fighterPanel').style.display = 'none';
      document.getElementById('comparePanel').classList.remove('show');
    } catch(e){}

    document.getElementById('hero').scrollIntoView({ behavior: 'smooth' });
  } catch(e){ console.warn('[selectDbFight]', e.message); }
}

// Load a fighter's event history
async function loadFighterEvents(fighterId){
  const panel = document.getElementById('fighterPanel');
  const title = document.getElementById('fighterPanelTitle');
  const body = document.getElementById('fighterPanelBody');

  panel.style.display = 'block';
  title.textContent = 'Loading…';
  body.innerHTML = '';

  try {
    const [fighterRes, eventsRes] = await Promise.all([
      fetch('/api/fighters/' + fighterId),
      fetch('/api/fighters/' + fighterId + '/events')
    ]);
    const fighter = await fighterRes.json();
    const events = await eventsRes.json();

    title.innerHTML = fighter.name +
      (fighter.nickname ? ' <span style="color:var(--muted);font-weight:400">"' + fighter.nickname + '"</span>' : '') +
      ' <span style="color:var(--cyan);font-size:12px;margin-left:12px">' + (fighter.weight_class || '') + '</span>';

    if (!events.length){
      body.innerHTML = '<div style="color:var(--muted);font-family:var(--f-mono);font-size:11px">No UFC numbered events found in database</div>';
      return;
    }

    body.innerHTML = events.map(ev =>
      '<div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border-soft)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
          '<div style="font-family:var(--f-disp);font-size:16px;font-weight:600;letter-spacing:.08em;color:var(--fg)">' +
            'UFC ' + ev.number + '</div>' +
          '<div style="font-family:var(--f-mono);font-size:10px;letter-spacing:.12em;color:var(--muted)">' +
            ev.date + ' · ' + ev.city + '</div>' +
        '</div>' +
        '<div style="font-family:var(--f-mono);font-size:10px;color:var(--muted-dim);margin-bottom:10px;letter-spacing:.1em">' +
          ev.name + ' · ' + ev.venue + '</div>' +
        ev.fights.map(f => {
          const won = f.winner_id === parseInt(fighterId, 10);
          const isRedCorner = f.red_id === parseInt(fighterId, 10);
          return '<div class="event-fight-row" data-eid="' + ev.event_id + '" style="display:flex;align-items:center;gap:12px;' +
            'padding:8px 12px;cursor:pointer;transition:background .15s;margin-bottom:2px;' +
            'border-left:3px solid ' + (won ? 'var(--green)' : 'var(--red)') + '"' +
            ' onmouseover="this.style.background=\'rgba(45,220,255,.04)\'"' +
            ' onmouseout="this.style.background=\'none\'">' +
            '<span style="font-family:var(--f-mono);font-size:9px;color:' + (won ? 'var(--green)' : 'var(--red)') +
              ';font-weight:700;min-width:14px">' + (won ? 'W' : 'L') + '</span>' +
            '<span style="font-family:var(--f-mono);font-size:11px;color:var(--fg);flex:1">' +
              (isRedCorner ? '<span style="color:#FF5965">' + f.red_name + '</span> vs ' + f.blue_name :
                f.red_name + ' vs <span style="color:#5EC2FF">' + f.blue_name + '</span>') +
            '</span>' +
            (f.is_title ? '<span style="font-size:8px;border:1px solid var(--amber);color:var(--amber);padding:1px 5px;font-family:var(--f-mono);letter-spacing:.12em">TITLE</span>' : '') +
            '<span style="font-family:var(--f-mono);font-size:10px;color:var(--muted)">' +
              f.method + ' R' + f.round + ' ' + f.time + '</span>' +
          '</div>';
        }).join('') +
        '<button class="rec-btn" onclick="loadEventCard(' + ev.event_id + ')" style="margin-top:8px;font-size:10px">' +
          'View Full Card · UFC ' + ev.number + '</button>' +
      '</div>'
    ).join('');
  } catch(e){
    body.innerHTML = '<div style="color:var(--red)">Error loading fighter data</div>';
    console.error(e);
  }
}

// Load full event card
async function loadEventCard(eventId){
  const body = document.getElementById('fighterPanelBody');
  const title = document.getElementById('fighterPanelTitle');

  try {
    const res = await fetch('/api/events/' + eventId + '/card');
    const data = await res.json();

    title.innerHTML = data.event.name +
      ' <span style="color:var(--muted);font-weight:400;font-size:12px">' + data.event.date + ' · ' + data.event.venue + '</span>';

    body.innerHTML = '<div style="font-family:var(--f-mono);font-size:9px;letter-spacing:.18em;color:var(--muted);margin-bottom:14px;text-transform:uppercase">' +
      'Full Card · ' + data.card.length + ' fights</div>' +
      data.card.map((f, i) =>
        '<div style="display:flex;align-items:center;gap:14px;padding:10px 14px;' +
          'border-bottom:1px solid var(--border-soft);cursor:pointer;transition:background .15s"' +
          ' onmouseover="this.style.background=\'rgba(45,220,255,.04)\'"' +
          ' onmouseout="this.style.background=\'none\'"' +
          ' onclick="loadFighterEvents(' + f.red_id + ')">' +
          '<span style="font-family:var(--f-mono);font-size:9px;color:var(--muted-dim);min-width:20px">' + (i+1) + '</span>' +
          '<div style="flex:1">' +
            '<div style="font-family:var(--f-mono);font-size:12px;letter-spacing:.08em">' +
              '<span style="color:#FF5965;font-weight:600">' + f.red_name + '</span>' +
              ' <span style="color:var(--muted)">vs</span> ' +
              '<span style="color:#5EC2FF;font-weight:600">' + f.blue_name + '</span>' +
            '</div>' +
            '<div style="font-family:var(--f-mono);font-size:9px;color:var(--muted);margin-top:3px;letter-spacing:.1em">' +
              f.weight_class + (f.is_title ? ' · TITLE FIGHT' : '') + '</div>' +
          '</div>' +
          '<div style="text-align:right">' +
            '<div style="font-family:var(--f-mono);font-size:11px;color:var(--fg);letter-spacing:.1em">' +
              f.method + '</div>' +
            '<div style="font-family:var(--f-mono);font-size:9px;color:var(--muted);letter-spacing:.1em">' +
              'R' + f.round + ' ' + f.time + '</div>' +
          '</div>' +
        '</div>'
      ).join('');
  } catch(e){
    body.innerHTML = '<div style="color:var(--red)">Error loading event card</div>';
    console.error(e);
  }
}

/* -----------------------------------------------------------
   FIGHTER COMPARISON
----------------------------------------------------------- */
const _compareSlots = [null, null];

function addToCompare(dataset){
  const fighter = { id: dataset.cfid, name: dataset.cfname, nickname: dataset.cfnick, weight_class: dataset.cfwc };
  if (_compareSlots[0] && _compareSlots[0].id === fighter.id) return;
  if (_compareSlots[1] && _compareSlots[1].id === fighter.id) return;
  if (!_compareSlots[0]) _compareSlots[0] = fighter;
  else if (!_compareSlots[1]) _compareSlots[1] = fighter;
  else { _compareSlots[0] = _compareSlots[1]; _compareSlots[1] = fighter; }
  renderCompareSlots();
  document.getElementById('comparePanel').classList.add('show');
  document.getElementById('searchResults').style.display = 'none';
  if (_compareSlots[0] && _compareSlots[1]) fetchComparison();
}

function clearCompareSlot(idx){
  _compareSlots[idx] = null;
  renderCompareSlots();
  document.getElementById('compareBody').style.display = 'none';
}

function renderCompareSlots(){
  [0,1].forEach(i => {
    const slot = document.getElementById('compareSlot' + (i+1));
    const f = _compareSlots[i];
    if (f){
      slot.classList.add('filled');
      slot.innerHTML =
        '<div class="compare-slot__name" style="color:' + (i===0?'#FF5965':'#5EC2FF') + '">' + f.name + '</div>' +
        (f.nickname ? '<div class="compare-slot__meta">"' + f.nickname + '"</div>' : '') +
        '<div class="compare-slot__meta">' + (f.weight_class||'') + '</div>' +
        '<div class="compare-slot__clear" onclick="clearCompareSlot(' + i + ')">Remove ×</div>';
    } else {
      slot.classList.remove('filled');
      slot.innerHTML = '<div class="compare-slot__empty">Search + click ⊕ to add</div>';
    }
  });
}

async function fetchComparison(){
  const body = document.getElementById('compareBody');
  body.style.display = 'block';
  body.innerHTML = '<div style="text-align:center;padding:20px;font-family:var(--f-mono);font-size:11px;color:var(--muted)">Loading comparison…</div>';
  try {
    const res = await fetch('/api/fighters/' + _compareSlots[0].id + '/compare/' + _compareSlots[1].id);
    const data = await res.json();
    renderComparison(data);
  } catch(e){
    body.innerHTML = '<div style="color:var(--red);text-align:center;padding:20px">Error loading comparison</div>';
  }
}

function renderComparison(data){
  const body = document.getElementById('compareBody');
  const f1 = data.fighters[0], f2 = data.fighters[1];
  const s1 = f1.career_stats || {}, s2 = f2.career_stats || {};

  function compRow(label, v1, v2, maxVal){
    const n1 = parseFloat(v1)||0, n2 = parseFloat(v2)||0;
    const mx = maxVal || Math.max(n1, n2, 1);
    const p1 = Math.min((n1/mx*100),100).toFixed(0), p2 = Math.min((n2/mx*100),100).toFixed(0);
    const hl1 = n1 >= n2 ? 'font-weight:700' : 'opacity:.55';
    const hl2 = n2 >= n1 ? 'font-weight:700' : 'opacity:.55';
    return '<div class="compare-row">' +
      '<div style="text-align:right;padding-right:8px">' +
        '<div class="compare-val compare-val--left" style="' + hl1 + '">' + v1 + '</div>' +
        '<div class="compare-bar" style="justify-content:flex-end"><div class="compare-bar__left" style="width:' + p1 + '%"></div></div>' +
      '</div>' +
      '<div class="compare-label">' + label + '</div>' +
      '<div style="text-align:left;padding-left:8px">' +
        '<div class="compare-val compare-val--right" style="' + hl2 + '">' + v2 + '</div>' +
        '<div class="compare-bar"><div class="compare-bar__right" style="width:' + p2 + '%"></div></div>' +
      '</div></div>';
  }

  let html = '';

  // Physical
  html += '<div class="compare-section-title">Physical Profile</div>';
  html += compRow('Height', f1.height_cm+'cm', f2.height_cm+'cm', 210);
  html += compRow('Reach', f1.reach_cm+'cm', f2.reach_cm+'cm', 210);
  html += '<div class="compare-row">' +
    '<div class="compare-val compare-val--left">' + f1.stance + '</div>' +
    '<div class="compare-label">Stance</div>' +
    '<div class="compare-val compare-val--right">' + f2.stance + '</div></div>';
  html += compRow('Reach Adv.', (f1.reach_cm-f2.reach_cm>0?'+':'') + (f1.reach_cm-f2.reach_cm)+'cm',
    (f2.reach_cm-f1.reach_cm>0?'+':'') + (f2.reach_cm-f1.reach_cm)+'cm', 20);

  // Record
  html += '<div class="compare-section-title">Record (in database)</div>';
  html += compRow('Wins', f1.record.wins, f2.record.wins);
  html += compRow('Losses', f1.record.losses, f2.record.losses);

  // Career striking
  if ((s1.total_fights||0) > 0 || (s2.total_fights||0) > 0){
    html += '<div class="compare-section-title">Striking (career in DB)</div>';
    html += compRow('Sig. Landed', s1.total_sig_landed||0, s2.total_sig_landed||0);
    html += compRow('Accuracy', (s1.sig_accuracy_pct||0)+'%', (s2.sig_accuracy_pct||0)+'%', 100);
    html += compRow('Avg/Fight', s1.avg_sig_per_fight||0, s2.avg_sig_per_fight||0);
    html += compRow('Knockdowns', s1.total_knockdowns||0, s2.total_knockdowns||0);
    html += compRow('KD Rate', (s1.avg_kd_per_fight||0)+'/f', (s2.avg_kd_per_fight||0)+'/f', 3);

    html += '<div class="compare-section-title">Grappling</div>';
    html += compRow('Takedowns', s1.total_td_landed||0, s2.total_td_landed||0);
    html += compRow('TD Accuracy', (s1.td_accuracy_pct||0)+'%', (s2.td_accuracy_pct||0)+'%', 100);
    html += compRow('Control', Math.round((s1.total_control_sec||0)/60)+'m', Math.round((s2.total_control_sec||0)/60)+'m');
    html += compRow('Sub Att.', s1.total_sub_attempts||0, s2.total_sub_attempts||0);

    html += '<div class="compare-section-title">Target Distribution</div>';
    html += compRow('Head', s1.total_head||0, s2.total_head||0);
    html += compRow('Body', s1.total_body||0, s2.total_body||0);
    html += compRow('Leg', s1.total_leg||0, s2.total_leg||0);

    html += '<div class="compare-section-title">Position</div>';
    html += compRow('Distance', s1.total_distance||0, s2.total_distance||0);
    html += compRow('Clinch', s1.total_clinch||0, s2.total_clinch||0);
    html += compRow('Ground', s1.total_ground||0, s2.total_ground||0);
  }

  // Biomechanics
  if (f1.biomechanics && f2.biomechanics){
    html += '<div class="compare-section-title">Biomechanics · Right Cross</div>';
    html += compRow('Est. Force', f1.biomechanics.force_n+'N', f2.biomechanics.force_n+'N', 3000);
    html += compRow('Fist Velocity', f1.biomechanics.velocity_ms+' m/s', f2.biomechanics.velocity_ms+' m/s', 12);
    // Threshold comparison
    const t = f1.biomechanics.thresholds || [];
    t.forEach(th => {
      const th2 = (f2.biomechanics.thresholds||[]).find(x => x.target === th.target);
      if (th2) html += compRow(th.target, th.ratio+'×', th2.ratio+'×', 2);
    });
    html += '<div style="text-align:center;font-family:var(--f-mono);font-size:9px;color:var(--muted-dim);margin-top:6px;letter-spacing:.1em">' +
      'Allometric scaling · mass^0.67 · ' + f1.biomechanics.citation + '</div>';
  }

  // Head-to-head
  if (data.head_to_head && data.head_to_head.length > 0){
    html += '<div class="compare-section-title">Head-to-Head · ' + data.head_to_head.length + ' fight(s)</div>';
    html += data.head_to_head.map(f => {
      const w1 = f.winner_id === parseInt(_compareSlots[0].id,10);
      return '<div class="h2h-fight">' +
        '<span class="h2h-fight__event">UFC ' + f.event_number + '</span>' +
        '<span class="h2h-fight__result" style="color:' + (w1?'#FF5965':'#5EC2FF') + '">' +
          (w1 ? _compareSlots[0].name.split(' ').pop() : _compareSlots[1].name.split(' ').pop()) + ' W</span>' +
        '<span class="h2h-fight__method">' + f.method + (f.method_detail ? ' · '+f.method_detail : '') + '</span>' +
        '<span style="font-family:var(--f-mono);font-size:10px;color:var(--muted)">R' + f.round + ' ' + f.time + '</span></div>';
    }).join('');
  } else {
    html += '<div class="compare-section-title">Head-to-Head</div>' +
      '<div style="font-family:var(--f-mono);font-size:11px;color:var(--muted);padding:10px 0">No recorded fights between these fighters</div>';
  }

  body.innerHTML = html;
}

function setupComparePanel(){
  document.getElementById('closeCompare').addEventListener('click', () => document.getElementById('comparePanel').classList.remove('show'));
  document.getElementById('clearCompare').addEventListener('click', () => {
    _compareSlots[0] = null; _compareSlots[1] = null;
    renderCompareSlots();
    document.getElementById('compareBody').style.display = 'none';
  });
}

/* -----------------------------------------------------------
   PRIMARY TABS — Events, Fighters, Stats, Dashboard
----------------------------------------------------------- */
let _tabsLoaded = {};

function setupPrimaryTabs(){
  document.querySelectorAll('.primary-tab').forEach(tab => {
    tab.addEventListener('click', () => activatePrimaryTab(tab.dataset.tab));
  });
  // Exit-ramp CTAs on dashboard bottom
  document.querySelectorAll('[data-nav-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activatePrimaryTab(btn.dataset.navTab);
      window.scrollTo({ top:0, behavior:'smooth' });
    });
  });
  document.querySelectorAll('[data-nav-scroll]').forEach(btn => {
    btn.addEventListener('click', () => {
      const el = document.getElementById(btn.dataset.navScroll);
      if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
    });
  });
  restoreStoredView();
  window.addEventListener('beforeunload', () => setStoredViewState(getCurrentViewState()));
}

function activatePrimaryTab(target, opts = {}){
  const tab = document.querySelector('.primary-tab[data-tab="' + target + '"]');
  if (!tab) return;
  document.querySelectorAll('.primary-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  const panel = document.getElementById('tab-' + target);
  if (panel) panel.classList.add('active');
  if (target === 'events' && !_tabsLoaded.events) { loadEventsTab(); _tabsLoaded.events = true; }
  if (target === 'fighters' && !_tabsLoaded.fighters) { loadFightersTab(); _tabsLoaded.fighters = true; }
  if (target === 'stats' && !_tabsLoaded.stats) { loadStatsTab(); _tabsLoaded.stats = true; }
  if (target === 'review' && !_tabsLoaded.review) { loadReviewTab(); _tabsLoaded.review = true; }
  if (opts.persist !== false) {
    setStoredViewState({ tab: target });
    updateViewHash(target, target === 'picks' && _picksState ? _picksState.view : null);
  }
  // Leaving Picks → clear subview TC override so other tabs use their own labels
  if (target !== 'picks' && _tcForceSet) _tcForceSet(null);
  // Entering Picks → re-apply the current subview TC + maybe auto-open create modal
  if (target === 'picks') {
    if (_tcForceSet && typeof PICKS_TC_LABEL !== 'undefined') {
      _tcForceSet(PICKS_TC_LABEL[_picksState ? _picksState.view : 'upcoming'] || 'YOUR PICKS');
    }
    if (_picksFeatureEnabled && !_currentUser && !_picksAutoPrompted) {
      _picksAutoPrompted = true;
      setTimeout(() => { if (!_currentUser) openCreateProfileModal(null); }, 120);
    }
  }
}

// ── Events Tab — Inline Accordion ──
let _allEventsData = [];
let _openEventId = null;
let _openFightId = null;

async function loadEventsTab(){
  const tbody = document.getElementById('eventsTableBody');
  const countEl = document.getElementById('eventCount');
  tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);padding:20px;text-align:center">Loading events…</td></tr>';
  try {
    const res = await fetch('/api/events');
    _allEventsData = await res.json();
    countEl.textContent = _allEventsData.length + ' events';
    renderEventsTable(_allEventsData);
    document.getElementById('eventSearchInput').addEventListener('input', function(){
      const q = this.value.toLowerCase();
      const filtered = _allEventsData.filter(e => (e.name||'').toLowerCase().includes(q) || String(e.number).includes(q));
      renderEventsTable(filtered);
    });
  } catch(e){ tbody.innerHTML = '<tr><td colspan="5" style="color:var(--red)">Error loading events</td></tr>'; }
}

function renderEventsTable(events){
  const tbody = document.getElementById('eventsTableBody');
  _openEventId = null;
  _openFightId = null;
  tbody.innerHTML = events.map(e =>
    '<tr class="evt-row" data-eid="' + e.id + '" data-enum="' + e.number + '" onclick="toggleEventCard(' + e.id + ',' + e.number + ',this)">' +
    '<td><span class="evt-arrow">▸</span></td>' +
    '<td class="evt-num">' + (e.number||'—') + '</td>' +
    '<td class="evt-title">' + escHtml(e.name) + '</td>' +
    '<td>' + escHtml(e.date||'') + '</td>' +
    '<td>' + escHtml((e.city||'') + (e.country ? ', '+e.country : '')) + '</td>' +
    '</tr>'
  ).join('');
}

async function toggleEventCard(eventId, eventNum, rowEl){
  // If same event clicked, close it
  if (_openEventId === eventId) {
    const existing = rowEl.nextElementSibling;
    if (existing && existing.classList.contains('evt-card-row')) {
      existing.remove();
      rowEl.classList.remove('open');
    }
    _openEventId = null;
    return;
  }

  // Close any previously open event
  document.querySelectorAll('tr.evt-row.open').forEach(r => {
    r.classList.remove('open');
    const next = r.nextElementSibling;
    if (next && next.classList.contains('evt-card-row')) next.remove();
  });

  rowEl.classList.add('open');
  _openEventId = eventId;
  _openFightId = null;

  // Insert card row right after the event row
  const cardRow = document.createElement('tr');
  cardRow.className = 'evt-card-row';
  cardRow.innerHTML = '<td colspan="5"><div class="evt-card-inner" id="card-' + eventId + '">' +
    '<div style="padding:12px;color:var(--muted);font-family:var(--f-mono);font-size:10px">Loading card…</div></div></td>';
  rowEl.after(cardRow);

  // Trigger open animation
  requestAnimationFrame(() => {
    const inner = document.getElementById('card-' + eventId);
    if (inner) inner.classList.add('open');
  });

  try {
    const res = await fetch('/api/events/' + eventId + '/card');
    const data = await res.json();
    const inner = document.getElementById('card-' + eventId);
    if (!inner) return;

    let html = '<div class="evt-card-header">' +
      '<div class="evt-card-header__title">' + escHtml(data.event.name) + '</div>' +
      '<div class="evt-card-header__meta">' + escHtml(data.event.date||'') + ' · ' +
        escHtml((data.event.city||'') + (data.event.country ? ', '+data.event.country : '')) + '</div></div>';

    if (!data.card.length) {
      html += '<div style="color:var(--muted-dim);font-family:var(--f-mono);font-size:11px;padding:8px 0">No fights found</div>';
    } else {
      html += data.card.map((f, i) => {
        const isWR = f.winner_id === f.red_id;
        const isWB = f.winner_id === f.blue_id;
        return '<div class="fight-row" id="frow-' + f.id + '" onclick="event.stopPropagation();toggleFightDetail(' + f.id + ',this)">' +
          '<div class="fight-row__pos">' + (i+1) + '</div>' +
          '<div class="fight-row__names">' +
            (f.is_title ? '<span class="fight-row__title-badge">TITLE</span>' : '') +
            '<span' + (isWR?' class="fight-row__winner"':'') + '>' + escHtml(f.red_name) + '</span>' +
            ' <span style="color:var(--muted-dim)">vs</span> ' +
            '<span' + (isWB?' class="fight-row__winner"':'') + '>' + escHtml(f.blue_name) + '</span>' +
          '</div>' +
          '<div class="fight-row__wc">' + escHtml(f.weight_class||'').replace("Women's ",'W-') + '</div>' +
          '<div class="fight-row__result">' + escHtml(f.method||'') + ' R' + (f.round||'') + ' ' + escHtml(f.time||'') + '</div>' +
        '</div>' +
        '<div class="fight-detail-drop" id="fdrop-' + f.id + '"></div>';
      }).join('');
    }
    inner.innerHTML = html;
  } catch(e){
    const inner = document.getElementById('card-' + eventId);
    if (inner) inner.innerHTML = '<div style="color:var(--red);padding:8px">Error loading card</div>';
  }
}

async function toggleFightDetail(fightId, rowEl){
  const drop = document.getElementById('fdrop-' + fightId);
  if (!drop) return;

  // If same fight, close it
  if (_openFightId === fightId) {
    drop.classList.remove('open');
    drop.innerHTML = '';
    rowEl.classList.remove('open');
    _openFightId = null;
    return;
  }

  // Close previous fight
  if (_openFightId) {
    const prevDrop = document.getElementById('fdrop-' + _openFightId);
    const prevRow = document.getElementById('frow-' + _openFightId);
    if (prevDrop) { prevDrop.classList.remove('open'); prevDrop.innerHTML = ''; }
    if (prevRow) prevRow.classList.remove('open');
  }

  rowEl.classList.add('open');
  _openFightId = fightId;
  drop.innerHTML = '<div style="padding:12px;color:var(--muted);font-family:var(--f-mono);font-size:10px">Loading…</div>';
  drop.classList.add('open');

  try {
    const [fightRes, tacRes] = await Promise.all([
      fetch('/api/fights/' + fightId + '/rounds'),
      fetch('/api/fights/' + fightId + '/tactical')
    ]);
    const f = await fightRes.json();
    const tac = await tacRes.json();

    let html = '<div class="fight-detail-drop__header">' +
      '<div class="fight-detail-drop__names">' +
        '<span style="color:#FF5965">' + escHtml(f.red_name) + '</span>' +
        ' <span style="color:var(--muted-dim);font-size:12px;font-family:var(--f-mono)">vs</span> ' +
        '<span style="color:#5EC2FF">' + escHtml(f.blue_name) + '</span>' +
      '</div>' +
      '<div style="text-align:right;font-family:var(--f-mono);font-size:10px;color:var(--muted)">' +
        escHtml(f.method||'') + ' · R' + (f.round||'') + ' ' + escHtml(f.time||'') +
        (f.referee ? '<br>Ref: ' + escHtml(f.referee) : '') +
      '</div></div>';

    // Fight totals
    if (f.stats && f.stats.length >= 2) {
      const s1 = f.stats.find(s => s.fighter_id === f.red_fighter_id) || f.stats[0];
      const s2 = f.stats.find(s => s.fighter_id === f.blue_fighter_id) || f.stats[1];
      html += '<div style="font-family:var(--f-mono);font-size:10px;letter-spacing:.15em;color:var(--cyan);margin:10px 0 6px;text-transform:uppercase">Fight Totals</div>';
      html += buildTotalsRow(s1, s2);
    }

    // Per-round stats
    if (f.has_round_stats && f.round_stats && f.round_stats.length > 0) {
      html += '<div style="font-family:var(--f-mono);font-size:10px;letter-spacing:.15em;color:var(--cyan);margin:14px 0 6px;text-transform:uppercase">Per-Round Stats</div>';
      html += buildRoundTable(f.round_stats, f.red_fighter_id, f.blue_fighter_id, f.red_name, f.blue_name);
    } else if (!f.stats || f.stats.length < 2) {
      html += '<div style="margin-top:12px"><span class="badge-no-stats">Stats unavailable</span></div>';
    }

    // Tactical breakdown
    if (tac && tac.sections) {
      html += renderTacticalBreakdown(tac);
    }

    drop.innerHTML = html;
  } catch(e){
    drop.innerHTML = '<div style="color:var(--red);padding:8px">Error: ' + escHtml(e.message) + '</div>';
  }
}

function renderTacticalBreakdown(tac){
  let html = '<div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px">' +
    '<div style="font-family:var(--f-disp);font-size:16px;font-weight:700;letter-spacing:.08em;color:var(--fg);margin-bottom:14px">Tactical Breakdown</div>';

  for (const section of tac.sections) {
    html += '<div style="margin-bottom:14px">' +
      '<div style="font-family:var(--f-mono);font-size:10px;letter-spacing:.15em;color:var(--cyan);text-transform:uppercase;margin-bottom:6px;border-bottom:1px solid var(--border-soft);padding-bottom:4px">' +
      escHtml(section.title) + (section.source ? ' <span style="color:var(--muted-dim);font-size:8px">· ' + escHtml(section.source) + '</span>' : '') +
      '</div>';

    for (const item of (section.items || [])) {
      const advColor = item.advantage === 'red' ? '#FF5965' : item.advantage === 'blue' ? '#5EC2FF' : 'var(--fg-dim)';
      html += '<div style="display:flex;gap:8px;padding:3px 0;font-family:var(--f-mono);font-size:11px;border-bottom:1px solid rgba(255,255,255,.02)">' +
        '<div style="min-width:120px;color:var(--muted);font-size:9px;letter-spacing:.1em;padding-top:2px">' + escHtml(item.label) + '</div>' +
        '<div style="flex:1">' +
          '<div style="color:' + advColor + '">' + escHtml(item.value) + '</div>' +
          (item.detail ? '<div style="font-size:9px;color:var(--muted-dim);margin-top:1px">' + escHtml(item.detail) + '</div>' : '') +
          (item.note ? '<div style="font-size:9px;color:var(--muted);margin-top:1px;font-style:italic">' + escHtml(item.note) + '</div>' : '') +
        '</div></div>';
    }
    html += '</div>';
  }

  // Key factors
  if (tac.key_factors && tac.key_factors.length) {
    html += '<div style="margin-top:8px;padding:10px 12px;background:rgba(45,220,255,.04);border-left:2px solid var(--cyan)">' +
      '<div style="font-family:var(--f-mono);font-size:9px;letter-spacing:.15em;color:var(--cyan);text-transform:uppercase;margin-bottom:6px">Key Factors</div>';
    tac.key_factors.forEach(f => {
      html += '<div style="font-family:var(--f-mono);font-size:10px;color:var(--fg-dim);padding:2px 0">· ' + escHtml(f) + '</div>';
    });
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function buildTotalsRow(s1, s2){
  function row(label, v1, v2){ 
    return '<tr><td class="r-red" style="text-align:right;padding:3px 8px">' + v1 + '</td>' +
      '<td style="text-align:center;padding:3px 8px;color:var(--muted);font-size:9px;letter-spacing:.12em">' + label + '</td>' +
      '<td class="r-blue" style="text-align:left;padding:3px 8px">' + v2 + '</td></tr>';
  }
  return '<table style="width:100%;font-family:var(--f-mono);font-size:11px;border-collapse:collapse">' +
    row('Sig. Str.', (s1.sig_str_landed||0)+' / '+(s1.sig_str_attempted||0), (s2.sig_str_landed||0)+' / '+(s2.sig_str_attempted||0)) +
    row('Knockdowns', s1.knockdowns||0, s2.knockdowns||0) +
    row('Takedowns', (s1.takedowns_landed||0)+' / '+(s1.takedowns_attempted||0), (s2.takedowns_landed||0)+' / '+(s2.takedowns_attempted||0)) +
    row('Control', Math.floor((s1.control_time_sec||0)/60)+'m '+((s1.control_time_sec||0)%60)+'s', Math.floor((s2.control_time_sec||0)/60)+'m '+((s2.control_time_sec||0)%60)+'s') +
    row('Sub. Att.', s1.sub_attempts||0, s2.sub_attempts||0) +
    row('Head', s1.head_landed||0, s2.head_landed||0) +
    row('Body', s1.body_landed||0, s2.body_landed||0) +
    row('Leg', s1.leg_landed||0, s2.leg_landed||0) +
    '</table>';
}

function buildRoundTable(roundStats, redId, blueId, redName, blueName){
  // Group by round
  const rounds = {};
  roundStats.forEach(rs => {
    if (!rounds[rs.round]) rounds[rs.round] = {};
    if (rs.fighter_id === redId) rounds[rs.round].red = rs;
    else rounds[rs.round].blue = rs;
  });
  const rNums = Object.keys(rounds).map(Number).sort();
  if (!rNums.length) return '';

  let html = '<table class="round-table"><thead><tr>' +
    '<th>Round</th><th>Fighter</th><th>KD</th><th>Sig.Str</th><th>Total</th><th>TD</th><th>Sub</th><th>Ctrl</th>' +
    '<th>Head</th><th>Body</th><th>Leg</th><th>Dist</th><th>Clinch</th><th>Gnd</th>' +
    '</tr></thead><tbody>';

  for (const rn of rNums) {
    const r = rounds[rn];
    const renderRow = (s, name, cls) => {
      if (!s) return '<tr><td class="r-label">R' + rn + '</td><td class="' + cls + '">' + escHtml(name) + '</td>' +
        '<td colspan="12" style="color:var(--muted-dim)">—</td></tr>';
      const ctrl = s.ctrl_sec ? Math.floor(s.ctrl_sec/60)+':'+String(s.ctrl_sec%60).padStart(2,'0') : '0:00';
      return '<tr><td class="r-label">R' + rn + '</td><td class="' + cls + '" style="text-align:left;font-size:9px">' + escHtml(name.split(' ').pop()) + '</td>' +
        '<td>' + (s.kd||0) + '</td>' +
        '<td>' + (s.sig_str_landed||0) + '/' + (s.sig_str_attempted||0) + '</td>' +
        '<td>' + (s.total_str_landed||0) + '/' + (s.total_str_attempted||0) + '</td>' +
        '<td>' + (s.td_landed||0) + '/' + (s.td_attempted||0) + '</td>' +
        '<td>' + (s.sub_att||0) + '</td>' +
        '<td>' + ctrl + '</td>' +
        '<td>' + (s.head_landed||0) + '/' + (s.head_attempted||0) + '</td>' +
        '<td>' + (s.body_landed||0) + '/' + (s.body_attempted||0) + '</td>' +
        '<td>' + (s.leg_landed||0) + '/' + (s.leg_attempted||0) + '</td>' +
        '<td>' + (s.distance_landed||0) + '/' + (s.distance_attempted||0) + '</td>' +
        '<td>' + (s.clinch_landed||0) + '/' + (s.clinch_attempted||0) + '</td>' +
        '<td>' + (s.ground_landed||0) + '/' + (s.ground_attempted||0) + '</td></tr>';
    };
    html += renderRow(r.red, redName, 'r-red');
    html += renderRow(r.blue, blueName, 'r-blue');
  }
  html += '</tbody></table>';
  return html;
}

// ── Fighters Tab ──
let _allFightersData = [];
async function loadFightersTab(){
  const dir = document.getElementById('fighterDir');
  dir.innerHTML = '<div style="color:var(--muted);font-family:var(--f-mono);font-size:11px">Loading fighters…</div>';
  try {
    const res = await fetch('/api/fighters?limit=500');
    _allFightersData = await res.json();
    renderFighterDir(_allFightersData);
    document.getElementById('fighterDirSearch').addEventListener('input', function(){
      const q = this.value.toLowerCase();
      renderFighterDir(_allFightersData.filter(f => f.name.toLowerCase().includes(q) || (f.nickname||'').toLowerCase().includes(q)));
    });
  } catch(e){ dir.innerHTML = '<div style="color:var(--red)">Error loading fighters</div>'; }
}

function renderFighterDir(fighters){
  const dir = document.getElementById('fighterDir');
  dir.innerHTML = fighters.map(f => {
    const hasAnyMeta = f.weight_class || f.height_cm || f.reach_cm || f.stance;
    const metaHtml = hasAnyMeta
      ? '<div class="fighter-card__meta">' +
          (f.weight_class ? escHtml(f.weight_class) : '—') + ' · ' +
          (f.height_cm ? f.height_cm + 'cm' : '—') + ' · ' +
          (f.reach_cm ? f.reach_cm + 'cm reach' : '—') + ' · ' +
          (f.stance ? escHtml(f.stance) : '—') +
        '</div>'
      : '<div class="fighter-card__meta fighter-card__meta--empty">No profile data</div>';
    const nickHtml = '<div class="fighter-card__nick">' +
      (f.nickname ? '"' + escHtml(f.nickname) + '"' : '\u00A0') +
      '</div>';
    return '<div class="fighter-card" onclick="showFighterProfile(' + f.id + ')">' +
      '<div class="fighter-card__name">' + escHtml(f.name) + '</div>' +
      nickHtml +
      metaHtml +
    '</div>';
  }).join('');
}

async function showFighterProfile(fid){
  try {
    const [profRes, evRes] = await Promise.all([
      fetch('/api/fighters/' + fid + '/career-stats'),
      fetch('/api/fighters/' + fid + '/events')
    ]);
    const prof = await profRes.json();
    const events = await evRes.json();
    const f = prof.fighter; const s = prof.stats || {}; const r = prof.record || {};
    let html = '<h2>' + escHtml(f.name) + (f.nickname ? ' <span style="color:var(--muted);font-size:14px">"' + escHtml(f.nickname) + '"</span>' : '') + '</h2>' +
      '<div style="font-family:var(--f-mono);font-size:11px;color:var(--fg-dim);margin-bottom:16px">' +
        (f.weight_class||'') + ' · ' + (f.height_cm||'?') + 'cm · ' + (f.reach_cm||'?') + 'cm reach · ' + (f.stance||'?') +
        ' · Record: ' + (r.wins||0) + 'W-' + (r.losses||0) + 'L' + (r.draws ? '-' + r.draws + 'D' : '') +
      '</div>';
    if (events.length) {
      html += '<div style="font-family:var(--f-mono);font-size:10px;color:var(--cyan);letter-spacing:.15em;margin-bottom:8px">FIGHT HISTORY (' + events.length + ' events)</div>';
      events.forEach(ev => {
        html += '<div style="margin-bottom:8px">' +
          '<div style="font-family:var(--f-mono);font-size:10px;color:var(--muted)">UFC ' + ev.number + ' · ' + escHtml(ev.date||'') + '</div>';
        ev.fights.forEach(fight => {
          const won = fight.winner_id === fid;
          html += '<div style="font-family:var(--f-mono);font-size:11px;padding:3px 0;color:' + (won?'var(--green)':'var(--fg-dim)') + '">' +
            (won ? 'W' : 'L') + ' · ' + escHtml(fight.red_name) + ' vs ' + escHtml(fight.blue_name) +
            ' · ' + escHtml(fight.method||'') + ' R' + (fight.round||'') + '</div>';
        });
        html += '</div>';
      });
    }
    const dir = document.getElementById('fighterDir');
    dir.innerHTML = '<div style="margin-bottom:12px"><button class="rec-btn" onclick="renderFighterDir(_allFightersData)" style="font-size:10px">← Back to Directory</button></div>' + html;
  } catch(e){ console.error(e); }
}

// ── Stats Tab ──
async function loadStatsTab(){
  const grid = document.getElementById('leaderGrid');
  grid.innerHTML = '<div style="color:var(--muted);font-family:var(--f-mono);font-size:11px">Loading stat leaders…</div>';
  const categories = [
    { stat:'knockdowns', label:'Knockdowns', unit:'' },
    { stat:'sig_strikes', label:'Sig. Strikes Landed', unit:'' },
    { stat:'sig_accuracy', label:'Sig. Strike Accuracy', unit:'%' },
    { stat:'takedowns', label:'Takedowns', unit:'' },
    { stat:'td_accuracy', label:'Takedown Accuracy', unit:'%' },
    { stat:'control_time', label:'Control Time (sec)', unit:'s' },
    { stat:'sub_attempts', label:'Submission Attempts', unit:'' },
    { stat:'fights', label:'Most Fights (in DB)', unit:'' }
  ];
  try {
    let html = '';
    for (const cat of categories) {
      const res = await fetch('/api/stats/leaders?stat=' + cat.stat + '&limit=10');
      const data = await res.json();
      html += '<div class="leader-card"><div class="leader-card__title">' + escHtml(cat.label) + '</div>';
      if (!data.leaders.length) {
        html += '<div style="color:var(--muted-dim);font-family:var(--f-mono);font-size:10px">No data</div>';
      } else {
        data.leaders.forEach((l, i) => {
          html += '<div class="leader-entry">' +
            '<span class="leader-entry__rank">' + (i+1) + '</span>' +
            '<span class="leader-entry__name">' + escHtml(l.name) + '</span>' +
            '<span class="leader-entry__val">' + (l.value||0) + cat.unit + '</span></div>';
        });
      }
      html += '</div>';
    }
    grid.innerHTML = html;
  } catch(e){ grid.innerHTML = '<div style="color:var(--red)">Error loading stats</div>'; }
}

/* -----------------------------------------------------------
   PICKS FEATURE — profile lifecycle + modal + chip

   Identity: a server-issued UUID stored in localStorage.ufc_user.
   On boot we check /api/version for features.picks; when true we show
   the Picks tab and try to resume the local profile.
----------------------------------------------------------- */
const PICKS_STORAGE_KEY = 'ufc_user';
const VIEW_STORAGE_KEY = 'ufc_view_state';
const AVATAR_KEYS = Array.from({ length: 12 }, (_, i) => 'a' + (i + 1));
let _picksFeatureEnabled = false;
let _currentUser = null;
let _selectedAvatarKey = 'a1';
let _picksAutoPrompted = false;   // auto-open create modal once per session

function getStoredViewState(){
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    return raw ? JSON.parse(raw) || {} : {};
  } catch { return {}; }
}

function setStoredViewState(patch){
  try {
    const next = { ...getStoredViewState(), ...patch };
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(next));
  } catch { /* localStorage may be unavailable */ }
}

function parseViewHash(){
  const raw = (window.location.hash || '').replace(/^#/, '').trim();
  if (!raw) return {};
  const parts = raw.split('/').filter(Boolean);
  const tab = parts[0];
  if (!['dashboard','events','fighters','stats','picks'].includes(tab)) return {};
  const out = { tab };
  if (tab === 'picks' && ['upcoming','history','leaderboard'].includes(parts[1])) out.picksView = parts[1];
  return out;
}

function updateViewHash(tab, picksView){
  const next = tab === 'picks' && picksView ? `#picks/${picksView}` : `#${tab}`;
  if (window.location.hash !== next) history.replaceState(null, '', next);
}

function getCurrentViewState(){
  const activeTab = document.querySelector('.primary-tab.active');
  const tab = activeTab && activeTab.dataset.tab || 'dashboard';
  const state = { tab };
  if (tab === 'picks') {
    state.picksView = _picksState ? _picksState.view : 'upcoming';
    if (_picksState && _picksState.eventId) state.picksEventId = _picksState.eventId;
  }
  return state;
}

function restoreStoredView(){
  const target = { ...getStoredViewState(), ...parseViewHash() };
  if (target.picksView && _picksState) _picksState.view = target.picksView;
  if (Number.isFinite(parseInt(target.picksEventId, 10)) && _picksState) {
    _picksState.eventId = parseInt(target.picksEventId, 10);
  }
  if (target.tab && ['dashboard','events','fighters','stats','picks'].includes(target.tab)) {
    activatePrimaryTab(target.tab, { persist:false });
  }
}

function getLocalProfile(){
  try {
    const raw = localStorage.getItem(PICKS_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.id && p.display_name ? p : null;
  } catch { return null; }
}

function setLocalProfile(user){
  if (!user) { localStorage.removeItem(PICKS_STORAGE_KEY); return; }
  const compact = { id:user.id, display_name:user.display_name, avatar_key:user.avatar_key || null };
  localStorage.setItem(PICKS_STORAGE_KEY, JSON.stringify(compact));
}

async function validateProfileWithServer(id){
  try {
    const res = await fetch('/api/users/' + encodeURIComponent(id));
    if (!res.ok) return null;
    const data = await res.json();
    return data.user || null;
  } catch { return null; }
}

function avatarInitial(name){
  const first = String(name || '').trim().charAt(0);
  return first ? first.toUpperCase() : '·';
}

function avatarHtml(user, size){
  const sizeClass = size === 'lg' ? ' avatar--lg' : (size === 'xs' ? ' avatar--xs' : '');
  const key = (user && user.avatar_key) || 'a1';
  const initial = avatarInitial(user && user.display_name);
  return `<span class="avatar${sizeClass}" data-avatar="${escHtml(key)}">${escHtml(initial)}</span>`;
}

function renderProfileChip(){
  const slot = document.getElementById('picksProfileChipSlot');
  const empty = document.getElementById('picksEmpty');
  const subnav = document.getElementById('picksSubnav');
  if (!slot) return;
  if (!_currentUser) {
    slot.innerHTML = '';
    if (empty) empty.style.display = '';
    if (subnav) subnav.style.display = 'none';
    return;
  }
  slot.innerHTML = `
    <button class="profile-chip" id="profileChipBtn" title="Manage profile">
      ${avatarHtml(_currentUser)}
      <span class="profile-chip__name">${escHtml(_currentUser.display_name)}</span>
      <span class="profile-chip__caret">▾</span>
    </button>
  `;
  document.getElementById('profileChipBtn').addEventListener('click', openProfileActionsModal);
  if (empty) empty.style.display = 'none';
  if (subnav) subnav.style.display = '';
  // Load the active subnav view for the current user (fire-and-forget)
  try { activatePicksView(_picksState.view || 'upcoming'); } catch { /* view fns defined below */ }
}

function openModal(id){
  const m = document.getElementById(id);
  if (!m) return;
  m.style.display = '';
  m.setAttribute('aria-hidden','false');
}
function closeModal(id){
  const m = document.getElementById(id);
  if (!m) return;
  m.style.display = 'none';
  m.setAttribute('aria-hidden','true');
  const err = m.querySelector('.profile-modal__error');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
}

function renderAvatarGrid(){
  const grid = document.getElementById('profileAvatarGrid');
  if (!grid) return;
  const nameEl = document.getElementById('profileDisplayName');
  const initial = avatarInitial(nameEl ? nameEl.value : '');
  grid.innerHTML = AVATAR_KEYS.map(k => `
    <button type="button" class="avatar-pick${k === _selectedAvatarKey ? ' selected' : ''}" data-avatar-key="${k}">
      <span class="avatar" data-avatar="${k}">${escHtml(initial)}</span>
    </button>
  `).join('');
  grid.querySelectorAll('.avatar-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      _selectedAvatarKey = btn.dataset.avatarKey;
      renderAvatarGrid();
    });
  });
}

function openCreateProfileModal(prefill){
  _selectedAvatarKey = (prefill && prefill.avatar_key) || 'a1';
  const nameEl = document.getElementById('profileDisplayName');
  const titleEl = document.getElementById('profileModalTitle');
  const submitBtn = document.getElementById('profileSubmitBtn');
  if (prefill) {
    if (titleEl) titleEl.textContent = 'Update your profile';
    if (submitBtn) submitBtn.textContent = 'Save changes';
    if (nameEl) nameEl.value = prefill.display_name || '';
  } else {
    if (titleEl) titleEl.textContent = 'Pick a display name + avatar';
    if (submitBtn) submitBtn.textContent = 'Create profile';
    if (nameEl) nameEl.value = '';
  }
  renderAvatarGrid();
  openModal('profileModal');
  setTimeout(() => { if (nameEl) nameEl.focus(); }, 50);
}

function showProfileError(msg){
  const err = document.getElementById('profileModalError');
  if (!err) return;
  err.textContent = msg;
  err.style.display = '';
}

async function submitProfile(){
  const nameEl = document.getElementById('profileDisplayName');
  const name = (nameEl && nameEl.value || '').trim();
  if (!name) { showProfileError('Display name is required.'); return; }
  if (name.length > 40) { showProfileError('Display name max 40 characters.'); return; }

  const submitBtn = document.getElementById('profileSubmitBtn');
  if (submitBtn) submitBtn.disabled = true;
  const body = { display_name: name, avatar_key: _selectedAvatarKey };
  try {
    if (_currentUser) {
      // Update existing
      const res = await fetch('/api/users/' + encodeURIComponent(_currentUser.id), {
        method:'PATCH',
        headers:{ 'Content-Type':'application/json', 'X-User-Id': _currentUser.id },
        body: JSON.stringify(body)
      });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.message || e.error || 'Update failed'); }
      const data = await res.json();
      _currentUser = data.user;
      setLocalProfile(_currentUser);
    } else {
      const res = await fetch('/api/users', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.message || e.error || 'Create failed'); }
      const data = await res.json();
      _currentUser = data.user;
      setLocalProfile(_currentUser);
    }
    renderProfileChip();
    closeModal('profileModal');
  } catch (err) {
    showProfileError(err.message || 'Something went wrong');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function openProfileActionsModal(){
  if (!_currentUser) return;
  const nameEl = document.getElementById('profileActionsName');
  const idEl = document.getElementById('profileActionsId');
  if (nameEl) nameEl.textContent = _currentUser.display_name;
  if (idEl) idEl.textContent = _currentUser.id;
  openModal('profileActionsModal');
}

function openSwitchProfileForm(){
  const form = document.getElementById('profileSwitchForm');
  const input = document.getElementById('profileSwitchInput');
  const err = document.getElementById('profileSwitchError');
  const buttons = document.getElementById('profileMainActions');
  if (!form) return;
  form.style.display = '';
  if (err) { err.textContent = ''; err.style.display = 'none'; }
  if (input) { input.value = ''; setTimeout(() => input.focus(), 50); }
  if (buttons) buttons.style.display = 'none';
}

function closeSwitchProfileForm(){
  const form = document.getElementById('profileSwitchForm');
  const buttons = document.getElementById('profileMainActions');
  if (form) form.style.display = 'none';
  if (buttons) buttons.style.display = '';
}

async function applySwitchProfile(){
  const input = document.getElementById('profileSwitchInput');
  const err = document.getElementById('profileSwitchError');
  const applyBtn = document.getElementById('profileSwitchApply');
  const raw = (input && input.value || '').trim();
  if (!raw) {
    if (err) { err.textContent = 'Paste an ID to continue.'; err.style.display = ''; }
    return;
  }
  if (applyBtn) applyBtn.disabled = true;
  const user = await validateProfileWithServer(raw);
  if (applyBtn) applyBtn.disabled = false;
  if (!user) {
    if (err) { err.textContent = 'No profile found for that ID.'; err.style.display = ''; }
    return;
  }
  _currentUser = user;
  setLocalProfile(user);
  renderProfileChip();
  closeSwitchProfileForm();
  closeModal('profileActionsModal');
}

function openSignoutConfirm(){
  const confirmEl = document.getElementById('profileSignoutConfirm');
  const buttons = document.getElementById('profileMainActions');
  if (confirmEl) confirmEl.style.display = '';
  if (buttons) buttons.style.display = 'none';
}

function closeSignoutConfirm(){
  const confirmEl = document.getElementById('profileSignoutConfirm');
  const buttons = document.getElementById('profileMainActions');
  if (confirmEl) confirmEl.style.display = 'none';
  if (buttons) buttons.style.display = '';
}

function copyProfileId(){
  if (!_currentUser) return;
  navigator.clipboard.writeText(_currentUser.id).then(() => {
    const btn = document.getElementById('profileActionCopy');
    if (btn) { const orig = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => btn.textContent = orig, 1400); }
  }).catch(() => { alert('Copy failed — here is your ID:\n\n' + _currentUser.id); });
}

function signOutProfile(){
  _currentUser = null;
  setLocalProfile(null);
  renderProfileChip();
  closeSignoutConfirm();
  closeModal('profileActionsModal');
}

function setupPicksUi(){
  // Dismiss modals on scrim / close button
  document.querySelectorAll('[data-modal-close]').forEach(el => {
    el.addEventListener('click', (e) => {
      const modal = e.currentTarget.closest('.profile-modal');
      if (modal) closeModal(modal.id);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.profile-modal').forEach(m => {
      if (m.style.display !== 'none') closeModal(m.id);
    });
  });

  // Live-update avatar initial as user types the name
  const nameEl = document.getElementById('profileDisplayName');
  if (nameEl) nameEl.addEventListener('input', renderAvatarGrid);

  // Submit handlers
  const submit = document.getElementById('profileSubmitBtn');
  if (submit) submit.addEventListener('click', submitProfile);
  if (nameEl) nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitProfile();
  });

  // Empty-state CTA
  const createBtn = document.getElementById('picksCreateProfileBtn');
  if (createBtn) createBtn.addEventListener('click', () => openCreateProfileModal(null));

  // Actions modal wiring
  const edit    = document.getElementById('profileActionEdit');
  const copy    = document.getElementById('profileActionCopy');
  const swt     = document.getElementById('profileActionSwitch');
  const signout = document.getElementById('profileActionSignout');
  if (edit) edit.addEventListener('click', () => { closeModal('profileActionsModal'); openCreateProfileModal(_currentUser); });
  if (copy) copy.addEventListener('click', copyProfileId);
  if (swt) swt.addEventListener('click', openSwitchProfileForm);
  if (signout) signout.addEventListener('click', openSignoutConfirm);

  // Inline switch form
  const switchCancel = document.getElementById('profileSwitchCancel');
  const switchApply  = document.getElementById('profileSwitchApply');
  const switchInput  = document.getElementById('profileSwitchInput');
  if (switchCancel) switchCancel.addEventListener('click', closeSwitchProfileForm);
  if (switchApply)  switchApply.addEventListener('click', applySwitchProfile);
  if (switchInput)  switchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applySwitchProfile(); });

  // Inline sign-out confirmation
  const signoutCancel  = document.getElementById('profileSignoutCancel');
  const signoutConfirm = document.getElementById('profileSignoutConfirmBtn');
  if (signoutCancel) signoutCancel.addEventListener('click', closeSignoutConfirm);
  if (signoutConfirm) signoutConfirm.addEventListener('click', signOutProfile);

  // Reset inline forms whenever actions modal closes
  const actionsModal = document.getElementById('profileActionsModal');
  if (actionsModal) {
    actionsModal.querySelectorAll('[data-modal-close]').forEach(el => {
      el.addEventListener('click', () => {
        closeSwitchProfileForm();
        closeSignoutConfirm();
      });
    });
  }
}

async function initPicksFeature(){
  setupPicksUi();
  // Check feature flag
  try {
    const res = await fetch('/api/version');
    const data = await res.json();
    _picksFeatureEnabled = !!(data.features && data.features.picks);
  } catch { _picksFeatureEnabled = false; }
  const tabBtn = document.getElementById('picksTabBtn');
  if (!_picksFeatureEnabled) { if (tabBtn) tabBtn.style.display = 'none'; return; }
  if (tabBtn) tabBtn.style.display = '';

  // Resume profile. Prefer the better-auth cookie session if present —
  // localStorage `ufc_user` may still hold a pre-migration guest id from
  // before the user signed up (the auth bridge writes localStorage AFTER
  // this init runs, so we'd otherwise fetch picks under the stale id).
  // Falls back to legacy localStorage for users who never signed up.
  let resolved = null;
  try {
    const r = await fetch('/api/auth/get-session', { credentials: 'include' });
    if (r.ok) {
      const body = await r.json();
      if (body && body.user && body.user.id) {
        const server = await validateProfileWithServer(body.user.id);
        if (server) resolved = server;
      }
    }
  } catch (_) { /* fall through to localStorage path */ }
  if (!resolved) {
    const local = getLocalProfile();
    if (local) {
      const server = await validateProfileWithServer(local.id);
      if (server) resolved = server;
      else setLocalProfile(null);            // stale id — clear it
    }
  }
  if (resolved) { _currentUser = resolved; setLocalProfile(resolved); }
  renderProfileChip();
  setupPicksSubnav();
  restoreStoredView();
}

/* -----------------------------------------------------------
   PICKS VIEWS — Upcoming (pick widgets), History, Leaderboard
----------------------------------------------------------- */
let _picksState = {
  view: 'upcoming',          // 'upcoming' | 'history' | 'leaderboard'
  eventId: null,
  eventCard: [],
  userPicks: new Map(),      // fight_id → pick row
  modelByFightId: new Map(), // fight_id → { picked_fighter_id, confidence, version }
  latestModelVersion: null,
  lbScope: 'event'
};
{
  const initialPicksState = { ...getStoredViewState(), ...parseViewHash() };
  if (['upcoming','history','leaderboard'].includes(initialPicksState.picksView)) {
    _picksState.view = initialPicksState.picksView;
  }
  if (Number.isFinite(parseInt(initialPicksState.picksEventId, 10))) {
    _picksState.eventId = parseInt(initialPicksState.picksEventId, 10);
  }
}

function setupPicksSubnav(){
  document.querySelectorAll('.picks-subnav__btn').forEach(btn => {
    btn.addEventListener('click', () => activatePicksView(btn.dataset.picksView));
  });
  document.querySelectorAll('.picks-lb-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.picks-lb-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _picksState.lbScope = btn.dataset.lbScope;
      loadLeaderboardView();
    });
  });
}

const PICKS_TC_LABEL = { upcoming:'PICKS · UPCOMING', history:'PICKS · HISTORY', leaderboard:'PICKS · LEADERBOARD' };

function activatePicksView(view){
  _picksState.view = view;
  setStoredViewState({ tab:'picks', picksView:view });
  updateViewHash('picks', view);
  document.querySelectorAll('.picks-subnav__btn').forEach(b => {
    b.classList.toggle('active', b.dataset.picksView === view);
  });
  document.getElementById('picksViewUpcoming').style.display    = view === 'upcoming'    ? '' : 'none';
  document.getElementById('picksViewHistory').style.display     = view === 'history'     ? '' : 'none';
  document.getElementById('picksViewLeaderboard').style.display = view === 'leaderboard' ? '' : 'none';
  // Update TC to reflect the subview
  if (_tcForceSet) _tcForceSet(PICKS_TC_LABEL[view] || 'YOUR PICKS');
  if (!_currentUser) return;
  if (view === 'upcoming')    loadUpcomingView();
  if (view === 'history')     loadHistoryView();
  if (view === 'leaderboard') loadLeaderboardView();
}

function renderProfileChipAndViews(){
  renderProfileChip();
  if (_currentUser) {
    // Hide empty, reveal active view
    activatePicksView(_picksState.view || 'upcoming');
  }
}

async function populatePicksEventSelect(){
  const sel = document.getElementById('picksEventSelect');
  if (!sel || sel.options.length > 1) return;
  try {
    const res = await fetch('/api/events');
    const events = await res.json();
    // Sort: most recent date first (DESC). Null dates sort last.
    events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    sel.innerHTML = events
      .map(e => `<option value="${e.id}">UFC ${e.number || '—'} · ${escHtml(e.name)}${e.date ? ' · ' + e.date : ''}</option>`)
      .join('');

    // Default selection: nearest upcoming event (earliest future date), else
    // the most recent past event. "Today" uses ISO date string comparison.
    const today = new Date().toISOString().slice(0, 10);
    const futureEvents = events.filter(e => (e.date || '') >= today);
    const defaultEvent = futureEvents.length > 0
      ? futureEvents[futureEvents.length - 1]   // earliest future (events sorted DESC)
      : events[0];                              // most recent otherwise

    const storedEvent = events.find(e => e.id === _picksState.eventId);
    const storedEventIsUsable = storedEvent && (
      _picksState.view !== 'upcoming' || !storedEvent.date || storedEvent.date >= today
    );
    const selectedEvent = storedEventIsUsable ? storedEvent : defaultEvent;
    if (!selectedEvent) return;

    sel.value = String(selectedEvent.id);
    _picksState.eventId = parseInt(sel.value, 10);
    setStoredViewState({ picksEventId: _picksState.eventId });
    sel.addEventListener('change', () => {
      _picksState.eventId = parseInt(sel.value, 10);
      setStoredViewState({ tab:'picks', picksView:_picksState.view, picksEventId:_picksState.eventId });
      loadUpcomingView();
    });
  } catch (e) {
    sel.innerHTML = '<option>Failed to load events</option>';
  }
}

async function loadUpcomingView(){
  if (!_currentUser) return;
  await populatePicksEventSelect();
  const eventId = _picksState.eventId;
  const fightsEl = document.getElementById('picksFights');
  const loadingEl = document.getElementById('picksFightsLoading');
  if (loadingEl) loadingEl.style.display = '';
  if (fightsEl) fightsEl.innerHTML = '<div class="picks-loading">Loading card…</div>';

  try {
    const [cardRes, picksRes, compRes] = await Promise.all([
      fetch(`/api/events/${eventId}/card`),
      fetch(`/api/users/${encodeURIComponent(_currentUser.id)}/picks?event_id=${eventId}`),
      fetch(`/api/events/${eventId}/picks/model-comparison`)
    ]);
    const { card } = await cardRes.json();
    const { picks } = await picksRes.json();
    const { fights: compFights } = await compRes.json();

    // Normalize fighter-id field names — /api/events/:id/card uses red_id/blue_id,
    // other endpoints use red_fighter_id/blue_fighter_id. Widget reads *_fighter_id.
    const normalized = (card || []).map(f => ({
      ...f,
      red_fighter_id:  f.red_fighter_id  != null ? f.red_fighter_id  : f.red_id,
      blue_fighter_id: f.blue_fighter_id != null ? f.blue_fighter_id : f.blue_id
    }));
    _picksState.eventCard = normalized;
    _picksState.userPicks = new Map((picks || []).map(p => [p.fight_id, p]));
    _picksState.modelByFightId = new Map((compFights || []).map(c => [c.fight_id, c.model]));
    _picksState.latestModelVersion = getLatestModelVersion(_picksState.modelByFightId);

    // Upcoming view shows only fights without a winner. Concluded fights
    // appear in "My history" with their points + correctness.
    const openFights = normalized.filter(f => f.winner_id == null);
    const hint = document.getElementById('picksEventHint');
    if (hint) {
      const total = normalized.length;
      const open = openFights.length;
      if (total === 0) {
        hint.textContent = 'No fights on this card.';
      } else if (open === 0) {
        hint.textContent = `All ${total} fights concluded · see History`;
      } else if (open === total) {
        hint.textContent = `${open} upcoming fight${open === 1 ? '' : 's'}`;
      } else {
        hint.textContent = `${open} upcoming · ${total - open} concluded (see History)`;
      }
    }

    if (openFights.length === 0) {
      fightsEl.innerHTML = `
        <div class="picks-placeholder">
          No open fights on this card — every fight is concluded.<br>
          Check <strong>My History</strong> for any picks you already made,
          or pick a different event from the dropdown.
        </div>`;
    } else {
      fightsEl.innerHTML = openFights.map(f => renderPickWidget(f)).join('');
      attachPickHandlers(fightsEl);
    }
    renderPicksCardSummary(openFights);
  } catch (e) {
    fightsEl.innerHTML = '<div class="picks-placeholder">Failed to load this event\'s card.</div>';
    renderPicksCardSummary([]);
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

function renderPicksCardSummary(openFights){
  const el = document.getElementById('picksCardSummary');
  if (!el) return;
  const fights = Array.isArray(openFights) ? openFights : (_picksState.eventCard || []).filter(f => f.winner_id == null);
  const total = fights.length;
  const saved = fights.filter(f => _picksState.userPicks.has(f.id));
  const eventSelect = document.getElementById('picksEventSelect');
  const eventLabel = eventSelect && eventSelect.selectedOptions[0]
    ? eventSelect.selectedOptions[0].textContent.replace(/\s+/g, ' ').trim()
    : 'Selected event';

  if (!_currentUser) {
    el.innerHTML = '<div class="picks-card-summary__empty">Create a profile to build your pick card.</div>';
    return;
  }

  const rows = saved.map(f => {
    const pick = _picksState.userPicks.get(f.id);
    const pickedRed = pick && pick.picked_fighter_id === f.red_fighter_id;
    const pickedBlue = pick && pick.picked_fighter_id === f.blue_fighter_id;
    const pickedName = pickedRed ? f.red_name : (pickedBlue ? f.blue_name : '—');
    const corner = pickedRed ? 'red' : (pickedBlue ? 'blue' : '');
    const extras = [
      pick.method_pick ? pick.method_pick : null,
      pick.round_pick ? 'R' + pick.round_pick : null
    ].filter(Boolean).join(' · ');
    return `
      <div class="picks-card-summary__row">
        <div class="picks-card-summary__matchup">${escHtml(f.red_name || '—')} <span>vs</span> ${escHtml(f.blue_name || '—')}</div>
        <div class="picks-card-summary__pick ${corner}">
          <strong>${escHtml(pickedName)}</strong>
          <span>${pick.confidence || 50}%${extras ? ' · ' + escHtml(extras) : ''}</span>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="picks-card-summary__head">
      <div>
        <div class="picks-card-summary__eyebrow">My pick card</div>
        <div class="picks-card-summary__title">${escHtml(eventLabel)}</div>
      </div>
      <div class="picks-card-summary__count">${saved.length}/${total}</div>
    </div>
    <div class="picks-card-summary__bar">
      <div style="width:${total ? Math.round((saved.length / total) * 100) : 0}%"></div>
    </div>
    ${saved.length ? `<div class="picks-card-summary__list">${rows}</div>` : '<div class="picks-card-summary__empty">No saved picks yet. Pick winners on the left and save each fight.</div>'}
  `;
}

function getLatestModelVersion(modelByFightId){
  const versions = Array.from(modelByFightId.values())
    .map(model => model && model.version)
    .filter(Boolean);
  if (!versions.length) return null;
  return versions.sort(compareModelVersions).at(-1);
}

function compareModelVersions(a, b){
  const parse = v => {
    const match = String(v || '').match(/v?(\d+)\.(\d+)\.(\d+)/);
    if (!match) return [0, 0, 0, String(v || '')];
    return [Number(match[1]), Number(match[2]), Number(match[3]), String(v || '')];
  };
  const aa = parse(a);
  const bb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  }
  return aa[3].localeCompare(bb[3]);
}

function renderFighterStatsHover(fight, model, corner){
  const items = getFighterEvidenceItems(fight, model, corner).slice(0, 5);
  if (!items.length) return '';
  const fighterName = corner === 'red' ? fight.red_name : fight.blue_name;
  const rows = items.map(item => `
    <span class="pick-fighter-stats__row">
      <span>${escHtml(item.label)}</span>
      <strong>${escHtml(item.value)}</strong>
    </span>`).join('');
  return `
    <span class="pick-fighter-stats pick-fighter-stats--${corner}" tabindex="0">
      Stats
      <span class="pick-fighter-stats__panel">
        <span class="pick-fighter-stats__title">${escHtml(fighterName || (corner === 'red' ? 'Red' : 'Blue'))}</span>
        ${rows}
        <span class="pick-fighter-stats__note">Model evidence from completed fight records and fighter profile metrics.</span>
      </span>
    </span>`;
}

function getFighterEvidenceItems(fight, model, corner){
  const categories = model && model.explanation && Array.isArray(model.explanation.categories)
    ? model.explanation.categories
    : [];
  const key = corner === 'red' ? 'red' : 'blue';
  const items = [];
  for (const category of categories) {
    const evidence = Array.isArray(category.evidence) ? category.evidence[0] : null;
    if (!evidence || !evidence[key]) continue;
    const value = formatEvidenceNumber(evidence[key].value, evidence.unit || '');
    if (!value) continue;
    items.push({
      label: category.category || evidence.label || 'Model stat',
      value,
      source: evidence.source || ''
    });
  }
  if (!items.length) {
    const height = corner === 'red' ? fight.red_height : fight.blue_height;
    const reach = corner === 'red' ? fight.red_reach : fight.blue_reach;
    if (height) items.push({ label: 'Height', value: `${Math.round(height)} cm` });
    if (reach) items.push({ label: 'Reach', value: `${Math.round(reach)} cm` });
  }
  return items;
}

function renderPickWidget(fight){
  const pick = _picksState.userPicks.get(fight.id);
  const model = _picksState.modelByFightId.get(fight.id);
  const locked = fight.winner_id != null || (pick && pick.locked_at);
  const lockedReason = fight.winner_id != null ? 'fight_over' : (pick && pick.locked_at ? 'event_locked' : null);

  const pickedRed  = pick && pick.picked_fighter_id === fight.red_fighter_id;
  const pickedBlue = pick && pick.picked_fighter_id === fight.blue_fighter_id;
  const conf = pick ? pick.confidence : 50;
  const methodVal = pick && pick.method_pick || '';
  const roundVal = pick && pick.round_pick || '';
  const notesVal = pick && pick.notes || '';
  const redStatsHover = model ? renderFighterStatsHover(fight, model, 'red') : '';
  const blueStatsHover = model ? renderFighterStatsHover(fight, model, 'blue') : '';

  // Model comparison with horizontal probability bar
  let modelHtml;
  if (model && model.picked_fighter_id) {
    const modelWinnerName = model.picked_fighter_id === fight.red_fighter_id ? fight.red_name : fight.blue_name;
    const pct = Math.round((model.confidence || 0) * 100);
    const latestBadge = model.version && model.version === _picksState.latestModelVersion
      ? '<span class="pick-model__latest">Latest</span>'
      : '';
    // red_win_prob + blue_win_prob in the model object (server sends both)
    const redPct = Math.round((model.red_win_prob || 0) * 100);
    const bluePct = 100 - redPct;
    let badge = '';
    if (pick) {
      const agrees = pick.picked_fighter_id === model.picked_fighter_id;
      badge = `<span class="pick-model__agreement ${agrees ? 'agrees' : 'disagrees'}">${agrees ? 'agrees with you' : 'disagrees'}</span>`;
    }
    // "YOU" tick — position by the user's own confidence, projected onto the bar.
    // A pick on red with conf X positions the tick at X% of the red half (from left).
    // A pick on blue with conf X positions the tick at 100 - (X% of blue half from right).
    let youTick = '';
    if (pick) {
      const conf = pick.confidence || 50;
      const tickPct = pick.picked_fighter_id === fight.red_fighter_id
        ? (redPct * (conf / 100))
        : (redPct + bluePct * (1 - conf / 100));
      youTick = `<div class="pick-model__bar-tick" style="left:${Math.max(0, Math.min(100, tickPct))}%"></div>`;
    }
    const explanation = renderModelExplanation(model.explanation, fight);
    modelHtml = `
      <div class="pick-model">
        <div class="pick-model__top">
          <span class="pick-model__icon">⚡</span>
          <span class="pick-model__label">Model · ${escHtml(model.version)}</span>
          ${latestBadge}
          <span class="pick-model__pred">${escHtml(modelWinnerName)} favored · ${pct}%</span>
          ${badge}
        </div>
        <div class="pick-model__bar">
          <div class="pick-model__bar-red" style="width:${redPct}%">${redPct > 15 ? redPct + '%' : ''}</div>
          <div class="pick-model__bar-blue" style="width:${bluePct}%">${bluePct > 15 ? bluePct + '%' : ''}</div>
          ${youTick}
        </div>
        <div class="pick-model__legend">
          <span class="pick-model__legend-red">${escHtml(fight.red_name || '')}</span>
          <span class="pick-model__legend-blue">${escHtml(fight.blue_name || '')}</span>
        </div>
        ${explanation}
      </div>`;
  } else {
    modelHtml = `<div class="pick-model"><span class="pick-model__empty">No model prediction available for this fight yet.</span></div>`;
  }

  // Outcome banner (if fight has a winner)
  let outcomeHtml = '';
  if (fight.winner_id != null) {
    const winnerName = fight.winner_id === fight.red_fighter_id ? fight.red_name : fight.blue_name;
    const meta = `${escHtml(fight.method || '—')}${fight.round ? ' · R' + fight.round : ''}${fight.time ? ' · ' + escHtml(fight.time) : ''}`;
    const correct = pick && pick.correct === 1;
    const wrong = pick && pick.correct === 0;
    const pointsText = pick && pick.correct != null ? (pick.points || 0) + ' pts' : '';
    outcomeHtml = `
      <div class="pick-outcome ${correct ? 'is-correct' : (wrong ? 'is-wrong' : '')}">
        <div>
          <div class="pick-outcome__winner">WINNER · ${escHtml(winnerName.toUpperCase())}</div>
          <div class="pick-outcome__detail">${meta}</div>
        </div>
        <div></div>
        <div class="pick-outcome__points">${escHtml(pointsText)}</div>
      </div>`;
  }

  // Status row
  let statusHtml = '';
  if (locked && !outcomeHtml) {
    statusHtml = `<div class="pick-status is-locked"><span class="pick-status__label">Locked</span><span class="pick-status__detail">${lockedReason === 'fight_over' ? 'Fight already concluded' : 'Event locked by admin'}</span></div>`;
  } else if (pick && !locked) {
    statusHtml = `<div class="pick-status is-saved"><span class="pick-status__label">Saved</span><span class="pick-status__detail">You can edit until the event locks.</span></div>`;
  } else if (!locked) {
    statusHtml = `<div class="pick-status is-hint"><span class="pick-status__label">Hint</span><span class="pick-status__detail">Pick a winner, tune confidence, optionally add method / round / notes.</span></div>`;
  }

  const disabled = locked ? 'disabled' : '';
  const mainClass = fight.is_main ? ' is-main' : '';
  const lockedClass = locked ? ' is-locked' : '';

  return `
    <div class="pick-fight${mainClass}${lockedClass}" data-fight-id="${fight.id}">
      <div class="pick-fight__head">
        <div class="pick-fight__corner pick-fight__corner--red">
          <div class="pick-fight__tag">Red corner</div>
          <div class="pick-fight__name">${escHtml(fight.red_name || '—')}</div>
          <div class="pick-fight__meta">${escHtml(fight.weight_class || '')}${redStatsHover}</div>
        </div>
        <div class="pick-fight__vs">VS</div>
        <div class="pick-fight__corner pick-fight__corner--blue">
          <div class="pick-fight__tag">Blue corner</div>
          <div class="pick-fight__name">${escHtml(fight.blue_name || '—')}</div>
          <div class="pick-fight__meta">${fight.is_main ? 'MAIN EVENT' : (fight.is_title ? 'TITLE FIGHT' : '')}${blueStatsHover}</div>
        </div>
      </div>

      <div class="pick-fighters">
        <button class="pick-fighter${pickedRed ? ' selected' : ''}" data-corner="red" data-fighter-id="${fight.red_fighter_id}" ${disabled}>
          ${pickedRed ? '✓ ' : ''}Pick ${escHtml((fight.red_name || '').split(' ').pop() || 'Red')}
        </button>
        <button class="pick-fighter${pickedBlue ? ' selected' : ''}" data-corner="blue" data-fighter-id="${fight.blue_fighter_id}" ${disabled}>
          ${pickedBlue ? '✓ ' : ''}Pick ${escHtml((fight.blue_name || '').split(' ').pop() || 'Blue')}
        </button>
      </div>

      <div class="pick-conf">
        <span class="pick-conf__label">Confidence</span>
        <input type="range" class="pick-conf__slider" min="0" max="100" step="5" value="${conf}" data-pick-field="confidence" ${disabled}>
        <span class="pick-conf__value" data-conf-display>${conf}%</span>
      </div>

      <div class="pick-method">
        <label class="pick-method__field">
          <span class="pick-method__label">Method (optional)</span>
          <select class="pick-method__select" data-pick-field="method_pick" ${disabled}>
            <option value="">—</option>
            <option value="KO/TKO"${methodVal === 'KO/TKO' ? ' selected' : ''}>KO / TKO</option>
            <option value="SUB"${methodVal === 'SUB' ? ' selected' : ''}>Submission</option>
            <option value="DEC"${methodVal === 'DEC' ? ' selected' : ''}>Decision</option>
          </select>
        </label>
        <label class="pick-method__field">
          <span class="pick-method__label">Round (optional)</span>
          <select class="pick-method__select" data-pick-field="round_pick" ${disabled}>
            <option value="">—</option>
            ${[1,2,3,4,5].map(r => `<option value="${r}"${String(roundVal) === String(r) ? ' selected' : ''}>Round ${r}</option>`).join('')}
          </select>
        </label>
      </div>

      <div class="pick-notes">
        <textarea class="pick-notes__input" maxlength="280" placeholder="Notes (optional) — max 280 chars" data-pick-field="notes" ${disabled}>${escHtml(notesVal)}</textarea>
      </div>

      ${modelHtml}
      ${outcomeHtml}
      ${statusHtml}

      ${locked ? '' : `
        <div class="pick-actions">
          ${pick ? `<button class="rec-btn" data-pick-action="delete">Remove pick</button>` : ''}
          <button class="rec-btn rec-btn--primary" data-pick-action="save">${pick ? 'Update pick' : 'Save pick'}</button>
        </div>
      `}
    </div>
  `;
}

function renderModelExplanation(explanation, fight){
  if (!explanation || !Array.isArray(explanation.factors) || explanation.factors.length === 0) return '';
  const summary = explanation.summary
    ? `<div class="pick-model-why__summary">${escHtml(explanation.summary)}</div>`
    : '';
  const maxImpact = Math.max(...explanation.factors.map(f => Number(f.impact) || 0), 0.01);
  const rows = explanation.factors.slice(0, 5).map(f => {
    const favorsRed = f.favors === 'red';
    const fighterName = f.fighter || (favorsRed ? fight.red_name : fight.blue_name);
    const pct = Math.max(8, Math.min(100, Math.round(((Number(f.impact) || 0) / maxImpact) * 100)));
    const value = formatModelFactorValue(f);
    return `
      <div class="pick-model-why__factor ${favorsRed ? 'favors-red' : 'favors-blue'}">
        <div class="pick-model-why__factor-head">
          <span>${escHtml(f.label || f.feature || 'Factor')}</span>
          <span>${escHtml(fighterName || (favorsRed ? 'Red' : 'Blue'))}${value ? ' · ' + escHtml(value) : ''}</span>
        </div>
        <div class="pick-model-why__meter"><span style="width:${pct}%"></span></div>
      </div>`;
  }).join('');
  const categories = Array.isArray(explanation.categories)
    ? explanation.categories.slice(0, 6).map(c => renderModelEvidenceCategory(c, fight)).join('')
    : '';
  return `
    <div class="pick-model-why">
      <div class="pick-model-why__title">Why the model leans this way</div>
      ${summary}
      ${rows}
      ${categories ? `<div class="pick-model-why__evidence">${categories}</div>` : ''}
    </div>`;
}

function renderModelEvidenceCategory(category, fight){
  const favorsRed = category.favors !== 'blue';
  const fighter = favorsRed ? fight.red_name : fight.blue_name;
  const evidence = Array.isArray(category.evidence) ? category.evidence[0] : null;
  const source = evidence && evidence.source ? evidence.source : '';
  const detail = evidence ? formatModelEvidence(evidence) : '';
  const sourceTip = evidence ? formatEvidenceSourceTip(evidence, category) : '';
  return `
    <div class="pick-model-why__category ${favorsRed ? 'favors-red' : 'favors-blue'}">
      <div class="pick-model-why__category-head">
        <span>${escHtml(category.category || 'Model evidence')}</span>
        <span>${escHtml(fighter || (favorsRed ? 'Red' : 'Blue'))}</span>
      </div>
      ${detail ? `<div class="pick-model-why__category-detail">${escHtml(detail)}</div>` : ''}
      ${source ? `
        <div class="pick-model-why__category-source">
          <span>${escHtml(source)}</span>
          <span class="pick-evidence-pill" tabindex="0">
            Evidence
            <span class="pick-evidence-pill__panel">${escHtml(sourceTip)}</span>
          </span>
        </div>` : ''}
    </div>`;
}

function formatEvidenceSourceTip(evidence, category){
  const bits = [
    `${category.category || evidence.label || 'This category'} is calculated from ${evidence.source || 'engineered model inputs'}.`,
    'Career metrics aggregate completed fight rows; profile metrics come from fighter profile fields.',
    evidence.interpretation || ''
  ].filter(Boolean);
  return bits.join(' ');
}

function formatModelEvidence(e){
  const red = e.red || {};
  const blue = e.blue || {};
  const unit = e.unit || '';
  const redVal = formatEvidenceNumber(red.value, unit);
  const blueVal = formatEvidenceNumber(blue.value, unit);
  const delta = formatEvidenceNumber(e.delta, unit);
  if (redVal || blueVal) {
    return `${red.fighter || 'Red'} ${redVal || 'n/a'} vs ${blue.fighter || 'Blue'} ${blueVal || 'n/a'}${delta ? ' · delta ' + delta : ''}`;
  }
  return e.interpretation || '';
}

function formatEvidenceNumber(value, unit){
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  const sign = n > 0 ? '+' : (n < 0 ? '−' : '');
  if (unit === 'pct') return sign + Math.round(abs * 100) + '%';
  if ((unit || '').includes('cm')) return sign + Math.round(abs) + ' cm';
  if ((unit || '').includes('sec')) return sign + Math.round(abs) + ' sec';
  const rendered = abs >= 10 ? Math.round(abs) : abs.toFixed(1);
  return sign + rendered + (unit && unit !== 'delta' ? ' ' + unit : '');
}

function formatModelFactorValue(f){
  const v = Number(f && f.value);
  if (!Number.isFinite(v)) return '';
  const abs = Math.abs(v);
  const sign = v > 0 ? '+' : (v < 0 ? '−' : '');
  if ((f.feature || '').includes('_accuracy') || (f.feature || '').includes('_def') || (f.feature || '').includes('win_pct')) {
    return sign + Math.round(abs * 100) + ' pts';
  }
  if ((f.feature || '').includes('reach') || (f.feature || '').includes('height')) {
    return sign + Math.round(abs) + ' cm';
  }
  if ((f.feature || '').includes('ctrl_sec')) {
    return sign + Math.round(abs) + ' sec/fight';
  }
  return sign + (abs >= 10 ? Math.round(abs) : abs.toFixed(1));
}

function attachPickHandlers(container){
  const cards = container.matches && container.matches('.pick-fight')
    ? [container]
    : Array.from(container.querySelectorAll('.pick-fight'));
  cards.forEach(card => {
    const fightId = parseInt(card.dataset.fightId, 10);

    // Fighter pick toggles
    card.querySelectorAll('.pick-fighter').forEach(btn => {
      btn.addEventListener('click', () => {
        card.querySelectorAll('.pick-fighter').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    // Confidence slider live value
    const slider = card.querySelector('[data-pick-field="confidence"]');
    const display = card.querySelector('[data-conf-display]');
    if (slider && display) {
      slider.addEventListener('input', () => { display.textContent = slider.value + '%'; });
    }

    // Save
    const saveBtn = card.querySelector('[data-pick-action="save"]');
    if (saveBtn) saveBtn.addEventListener('click', () => submitPickFromCard(card, fightId));

    // Delete
    const delBtn = card.querySelector('[data-pick-action="delete"]');
    if (delBtn) delBtn.addEventListener('click', () => deletePickFromCard(card, fightId));
  });
}

function rerenderPickCard(fightId){
  const fight = (_picksState.eventCard || []).find(f => f.id === fightId);
  const current = document.querySelector(`.pick-fight[data-fight-id="${fightId}"]`);
  if (!fight || !current) return false;
  const wrap = document.createElement('div');
  wrap.innerHTML = renderPickWidget(fight).trim();
  const next = wrap.firstElementChild;
  if (!next) return false;
  current.replaceWith(next);
  attachPickHandlers(next);
  return true;
}

function getPickInputs(card){
  const selected = card.querySelector('.pick-fighter.selected');
  const picked_fighter_id = selected ? parseInt(selected.dataset.fighterId, 10) : null;
  const confidence = parseInt(card.querySelector('[data-pick-field="confidence"]').value, 10);
  const method_pick = card.querySelector('[data-pick-field="method_pick"]').value || null;
  const roundRaw = card.querySelector('[data-pick-field="round_pick"]').value;
  const round_pick = roundRaw ? parseInt(roundRaw, 10) : null;
  const notes = (card.querySelector('[data-pick-field="notes"]').value || '').trim() || null;
  return { picked_fighter_id, confidence, method_pick, round_pick, notes };
}

function setPickStatus(card, variant, label, detail){
  const existing = card.querySelector('.pick-status');
  const html = `<div class="pick-status is-${variant}"><span class="pick-status__label">${escHtml(label)}</span><span class="pick-status__detail">${escHtml(detail)}</span></div>`;
  if (existing) existing.outerHTML = html;
  else {
    const actions = card.querySelector('.pick-actions');
    if (actions) actions.insertAdjacentHTML('beforebegin', html);
    else card.insertAdjacentHTML('beforeend', html);
  }
}

async function submitPickFromCard(card, fightId){
  if (!_currentUser) return;
  const input = getPickInputs(card);
  if (!input.picked_fighter_id) {
    setPickStatus(card, 'error', 'Missing', 'Pick a winner first.');
    return;
  }
  const body = { event_id: _picksState.eventId, fight_id: fightId, ...input };
  const saveBtn = card.querySelector('[data-pick-action="save"]');
  if (saveBtn) saveBtn.disabled = true;
  try {
    const res = await fetch('/api/picks', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'X-User-Id': _currentUser.id },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const label = res.status === 409 ? 'Locked' : 'Error';
      setPickStatus(card, 'error', label, err.message || err.error || 'Save failed');
      return;
    }
    const data = await res.json();
    _picksState.userPicks.set(fightId, data.pick);
    if (!rerenderPickCard(fightId)) {
      setPickStatus(card, 'saved', 'Saved', 'Pick recorded. Edit anytime until lock.');
      if (saveBtn) saveBtn.textContent = 'Update pick';
    }
    renderPicksCardSummary();
  } catch (e) {
    setPickStatus(card, 'error', 'Error', e.message || 'Network error');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function deletePickFromCard(card, fightId){
  if (!_currentUser) return;
  const pick = _picksState.userPicks.get(fightId);
  if (!pick) return;
  if (!confirm('Remove your pick on this fight?')) return;
  try {
    const res = await fetch('/api/picks/' + pick.id, {
      method: 'DELETE',
      headers: { 'X-User-Id': _currentUser.id }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setPickStatus(card, 'error', 'Error', err.message || err.error || 'Delete failed');
      return;
    }
    _picksState.userPicks.delete(fightId);
    renderPicksCardSummary();
    // Re-render the whole upcoming view so the card reflects no-pick state
    loadUpcomingView();
  } catch (e) {
    setPickStatus(card, 'error', 'Error', e.message || 'Network error');
  }
}

async function loadHistoryView(){
  if (!_currentUser) return;
  const body = document.getElementById('picksHistoryBody');
  if (!body) return;
  body.innerHTML = '<div class="picks-loading">Loading history…</div>';
  try {
    const [picksRes, statsRes] = await Promise.all([
      fetch(`/api/users/${encodeURIComponent(_currentUser.id)}/picks?reconciled=1`),
      fetch(`/api/users/${encodeURIComponent(_currentUser.id)}/stats`)
    ]);
    const { picks } = await picksRes.json();
    const { stats } = await statsRes.json();

    const stripHtml = renderPicksStatsStrip(stats);

    if (!picks || picks.length === 0) {
      body.innerHTML = stripHtml +
        '<div class="picks-placeholder">No reconciled picks yet. Make picks on upcoming events — your history appears here once results are in.</div>';
      return;
    }

    // Group picks by event_id
    const byEvent = new Map();
    for (const p of picks) {
      const key = p.event_id;
      if (!byEvent.has(key)) byEvent.set(key, { event: p, picks: [] });
      byEvent.get(key).picks.push(p);
    }

    const groupsHtml = Array.from(byEvent.values())
      .sort((a, b) => (b.event.event_date || '').localeCompare(a.event.event_date || ''))
      .map(g => renderHistoryEventGroup(g)).join('');

    body.innerHTML = stripHtml + groupsHtml;
  } catch (e) {
    body.innerHTML = '<div class="picks-placeholder">Failed to load history.</div>';
  }
}

function renderPicksStatsStrip(stats){
  if (!stats) return '';
  const total = stats.total_picks || 0;
  const correct = stats.correct_count || 0;
  const acc = stats.accuracy_pct;
  const points = stats.points || 0;
  const beatModel = (stats.vs_model && stats.vs_model.beat_model_count) || 0;
  return `
    <div class="picks-stats-strip">
      <div class="picks-stat">
        <div class="picks-stat__label">Points</div>
        <div class="picks-stat__value picks-stat__value--cyan">${points}</div>
        <div class="picks-stat__sub">across ${total} reconciled pick${total === 1 ? '' : 's'}</div>
      </div>
      <div class="picks-stat">
        <div class="picks-stat__label">Accuracy</div>
        <div class="picks-stat__value">${acc != null ? acc + '%' : '—'}</div>
        <div class="picks-stat__sub">${correct} correct / ${total}</div>
      </div>
      <div class="picks-stat">
        <div class="picks-stat__label">Beat the model</div>
        <div class="picks-stat__value picks-stat__value--green">${beatModel}</div>
        <div class="picks-stat__sub">picks right where model was wrong</div>
      </div>
      <div class="picks-stat">
        <div class="picks-stat__label">Best call</div>
        <div class="picks-stat__value">${total > 0 ? Math.round((points / total) * 10) / 10 : '—'}</div>
        <div class="picks-stat__sub">points per pick (avg)</div>
      </div>
    </div>
  `;
}

function renderHistoryEventGroup(g){
  const e = g.event;
  const picks = g.picks;
  const totalPts = picks.reduce((s, p) => s + (p.points || 0), 0);
  const correctN = picks.filter(p => p.correct === 1).length;
  const title = `UFC ${e.event_number || '—'} · ${escHtml(e.event_name || '')}`;
  const sub = e.event_date ? escHtml(e.event_date) : '';
  return `
    <div class="picks-history-event">
      <div class="picks-history-event__head">
        <div class="picks-history-event__title">${title}</div>
        <div class="picks-history-event__sub">${sub}</div>
        <div class="picks-history-event__score"><strong>${totalPts} pts</strong> · ${correctN}/${picks.length}</div>
      </div>
      ${picks.map(p => renderHistoryPickRow(p)).join('')}
    </div>
  `;
}

function renderHistoryPickRow(p){
  const correct = p.correct === 1;
  const wrong = p.correct === 0;
  const voided = p.correct === 0 && p.actual_winner_id == null;
  const statusIcon = voided ? '·' : (correct ? '✓' : '✗');
  const statusCls = voided ? 'is-void' : (correct ? 'is-correct' : 'is-wrong');
  const rowCls = correct ? 'is-correct' : (wrong ? 'is-wrong' : '');

  const pickedName = p.picked_fighter_name
    || (p.picked_fighter_id === p.red_fighter_id ? p.red_name : p.blue_name);
  const winnerName = p.actual_winner_id === p.red_fighter_id ? p.red_name
    : (p.actual_winner_id === p.blue_fighter_id ? p.blue_name : null);

  const badges = [];
  if (p.method_correct === 1) badges.push('<span class="picks-history-pick__badge picks-history-pick__badge--method">+ method</span>');
  if (p.round_correct === 1)  badges.push('<span class="picks-history-pick__badge picks-history-pick__badge--round">+ round</span>');
  if (correct && p.user_agreed_with_model === 0) badges.push('<span class="picks-history-pick__badge picks-history-pick__badge--upset">beat model</span>');
  if (p.user_agreed_with_model === 1) badges.push('<span class="picks-history-pick__badge picks-history-pick__badge--agreed">w/ model</span>');

  const matchup = `<strong>${escHtml(pickedName)}</strong> · ${escHtml(p.red_name)} vs ${escHtml(p.blue_name)}`;
  const meta = voided
    ? `Draw / NC · no points awarded`
    : `${winnerName ? 'Winner: ' + escHtml(winnerName) : 'No winner'}${p.method ? ' · ' + escHtml(p.method) : ''}${p.fight_round ? ' · R' + p.fight_round : ''} · Your conf ${p.confidence || 0}%`;

  const points = p.points || 0;
  const pointsCls = points === 0 ? ' picks-history-pick__points--zero' : '';

  return `
    <div class="picks-history-pick ${rowCls}">
      <div class="picks-history-pick__status ${statusCls}">${statusIcon}</div>
      <div class="picks-history-pick__body">
        <div class="picks-history-pick__matchup">${matchup}</div>
        <div class="picks-history-pick__meta">${meta}${badges.length ? ' · ' + badges.join(' ') : ''}</div>
      </div>
      <div class="picks-history-pick__points${pointsCls}">${points} pts</div>
    </div>
  `;
}

async function loadLeaderboardView(){
  const body = document.getElementById('picksLeaderboardBody');
  if (!body) return;
  body.innerHTML = '<div class="picks-loading">Loading leaderboard…</div>';
  try {
    const url = _picksState.lbScope === 'event' && _picksState.eventId
      ? `/api/events/${_picksState.eventId}/picks/leaderboard?limit=500`
      : '/api/leaderboard?limit=500';
    const res = await fetch(url);
    const { leaderboard } = await res.json();
    if (!leaderboard || leaderboard.length === 0) {
      body.innerHTML = '<div class="picks-placeholder">Leaderboard is empty. Once users\' picks are reconciled, rankings show here.</div>';
      return;
    }

    const TOP_N = 50;
    const top = leaderboard.slice(0, TOP_N);
    const userRankIdx = _currentUser ? leaderboard.findIndex(r => r.user_id === _currentUser.id) : -1;
    const meInTop = userRankIdx >= 0 && userRankIdx < TOP_N;
    const meRow = userRankIdx >= 0 ? leaderboard[userRankIdx] : null;

    const tableHtml = `
      <table class="picks-leaderboard">
        <thead>
          <tr><th>#</th><th>User</th><th>Picks</th><th>Correct</th><th>Accuracy</th><th>Points</th></tr>
        </thead>
        <tbody>
          ${top.map((row, i) => {
            const isMe = _currentUser && row.user_id === _currentUser.id;
            return `
              <tr class="${isMe ? 'me' : ''}">
                <td class="num">${i + 1}</td>
                <td>${avatarHtml({ avatar_key: row.avatar_key, display_name: row.display_name }, 'xs')} ${escHtml(row.display_name)}${isMe ? ' <span style="color:var(--cyan)">(you)</span>' : ''}</td>
                <td>${row.picks}</td>
                <td>${row.correct_count}</td>
                <td>${row.accuracy_pct != null ? row.accuracy_pct + '%' : '—'}</td>
                <td class="num">${row.points}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    const youRowHtml = (meRow && !meInTop)
      ? `<div class="picks-leaderboard-you-row">
           ${avatarHtml({ avatar_key: meRow.avatar_key, display_name: meRow.display_name })}
           <div>You are ranked <strong>#${userRankIdx + 1}</strong> of ${leaderboard.length} — ${meRow.points} pts · ${meRow.correct_count}/${meRow.picks} correct${meRow.accuracy_pct != null ? ' (' + meRow.accuracy_pct + '%)' : ''}</div>
         </div>`
      : '';

    body.innerHTML = tableHtml + youRowHtml;
  } catch (e) {
    body.innerHTML = '<div class="picks-placeholder">Failed to load leaderboard.</div>';
  }
}

async function loadLeaderboardView(){
  const body = document.getElementById('picksLeaderboardBody');
  if (!body) return;
  body.innerHTML = '<div class="picks-loading">Loading leaderboard…</div>';
  try {
    const url = _picksState.lbScope === 'event' && _picksState.eventId
      ? `/api/events/${_picksState.eventId}/picks/leaderboard`
      : '/api/leaderboard';
    const res = await fetch(url);
    const { leaderboard } = await res.json();
    if (!leaderboard || leaderboard.length === 0) {
      body.innerHTML = '<div class="picks-placeholder">Leaderboard is empty. Once users\' picks are reconciled, rankings show here.</div>';
      return;
    }
    body.innerHTML = `
      <table class="picks-leaderboard">
        <thead>
          <tr><th>#</th><th>User</th><th>Picks</th><th>Correct</th><th>Accuracy</th><th>Points</th></tr>
        </thead>
        <tbody>
          ${leaderboard.map((row, i) => {
            const isMe = _currentUser && row.user_id === _currentUser.id;
            return `
              <tr class="${isMe ? 'me' : ''}">
                <td class="num">${i + 1}</td>
                <td>${avatarHtml({ avatar_key: row.avatar_key, display_name: row.display_name }, 'xs')} ${escHtml(row.display_name)}${isMe ? ' <span style="color:var(--cyan)">(you)</span>' : ''}</td>
                <td>${row.picks}</td>
                <td>${row.correct_count}</td>
                <td>${row.accuracy_pct != null ? row.accuracy_pct + '%' : '—'}</td>
                <td class="num">${row.points}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    body.innerHTML = '<div class="picks-placeholder">Failed to load leaderboard.</div>';
  }
}

// Init each module independently — one failure must not cascade
const _inits = [
  ['renderPaceChart', renderPaceChart],
  ['setupNav', setupNav],
  ['setupOctPhaseButtons', setupOctPhaseButtons],
  ['octLoopStart', octLoopStart],
  ['setupSpotlight', setupSpotlight],
  ['setupOctControls', setupOctControls],
  ['setupCrossLinks', setupCrossLinks],
  ['setupRecreation', setupRecreation],
  ['setupPrimaryTabs', setupPrimaryTabs],
  ['setupFightSelector', setupFightSelector],
  ['setupComparePanel', setupComparePanel],
  ['startTicker', startTicker],
  ['initPicksFeature', initPicksFeature]
];
_inits.forEach(([name, fn]) => {
  try { fn(); }
  catch(e) { console.error(`[init] ${name} failed:`, e.message); }
});
document.getElementById('renderTime').textContent = Math.round(performance.now() - __t0);

// Expose functions needed by inline onclick in dynamically generated HTML
window.addToCompare = addToCompare;
window.clearCompareSlot = clearCompareSlot;
window.loadFighterEvents = loadFighterEvents;
window.loadEventCard = loadEventCard;
window.loadEventCardTab = toggleEventCard;
window.loadFightDetailTab = toggleFightDetail;
window.toggleEventCard = toggleEventCard;
window.toggleFightDetail = toggleFightDetail;
window.selectDbFight = selectDbFight;
window.showFighterProfile = showFighterProfile;
window.renderFighterDir = function(){ renderFighterDir(_allFightersData); };

/* -----------------------------------------------------------
   PREDICTION REVIEW TAB — read-only QA overlay
----------------------------------------------------------- */
const REVIEW_DEFAULT_EVENT_ID = 101;
const REVIEW_DEFAULT_OFFICIAL_DATE = '2026-04-25';
let _reviewEvents = null;

async function loadReviewTab(){
  const select = document.getElementById('reviewEventSelect');
  const dateInput = document.getElementById('reviewOfficialDate');
  const reloadBtn = document.getElementById('reviewReloadBtn');
  if (!select || !dateInput || !reloadBtn) return;

  if (!_reviewEvents) {
    try {
      const res = await fetch('/api/events');
      _reviewEvents = await res.json();
    } catch (e) {
      document.getElementById('reviewBody').innerHTML =
        '<div style="color:var(--red);font-family:var(--f-mono);font-size:11px">Failed to load events.</div>';
      return;
    }
  }
  select.innerHTML = _reviewEvents.map(e =>
    '<option value="' + e.id + '">' + escHtml((e.number ? '#' + e.number + ' ' : '') + e.name + ' — ' + (e.date || '')) + '</option>'
  ).join('');
  if (_reviewEvents.some(e => e.id === REVIEW_DEFAULT_EVENT_ID)) {
    select.value = String(REVIEW_DEFAULT_EVENT_ID);
    dateInput.value = REVIEW_DEFAULT_OFFICIAL_DATE;
  } else if (_reviewEvents[0]) {
    select.value = String(_reviewEvents[0].id);
  }

  const trigger = () => fetchAndRenderReview(parseInt(select.value, 10), dateInput.value || null);
  select.addEventListener('change', trigger);
  reloadBtn.addEventListener('click', trigger);
  trigger();
}

async function fetchAndRenderReview(eventId, officialDate){
  const body = document.getElementById('reviewBody');
  body.innerHTML = '<div style="color:var(--muted);font-family:var(--f-mono);font-size:11px;padding:14px 0">Loading review…</div>';
  try {
    const url = '/api/events/' + eventId + '/prediction-review' +
      (officialDate ? '?official_date=' + encodeURIComponent(officialDate) : '');
    const res = await fetch(url);
    if (!res.ok) {
      body.innerHTML = '<div style="color:var(--red);font-family:var(--f-mono);font-size:11px">Review unavailable (' + res.status + ').</div>';
      return;
    }
    const data = await res.json();
    body.innerHTML = renderReviewPayload(data);
  } catch (e) {
    body.innerHTML = '<div style="color:var(--red);font-family:var(--f-mono);font-size:11px">Error loading review: ' + escHtml(String(e && e.message || e)) + '</div>';
  }
}

function _trustColor(grade){
  return grade === 'High' ? 'var(--cyan)' :
         grade === 'Medium' ? '#e6c84a' :
         grade === 'Low' ? '#e08947' : 'var(--red)';
}

function _fmtPct(p){
  if (p == null || isNaN(p)) return '—';
  return (p * 100).toFixed(0) + '%';
}

function renderReviewPayload(data){
  if (!data || !data.event) return '<div style="color:var(--muted)">No data.</div>';
  const ev = data.event;
  const mismatch = ev.date_mismatch
    ? '<div class="review-banner" style="background:rgba(220,90,90,.15);border:1px solid var(--red);color:var(--red);padding:10px 14px;font-family:var(--f-mono);font-size:11px;letter-spacing:.1em;margin-bottom:14px">' +
      'DATE MISMATCH — local seed ' + escHtml(ev.local_date || '—') + ' · official ' + escHtml(ev.official_date || '—') +
      ' · review metadata only; seed not mutated</div>'
    : (ev.official_date
        ? '<div style="font-family:var(--f-mono);font-size:10px;color:var(--muted);margin-bottom:10px;letter-spacing:.1em">DATES OK · local ' + escHtml(ev.local_date || '—') + ' · official ' + escHtml(ev.official_date) + '</div>'
        : '<div style="font-family:var(--f-mono);font-size:10px;color:var(--muted);margin-bottom:10px;letter-spacing:.1em">LOCAL DATE ' + escHtml(ev.local_date || '—') + ' · pass ?official_date= to compare</div>');

  const head = '<div class="review-head" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:6px">' +
    '<div><div class="section-tag">Prediction Review</div>' +
    '<h3 style="margin:4px 0 0 0;font-size:22px">' + escHtml(ev.name || '') + '</h3>' +
    '<div style="font-family:var(--f-mono);font-size:10px;color:var(--muted);letter-spacing:.1em">' +
      escHtml((ev.venue || '') + (ev.city ? ' · ' + ev.city : '') + (ev.country ? ' · ' + ev.country : '')) + '</div></div>' +
    '<div style="font-family:var(--f-mono);font-size:9px;color:var(--muted);letter-spacing:.12em;text-align:right">PRE-FIGHT MODEL · LIVE OBSERVATIONS NOT PERSISTED</div>' +
    '</div>';

  const rows = (data.card || []).map(c => {
    const trustColor = _trustColor(c.trust_grade);
    const lean = c.model
      ? '<span style="color:' + (c.model.lean === 'red' ? 'var(--red)' : 'var(--cyan)') + '">' +
          escHtml(c.model.lean_fighter_name || '') + '</span>' +
          ' <span style="font-family:var(--f-mono);font-size:9px;color:var(--muted)">' + _fmtPct(c.model.confidence) + '</span>'
      : '<span style="color:var(--muted);font-family:var(--f-mono);font-size:10px">no prediction</span>';
    const probs = c.model
      ? '<span style="font-family:var(--f-mono);font-size:10px">R ' + _fmtPct(c.model.red_win_prob) +
          ' · B ' + _fmtPct(c.model.blue_win_prob) + '</span>'
      : '<span style="font-family:var(--f-mono);font-size:10px;color:var(--muted)">—</span>';
    const factors = (c.model && c.model.explanation && c.model.explanation.top_factors)
      ? c.model.explanation.top_factors.map(f =>
          escHtml((f.label || f.feature || '') + ' → ' + (f.fighter || ''))).join('<br>')
      : '';
    const explanationCell = c.model && c.model.explanation && c.model.explanation.summary
      ? '<div style="font-family:var(--f-mono);font-size:10px;color:var(--muted);max-width:280px;white-space:normal">' +
          escHtml(c.model.explanation.summary) +
          (factors ? '<div style="margin-top:4px;font-size:9px;color:var(--muted)">' + factors + '</div>' : '') +
        '</div>'
      : '<span style="font-family:var(--f-mono);font-size:10px;color:var(--muted)">—</span>';
    const completeness =
      'R ' + c.red.completeness.score + '/' + c.red.completeness.total +
      ' · B ' + c.blue.completeness.score + '/' + c.blue.completeness.total +
      ' · stats R' + (c.red.career_stats.total_fights || 0) +
      '/B' + (c.blue.career_stats.total_fights || 0) +
      ' · rounds ' + c.round_stat_rows;
    const warning = c.missing_data_warning
      ? '<div style="font-family:var(--f-mono);font-size:9px;color:#e08947;margin-top:4px;max-width:260px;white-space:normal">' +
          escHtml(c.missing_data_warning) + '</div>'
      : '';
    return '<tr ' + (c.is_main ? 'style="background:rgba(0,255,255,.04)"' : '') + '>' +
      '<td style="text-align:center">' + (c.is_main ? '★' : (c.is_title ? '◆' : (c.card_position || ''))) + '</td>' +
      '<td><b>' + escHtml(c.matchup) + '</b>' +
        (c.weight_class ? '<div style="font-family:var(--f-mono);font-size:9px;color:var(--muted)">' + escHtml(c.weight_class) + '</div>' : '') +
      '</td>' +
      '<td>' + lean + '<div>' + probs + '</div>' +
        (c.model ? '<div style="font-family:var(--f-mono);font-size:9px;color:var(--muted)">' + escHtml(c.model.version || '') + '</div>' : '') +
      '</td>' +
      '<td>' + explanationCell + '</td>' +
      '<td><span style="color:' + trustColor + ';font-weight:600">' + escHtml(c.trust_grade) + '</span>' + warning + '</td>' +
      '<td><span style="font-family:var(--f-mono);font-size:10px;color:var(--muted)">' + escHtml(completeness) + '</span></td>' +
      '<td><button class="rec-btn" style="font-size:9px;padding:4px 8px" onclick="showReviewChecklist(' + c.fight_id + ')">Checklist</button></td>' +
      '</tr>';
  }).join('');

  const table =
    '<div style="overflow-x:auto;border:1px solid var(--border-soft);margin-top:10px">' +
    '<table class="evt-table" style="width:100%">' +
    '<thead><tr><th style="width:34px">#</th><th>Matchup</th><th>Pre-fight model lean</th><th>Top factors</th><th>Trust</th><th>Data coverage</th><th></th></tr></thead>' +
    '<tbody id="reviewTableBody">' + rows + '</tbody></table></div>';

  const audit = data.audit || { blockers: [], confidence_reducers: [], future_enhancements: [] };
  const auditBlock =
    '<div class="review-audit" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:18px">' +
    _renderAuditCol('Blockers', audit.blockers, 'var(--red)') +
    _renderAuditCol('Confidence reducers', audit.confidence_reducers, '#e6c84a') +
    _renderAuditCol('Future enhancements', audit.future_enhancements, 'var(--cyan)') +
    '</div>';

  const sources = (data.official_sources || []).map(u =>
    '<li><a href="' + escHtml(u) + '" target="_blank" rel="noopener" style="color:var(--cyan);font-family:var(--f-mono);font-size:10px;word-break:break-all">' + escHtml(u) + '</a></li>'
  ).join('');
  const sourcesBlock =
    '<div style="margin-top:18px;border-top:1px solid var(--border-soft);padding-top:12px">' +
      '<div class="section-tag" style="color:var(--cyan)">Official sources</div>' +
      '<ul style="list-style:none;padding:0;margin:6px 0 0 0">' + sources + '</ul>' +
    '</div>';

  const checklistAnchor =
    '<div id="reviewChecklistPane" style="margin-top:18px;display:none;border:1px solid var(--border-soft);padding:12px"></div>';

  // Stash payload globally so checklist button can pull from it without refetch.
  window._lastReview = data;

  return head + mismatch + table + auditBlock + sourcesBlock + checklistAnchor;
}

function _renderAuditCol(title, items, color){
  const list = (items && items.length)
    ? '<ul style="margin:6px 0 0 14px;padding:0;font-family:var(--f-mono);font-size:10px;color:var(--muted)">' +
        items.map(t => '<li>' + escHtml(t) + '</li>').join('') + '</ul>'
    : '<div style="font-family:var(--f-mono);font-size:10px;color:var(--muted);margin-top:6px">— none —</div>';
  return '<div style="border:1px solid var(--border-soft);padding:10px">' +
    '<div style="font-family:var(--f-mono);font-size:9px;letter-spacing:.14em;color:' + color + '">' + escHtml(title.toUpperCase()) + '</div>' +
    list + '</div>';
}

function showReviewChecklist(fightId){
  const data = window._lastReview;
  const pane = document.getElementById('reviewChecklistPane');
  if (!data || !pane) return;
  const fight = (data.card || []).find(c => c.fight_id === fightId);
  if (!fight) return;
  pane.style.display = 'block';
  const items = (fight.live_checklist || []).map(item =>
    '<li style="display:flex;gap:10px;align-items:flex-start;margin:4px 0">' +
      '<input type="checkbox" data-checklist-key="' + escHtml(item.key) + '" style="margin-top:3px"> ' +
      '<span style="font-family:var(--f-mono);font-size:11px">' + escHtml(item.label) + '</span></li>'
  ).join('');
  pane.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<div><div class="section-tag">Live observation checklist</div>' +
      '<div style="font-size:14px;margin-top:2px"><b>' + escHtml(fight.matchup) + '</b></div></div>' +
      '<div style="font-family:var(--f-mono);font-size:9px;color:var(--muted);letter-spacing:.12em">NOT PERSISTED · NOT A PREDICTION INPUT</div>' +
    '</div>' +
    '<ul style="list-style:none;padding:0;margin:8px 0 0 0">' + items + '</ul>';
  pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.showReviewChecklist = showReviewChecklist;

// Fetch and display version from API
fetch('/api/version').then(r=>r.json()).then(v=>{
  const tag = `v${v.version}+${v.sha}`;
  const el = document.getElementById('appVersion');
  if (el) el.textContent = tag;
  const ft = document.getElementById('appVersionFooter');
  if (ft) ft.textContent = tag;
  const tb = document.querySelector('.top-bar__name');
  if (tb) tb.textContent = `Octagon Tactical · ${tag}`;
}).catch(()=>{});
})();
