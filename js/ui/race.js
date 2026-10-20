import { element, button, confirmPanel } from './dom.js';
import { Cockpit } from './cockpit.js';
import { Cockpit3D, webglAvailable } from './cockpit3d/index.js';
import { decisionCard } from './decisionCard.js';
import { timingTower } from './timingTower.js';
import { radioPanel } from './radioPanel.js';
import { RaceClock } from './raceClock.js';
import { flagState, nameplate, gauge, fallbackTelemetry } from './hud.js';
import { RaceAudio } from './audio.js';
import { voiceForEngineEvent } from './voiceLines.js';

const SOUND_KEY='pit-wall-radio:sound';
const readSound=()=>{try{return localStorage.getItem(SOUND_KEY)!=='off';}catch{return true;}};
const writeSound=on=>{try{localStorage.setItem(SOUND_KEY,on?'on':'off');}catch{}};

export function mountRace(root,{sim,director,radio,teams,track,player,onFinish}) {
  root.className='race-screen'; root.replaceChildren(); document.title=`正賽 · ${track.name}｜維修站無線電`;
  const canvas=element('canvas','cockpit'); canvas.setAttribute('aria-label','第一人稱座艙：賽道、前後車、後照鏡與方向盤儀表');
  const playerCar=sim.getCar(sim.playerId);
  const team=teams.find(t=>t.id===playerCar.teamId);
  const teammateId=sim.state.cars.find(c=>c.teamId===playerCar.teamId&&!c.isPlayer)?.carId;
  const hud=element('div','race-hud');
  const tower=timingTower(teams);
  const plate=nameplate({name:player?.name??playerCar.name,number:player?.number,team});
  const dial=gauge();
  const audio=new RaceAudio({enabled:readSound(),volume:.8,voice:true,lang:'zh-TW'});
  // 無線電語音直接念繁中字幕（工程師台詞）。
  // 英文無線電語音（Kokoro 預先生成的台詞庫，見 assets/voice）；字幕維持繁中。
  const v=(key,priority='normal')=>{try{audio.voice?.(key,{priority})?.catch?.(()=>{});}catch{}};
  const vs=(items,priority='normal')=>{try{audio.voiceSequence?.(items,{priority})?.catch?.(()=>{});}catch{}};
  const gapItems=g=>g>3?['more_than_three']:[{num:'gap_'+Math.max(1,Math.round(g*10))},'seconds'];
  const DECISION_VOICE={overtake:'overtake',defend:'defend',pit_window:'pit_window',team_order:'team_order',safety_car:'safety_car',weather:'weather',damage:'damage'};
  const TOPIC_VOICE={tyres:'ask_tyres',gaps:'ask_gap',strategy:'ask_strategy',plan_b:'ask_strategy',undercut:'ask_strategy',weather:'ask_weather',rivals:'ask_rivals',push:'push',conserve:'conserve',extend:'extend',pit:'box_now',cancel_pit:'stay_out'};
  const ACTION_VOICE={pit:'box_now',cancelPit:'stay_out',extend:'extend'};
  const panel=radioPanel(radio,{name:player?.name??playerCar.name,number:player?.number,team,onExchange:({kind,topicId,action})=>{
    if(kind==='ask') v(TOPIC_VOICE[topicId]??'copy');
    else v(action?.type==='pushMode'?(action.value==='push'?'push':'conserve'):ACTION_VOICE[action?.type]??'copy');
  }});
  const bug=element('div','tv-bug','PWR'); bug.append(element('span','','TV'));
  const control=element('div','race-control'); control.setAttribute('role','log'); control.setAttribute('aria-label','賽事管制訊息');
  const decisionHost=element('div','decision-host');
  const result=element('div','race-result'); result.setAttribute('role','status');
  const controls=element('div','race-controls');
  let frame,finishTimer,resultTimer,controlTimer,disposed=false,card=null,previous=performance.now(),lastUi=0,lastTopicsLap=-1;
  // 優先使用 Three.js 擬真座艙；不支援 WebGL 時退回 2D 版。
  let cockpit;
  try { cockpit=webglAvailable()?new Cockpit3D(canvas,teams,track):new Cockpit(canvas,teams,track); }
  catch(error) { console.warn('3D 座艙初始化失敗，改用 2D 版',error); cockpit=new Cockpit(canvas,teams,track); }
  if(globalThis.__pwrDev)globalThis.__pwrDev.cockpit=cockpit; // 開發測試頁用
  const telemetry=()=>cockpit.getTelemetry?.()??fallbackTelemetry(clock.motion,sim.state.safetyCar);

  // 賽事管制訊息：一次一則，較舊的排隊。
  const queue=[];
  function broadcast(text) {
    if(!text)return;
    queue.push(text); if(queue.length>4)queue.shift();
    if(!control.classList.contains('visible'))nextControl();
  }
  function nextControl() {
    const text=queue.shift();
    if(!text){control.classList.remove('visible');return;}
    control.textContent=text; control.classList.add('visible');
    clearTimeout(controlTimer); controlTimer=setTimeout(nextControl,queue.length?2200:3800);
  }
  function resolve(event,choice) {
    const before=sim.getPlayerSituation(),oldPosition=before.position;
    const outcome=director.resolve(event.id,choice);
    const newPosition=sim.getCar(sim.playerId).position;
    if(newPosition<oldPosition) cockpit.transition('pass',before.carAhead);
    if(newPosition>oldPosition) cockpit.transition('lost',before.carBehind);
    decisionHost.replaceChildren(); card=null;
    result.textContent=`${outcome.timedOut?'猶豫了… ':''}${outcome.text}`;
    result.className=`race-result visible ${outcome.success===false?'failed':outcome.success?'success':''}`;
    clearTimeout(resultTimer); resultTimer=setTimeout(()=>result.classList.remove('visible'),4000);
    panel.push(outcome.radio);
    const ok=outcome.success;
    v(outcome.timedOut?'hesitate':event.type==='overtake'?(ok===true?'pass_done':ok===false?'pass_fail':'hold'):event.type==='defend'?(ok===true?'defend_ok':ok===false?'defend_fail':'copy'):['pit','repair'].includes(choice)?'box_now':'copy');
  }
  // 整場正賽約 3 分鐘：每圈動畫秒數依圈數換算。
  const lapSeconds=Math.min(34,Math.max(10,300/sim.state.totalLaps)); // 0.6 倍節奏：一場約 5 分鐘
  const clock=new RaceClock({
    lapSeconds,
    check:()=>director.check(),
    onDecision:event=>{card=decisionCard(event,id=>clock.choose(id,resolve));decisionHost.replaceChildren(card.node);panel.push(event.radio);v(event.type==='safety_car'&&sim.state.safetyCar==='vsc'?'vsc':DECISION_VOICE[event.type]??'copy','high');},
    step:()=>{
      const before=sim.getCar(sim.playerId).tyre.wear;
      const {events}=sim.stepLap();
      const after=sim.getCar(sim.playerId).tyre.wear;
      if(after>=before)wearDelta=after-before; // 進站預告用的每圈磨耗估計
      if(cockpit.pitPlan&&!events.some(e=>e.type==='pit'&&e.carId===sim.playerId))cockpit.planPit(false);
      events.forEach(event=>{
        broadcast(event.text);
        const mine=event.carId===sim.playerId;
        const key={vsc_deploy:'vsc',sc_end:'green_flag',rain_start:'weather',rain_stop:'drying'}[event.type]
          ??(mine&&event.type==='penalty'?(event.seconds>=10?'penalty_10':'penalty_5'):mine&&event.type==='penalty_warning'?'track_limits':mine&&event.type==='dnf'?'retire':null);
        if(key) v(key,event.type==='dnf'?'high':'low');
        if(mine&&event.type==='pit'){ v('pit_limiter'); setTimeout(()=>{if(!disposed)v(event.stationarySeconds>4?'slow_stop':'good_stop');},Math.max(4000,(event.stationarySeconds??2.6)*1000+3500)); }
        if(event.type==='pit'&&event.carId===sim.playerId) cockpit.transition('pit',null,event);
      });
      report();
      return sim.state.finished;
    },
    onFinish:()=>{
      broadcast('方格旗揮動 · 賽事結束');
      const me=sim.getCar(sim.playerId);
      if(me.status!=='dnf'){
        chequer.hidden=false; chequer.querySelector('b').textContent=`第 ${me.position} 名完賽`;
        cockpit.startCooldown?.();
        const lines=[{speaker:'engineer',text:`方格旗！第 ${me.position} 名完賽${me.position<=3?'，站上頒獎台！':me.position<=10?'，拿到積分，做得好。':'，辛苦了。'}`},{speaker:'player',text:'辛苦了大家，謝謝車隊和工廠的每一個人。'}];
        panel.push(lines);
        const p=me.position; vs(['chequered','thats',{num:'p_'+p}],'high'); v(p===1?'finish_win':p<=3?'finish_podium':p<=10?'finish_points':'finish_tough'); setTimeout(()=>{if(!disposed)v('player_thanks');},4200);
      }
      finishTimer=setTimeout(()=>{if(!disposed)onFinish();},me.status==='dnf'?2600:8500);
    },
  });

  const speeds=[];
  for(const speed of [1,2,4]) {
    const b=button(`${speed}×`,()=>{clock.speed=speed;for(const entry of speeds){entry.node.classList.toggle('active',entry.value===speed);entry.node.setAttribute('aria-pressed',String(entry.value===speed));}},speed===1?'active':'');
    b.setAttribute('aria-label',`${speed} 倍播放速度`);b.setAttribute('aria-pressed',String(speed===1));speeds.push({node:b,value:speed});controls.append(b);
  }
  const radioButton=button('無線電',()=>{const open=panel.toggle();radioButton.classList.toggle('active',open);radioButton.setAttribute('aria-pressed',String(open));},'radio-toggle');
  radioButton.setAttribute('aria-pressed','false');
  const menu=element('div','race-menu');menu.hidden=true;
  menu.append(element('p','muted','選單開啟時比賽持續進行。'),button('放棄本場（退賽）',()=>{
    if(sim.state.finished)return;
    confirmPanel(menu,'確定放棄本場並退賽？此決定無法撤回，比賽會繼續。','確認退賽',()=>{
      if(clock.pending) clock.choose(null,resolve);
      sim.retire(sim.playerId,'主動放棄本場'); menu.hidden=true;broadcast('你已放棄本場，等待其他車手完賽。');
    });
  },'danger'));
  const soundButton=button('',()=>{const on=!audio.enabled;audio.setEnabled(on);if(on)audio.start();writeSound(on);paintSound();},'sound-toggle');
  const paintSound=()=>{soundButton.textContent=audio.enabled?'音效 開':'音效 關';soundButton.classList.toggle('active',audio.enabled);soundButton.setAttribute('aria-pressed',String(audio.enabled));};
  audio.enabled=readSound(); paintSound();
  controls.append(radioButton,soundButton,button('選單',()=>{menu.hidden=!menu.hidden;}));

  const dnf=element('div','dnf-banner','已退賽 · 等待賽事結束'); dnf.hidden=true;
  // 轉播式 IN PIT 計時卡
  const pitCard=element('div','pit-card'); pitCard.hidden=true;
  const pitHead=element('div','pc-head'); pitHead.append(element('b','pc-pos'),element('i','pc-team'),element('span','pc-name',player?.name??playerCar.name));
  const pitTime=element('strong','pc-time','0.0'); const pitBody=element('div','pc-body'); pitBody.append(element('span','','IN PIT'),pitTime);
  pitCard.append(pitHead,pitBody); pitCard.style.setProperty('--team',team.color);
  hud.append(tower.node,controls,bug,control,decisionHost,result,panel.node,plate.node,dial.node,dnf,pitCard,menu);
  root.append(canvas,hud);
  document.body.classList.add('racing');
  cockpit.resize();
  audio.start();
  // 瀏覽器需使用者手勢才能播放聲音；首次點擊畫面時再嘗試啟動。
  root.addEventListener('pointerdown',()=>audio.start(),{once:true});
  // ── 起跑程序：發車格就位 → 五盞紅燈逐一亮起 → 隨機延遲後熄燈；玩家按「起步」量測反應時間 ──
  const lightsBar=element('div','start-lights'); lightsBar.setAttribute('aria-hidden','true');
  for(let i=0;i<5;i++){const pod=element('div','light-pod');pod.append(element('i'),element('i'));lightsBar.append(pod);}
  const startPanel=element('div','start-panel');
  const startHint=element('p','start-hint','車輛已在發車格就位。紅燈全部熄滅的瞬間按下起步（空白鍵）。');
  const startButton=button('起步',()=>launch(),'start-button');
  startPanel.append(startHint,startButton);
  hud.append(lightsBar,startPanel);
  startPanel.hidden=true; lightsBar.hidden=true; // 編隊圈結束、回到發車格後才出現
  const gridPosition=playerCar.position;
  cockpit.setGrid?.(gridPosition);
  const start={phase:'intro',t:0,lights:0,hold:0.4+Math.random()*2.4,pressed:false,said:new Set()};
  // 轉播標題卡（開場）與方格旗橫幅（完賽）
  const titleCard=element('div','title-card');
  titleCard.append(element('small','',`${track.country??''} · ${track.city??''} · ${sim.state.totalLaps} 圈`),element('h2','',track.name),element('span','',track.nameEn??''),element('b','',`${player?.name??playerCar.name} · ${team.name}`));
  titleCard.style.setProperty('--team',team.color);
  const chequer=element('div','chequer'); chequer.hidden=true; chequer.append(element('i'),element('b'));
  hud.append(titleCard,chequer);
  const radioLine=(key,lines,priority='normal',voice)=>{ if(start.said.has(key))return; start.said.add(key); panel.push(lines); if(Array.isArray(voice)) vs(voice,priority); else if(voice) v(voice,priority); };
  broadcast(`第 ${gridPosition} 位發車 · ${track.name} · ${sim.state.totalLaps} 圈`);
  // 正賽定期報告：剩餘圈數、名次與差距、超車模式、最後一圈
  let lastOvertake=false,lastGapReport=0;
  function report(){
    const lap=sim.state.lap,left=sim.state.totalLaps-lap,me=sim.getCar(sim.playerId); if(me.status==='dnf'||sim.state.finished)return;
    const s=sim.getPlayerSituation();
    if(left===1) radioLine('last',[{speaker:'engineer',text:'最後一圈！最後一圈！把車帶回家。'}],'high','last_lap');
    else if([10,5,3,2].includes(left)) radioLine('left'+left,[{speaker:'engineer',text:`還剩 ${left} 圈。${left<=3?'全力推進。':'注意輪胎管理。'}`}],'normal','laps_'+left);
    else if(lap-lastGapReport>=4&&lap>1){ lastGapReport=lap; radioLine('gap'+lap,[{speaker:'engineer',text:`目前第 ${s.position} 名${s.carAhead?`，與前車差 ${s.carAhead.gap.toFixed(1)} 秒`:''}${s.carBehind?`，後車 ${s.carBehind.gap.toFixed(1)} 秒`:''}。`}],'low',['you_are',{num:'p_'+s.position},...(s.carAhead?['gap_ahead',...gapItems(s.carAhead.gap)]:[])]); }
    const ot=typeof sim.overtakeModeAvailable==='function'&&sim.overtakeModeAvailable(sim.playerId);
    if(ot&&!lastOvertake) radioLine('ot'+lap,[{speaker:'engineer',text:'超車模式可用，超車模式可用。'}],'normal','overtake_mode');
    lastOvertake=ot;
  }
  function setLights(n){start.lights=n;cockpit.setLights?.(n);lightsBar.querySelectorAll('.light-pod').forEach((p,i)=>p.classList.toggle('on',i<n));}
  function launch(){
    // 開場與編隊圈期間按起步不算數，回到發車格後才開始判定（含偷跑）
    if(start.phase==='done'||start.pressed||start.phase==='intro'||start.phase==='formation')return;
    start.pressed=true;
    if(start.phase!=='go'){finishStart('jump');return;}
    finishStart(Math.max(0.1,start.t));
  }
  function finishStart(reaction){
    start.phase='done';
    sim.setStartReaction?.(sim.playerId,reaction);
    cockpit.release?.(); setLights(0);
    startPanel.remove(); lightsBar.classList.add('out');
    setTimeout(()=>lightsBar.remove(),1200);
    const text=reaction==='jump'?'偷跑！賽會將判罰 5 秒。':`熄燈起步 · 反應時間 ${reaction.toFixed(3)} 秒${reaction<0.2?' · 完美起步':reaction>0.45?' · 起步偏慢':''}`;
    result.textContent=text; result.className=`race-result visible ${reaction==='jump'||reaction>0.45?'failed':'success'}`;
    clearTimeout(resultTimer); resultTimer=setTimeout(()=>result.classList.remove('visible'),3200);
    broadcast('五盞紅燈熄滅 · 比賽開始');
    setTimeout(()=>{if(!disposed)v(reaction==='jump'?'jump_start':reaction<0.35?'good_start':'bad_start');},2500);
  }
  function tickStart(dt){
    start.t+=dt;
    if(start.phase==='intro'){
      if(start.t>0.6) radioLine('check',[{speaker:'player',text:'無線電測試。'},{speaker:'engineer',text:'收得很清楚。接下來是編隊圈，跟緊前車，把輪胎溫度帶起來。'}],'high',['radio_check']); if(start.t>0.6&&!start.said.has('clear')){start.said.add('clear');setTimeout(()=>{if(!disposed)v('loud_clear','high');},1400);}
      if(start.t>4.2){ titleCard.classList.add('out'); start.phase='formation'; start.t=0; cockpit.startFormation?.(22); broadcast('編隊圈開始'); }
      return;
    }
    if(start.phase==='formation'){
      if(start.t>4) radioLine('weave',[{speaker:'engineer',text:'左右擺動暖胎，前胎溫度還不夠。'}],'normal','formation_weave');
      if(start.t>10) radioLine('clutch',[{speaker:'engineer',text:'離合器咬合點目標 45，起步前練習一次燒胎。'}],'normal','formation_clutch');
      if(start.t>17) radioLine('mode',[{speaker:'engineer',text:'切換到起步模式，回到你的發車格。'}],'normal','formation_mode');
      if(cockpit.formationDone!==false&&start.t>(cockpit.formationDone===undefined?3:0.5)){ start.phase='grid'; start.t=0; titleCard.remove(); startPanel.hidden=false; lightsBar.hidden=false; broadcast('全員就位 · 準備起跑'); }
      return;
    }
    if(start.phase==='grid'&&start.t>2.2){start.phase='lights';start.t=0;setLights(1);}
    else if(start.phase==='lights'&&start.t>=1){start.t=0;if(start.lights<5)setLights(start.lights+1);else{start.phase='hold';}}
    else if(start.phase==='hold'&&start.t>=start.hold){start.phase='go';start.t=0;setLights(0);startHint.textContent='熄燈！';}
    else if(start.phase==='go'&&start.t>1.2&&!start.pressed){start.pressed=true;finishStart(1.2);}
  }

  function keydown(event) {
    if(event.repeat||event.ctrlKey||event.altKey||event.metaKey)return;
    const target=event.target;
    if(target instanceof HTMLElement&&target.closest('input,select,textarea'))return;
    if(event.code==='Space'&&start.phase!=='done'){event.preventDefault();launch();return;}
    const index=Number(event.key)-1;
    if(clock.pending&&index>=0&&index<4) {
      const choice=clock.pending.choices[index];if(choice){event.preventDefault();clock.choose(choice.id,resolve);}
    }
  }
  window.addEventListener('keydown',keydown);
  // 進站預告：接近維修區入口時，預測本圈結束是否進站（以上一圈的磨耗量推估），預測要進站就鎖定請求，
  // 讓車子從入口沿進站路切入，而不是過了起終點線才切換畫面。
  let pitPlanLap=-1,wearDelta=0;
  function planPit(){
    const ts=cockpit.trackside;
    if(!ts||start.phase!=='done'||cockpit.mode!=='race'||cockpit.pit||sim.state.finished)return;
    const car=sim.getCar(sim.playerId),lap=sim.state.lap;
    if(car.status!=='running')return;
    const rel=ts.relative(cockpit.s);
    if(pitPlanLap===lap||rel<ts.pit.from-220||rel>ts.pit.from)return;
    pitPlanLap=lap;
    let compound=car.pitRequest;
    if(!compound&&typeof sim.choosePit==='function'){
      const wear=car.tyre.wear,age=car.tyre.age;
      car.tyre.wear=Math.min(100,wear+wearDelta);car.tyre.age=age+1;
      try{compound=sim.choosePit(car);}catch{compound=null;}
      car.tyre.wear=wear;car.tyre.age=age;
    }
    if(compound){ if(!car.pitRequest)sim.requestPit(sim.playerId,compound); cockpit.planPit(true); }
  }
  function animate(now) {
    if(disposed)return;
    const seconds=Math.max(0,(now-previous)/1000);previous=now;
    if(start.phase!=='done') tickStart(seconds); else clock.tick(seconds,resolve);
    cockpit.draw(sim,clock.motion,Math.min(seconds,.1));
    planPit();
    if(card)card.update(clock.remaining);
    const car=sim.getCar(sim.playerId),s=sim.getPlayerSituation();
    const t=telemetry();
    const overtake=t.overtake??(typeof sim.overtakeModeAvailable==='function'?sim.overtakeModeAvailable(sim.playerId):!!(s.carAhead&&s.carAhead.gap<1&&sim.state.lap>=2&&s.safetyCar==='none'&&s.wetness<0.2));
    dial.update(t,car,overtake&&car.status==='running');
    const pit=cockpit.pitState?.();
    pitCard.hidden=!pit||pit.phase==='garage';
    if(pit&&pit.phase!=='garage'){pitTime.textContent=pit.elapsed.toFixed(1);pitCard.querySelector('.pc-pos').textContent=car.position;pitBody.firstChild.textContent=pit.phase==='out'?'PIT EXIT':'IN PIT';}
    const pitPhase=cockpit.pitState?.();
    audio.update(t,{safetyCar:sim.state.safetyCar,inPit:car.status==='pit'||!!pitPhase,dnf:car.status==='dnf',wet:sim.state.wetness>=0.2,timeScale:clock.speed*(clock.pending?0.35:1),
      phase:pitPhase?'pit':cockpit.mode==='formation'?'formation':cockpit.mode==='grid'?'grid':cockpit.mode==='cooldown'?'cooldown':'race',traffic:cockpit.traffic?.()??[]});
    if(now-lastUi>120) {
      lastUi=now;
      const flag=flagState(sim);
      tower.update(sim,flag);
      hud.dataset.flag=flag.kind;
      plate.update(car);
      dnf.hidden=car.status!=='dnf'||sim.state.finished;
      if(lastTopicsLap!==sim.state.lap) {lastTopicsLap=sim.state.lap;if(panel.open)panel.refresh();}
    }
    frame=requestAnimationFrame(animate);
  }
  frame=requestAnimationFrame(animate);
  return ()=>{document.body.classList.remove('racing');disposed=true;cancelAnimationFrame(frame);clearTimeout(finishTimer);clearTimeout(resultTimer);clearTimeout(controlTimer);window.removeEventListener('keydown',keydown);cockpit.dispose();panel.dispose();audio.dispose();};
}
