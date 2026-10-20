import * as career from './career/career.js';
import { saveCareer, loadCareer, listSaves, deleteSave } from './career/save.js';
import { createRng } from './engine/rng.js';
import { createQualifying } from './engine/qualifying.js';
import { RaceSim } from './engine/race.js';
import { DecisionDirector } from './decisions/director.js';
import { StrategyRadio } from './decisions/radio.js';
import * as screens from './ui/screens.js';
import { mountRace } from './ui/race.js';
import { mountQualifying } from './ui/qualifying.js';

const root = document.querySelector('#app');
const notice = document.querySelector('#notice');
let state, cleanup = () => {}, saveStatus = '賽後會自動存檔', noticeTimer;
function message(text) { notice.textContent = text; notice.classList.add('visible'); clearTimeout(noticeTimer); noticeTimer = setTimeout(()=>notice.classList.remove('visible'),5000); }
function autoSave() { const saved = saveCareer(state,'auto'); saveStatus = saved ? '已自動存檔' : '存檔失敗：請確認瀏覽器允許本機儲存'; if (!saved) message(saveStatus); return saveStatus; }
function route(render) { cleanup(); cleanup = () => {}; window.scrollTo(0,0); try { cleanup = render() ?? (()=>{}); } catch(error) { message(`無法切換畫面：${error.message}`); console.error(error); } }
function title() { route(()=>screens.titleScreen(root,listSaves(),{ create:()=>route(()=>screens.createScreen(root,profile=>{ state=career.createCareer({...profile,seed:Date.now().toString()}); roster(); },title)), load:slot=>{ const loaded=loadCareer(slot); if(!loaded) return message('無法讀取此存檔'); state=loaded; resume(); }, delete:slot=>{ if(!deleteSave(slot)) message('刪除失敗'); title(); } })); }
const rosterActions = {
  updateRoster: changes => { const result = career.updateRoster(state, changes); if (result.ok) result.saveStatus = autoSave(); return result; },
  resetRoster: () => { career.resetRoster(state); return autoSave(); },
};
function roster() { route(()=>screens.rosterScreen(root,state,{ ...rosterActions, done:offers })); }
function offers() { route(()=>{ const content=screens.shell(root,'選擇新秀合約','三個席位，三條不同的起跑線。',title); content.append(screens.offerCards(state,id=>{ career.acceptInitialContract(state,id); autoSave(); hub(); })); }); }
function resume() {
  if(!state.contract) return offers();
  if(state.season.ended) return seasonEnd();
  if(state.weekend.classification) return postrace();
  hub();
}
function hub(tab='overview') { route(()=>screens.hubScreen(root,state,tab,{ title,tab:hub,weekend,saveStatus,read:autoSave,...rosterActions })); }
function weekend() {
  if(state.weekend.classification) return postrace();
  if(state.weekend.qualifying.length) return qualifying();
  route(()=>screens.practiceScreen(root,state,career.getPracticeOptions(state),id=>{
    career.applyPractice(state,id);
    qualifyingSession();
  },hub));
}
// 座艙排位：Q1／Q2／Q3 每節 P 房 → 暖胎圈 → 飛馳圈 → 冷卻圈。
function qualifyingSession() {
  route(()=>{
    const {entries,modifiers}=career.buildEntries(state), {track}=career.getCurrentWeekend(state);
    const q=createQualifying({track,entries,modifiers,weather:{initial:'dry'},rng:raceRng().fork('qualifying')});
    return mountQualifying(root,{qualifying:q,entries,teams:state.teams,track,player:state.player,onFinish:(grid,sessions)=>{
      career.recordQualifying(state,grid,sessions); autoSave(); qualifying();
    }});
  });
}
function raceRng() { return createRng(JSON.stringify([state.seed,state.year,state.season.round])); }
function qualifying() { route(()=>screens.qualifyingScreen(root,state,startRace)); }
function startRace() {
  route(()=>{
    const {entries,modifiers}=career.buildEntries(state),{track}=career.getCurrentWeekend(state),rng=raceRng();
    const sim=new RaceSim({track,entries,modifiers,grid:state.weekend.qualifying.map(r=>r.carId),rng:rng.fork('race'),playerId:state.player.id});
    const player={ carId:state.player.id,stats:state.player.stats,teamTrust:state.teamTrust,contractRole:state.contract.role };
    const team=state.teams.find(t=>t.id===state.contract.teamId), teammateId=entries.find(e=>!e.isPlayer&&e.team.id===team.id)?.carId;
    const director=new DecisionDirector({sim,rng:rng.fork('decisions'),player,teammateId,engineerName:team.engineer});
    const radio=new StrategyRadio({sim,director,rng:rng.fork('radio'),player,engineerName:team.engineer});
    return mountRace(root,{sim,director,radio,teams:state.teams,track,player:{name:state.player.name,number:state.player.number},onFinish:()=>{
      career.recordRace(state,sim.getClassification(),director.getSummary()); autoSave(); postrace();
    }});
  });
}
function postrace() { route(()=>screens.postraceScreen(root,state,career.getMediaQuestions(state),(q,c)=>{ career.answerMedia(state,q,c); autoSave(); postrace(); },()=>{
  if(career.getCurrentWeekend(state).isLastRound) { career.endSeason(state); autoSave(); seasonEnd(); }
  else { career.advanceRound(state); autoSave(); hub(); }
},saveStatus)); }
function seasonEnd() { route(()=>{
  screens.seasonEndScreen(root,state,id=>{career.acceptOffer(state,id); autoSave(); seasonEnd();},()=>{career.declineOffers(state);career.startNextSeason(state);autoSave();hub();},saveStatus);
  const back=document.createElement('button');back.textContent='返回標題';back.onclick=title;root.querySelector('.page-content').append(back);
}); }
title();
