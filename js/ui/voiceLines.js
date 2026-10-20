// Pure, deterministic radio copy. Never read translated event.text or driver names.
const TYRES = { soft: 'softs', medium: 'mediums', hard: 'hards', inter: 'inters', wet: 'wets' };
const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const fixed = value => number(value).toFixed(1);
const tyre = value => TYRES[value] ?? 'tyres';
function pick(key, lap, lines) {
  let hash = 0;
  for (const char of key) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return lines[(hash + Math.max(0, Math.floor(number(lap)))) % lines.length];
}
function data(s = {}) {
  return { p: `P${Math.max(1, Math.floor(number(s.position, 1)))}`, lap: number(s.lap),
    left: number(s.lapsRemaining), wear: fixed(s.tyre?.wear), tyres: tyre(s.tyre?.compound),
    ahead: s.carAhead ? `${fixed(s.carAhead.gap)} seconds` : null,
    behind: s.carBehind ? `${fixed(s.carBehind.gap)} seconds` : null,
    wet: Math.round(number(s.wetness) * 100) };
}

export function voiceForDecision(event, situation = {}) {
  if (!event) return null;
  const d = data(situation), lap = event.lap ?? d.lap;
  const ahead = d.ahead ? `Car ahead, ${d.ahead}.` : `You are ${d.p}.`;
  const behind = d.behind ? `Car behind, ${d.behind}.` : `You are ${d.p}.`;
  const lines = {
    overtake: [`${ahead} Choose your passing opportunity.`, `${ahead} Can you make the move?`, `${ahead} Set up a clean exit for the attack.`],
    defend: [`${behind} Cover the inside on entry.`, `${behind} Protect the exit, one defensive move.`, `${behind} Decide whether to defend or save the tyres.`],
    pit_window: [`Pit window is open, wear ${d.wear} percent. Box or extend?`, `Tyre wear ${d.wear} percent. Confirm box this lap or stay out.`, `${d.tyres}, wear ${d.wear} percent. We need your pit decision.`],
    team_order: [`You are ${d.p}. Your teammate needs a position swap.`, `${d.p}, team order requested. Confirm the swap with your teammate.`, `Team instruction for ${d.p}. Can you exchange positions with your teammate?`],
    safety_car: [`${situation.safetyCar === 'vsc' ? 'Virtual safety car' : 'Safety car'} deployed, you are ${d.p}. Consider boxing under neutralisation.`, `You are ${d.p} under neutralisation. Box or keep track position?`, `Neutralised running, tyre wear ${d.wear} percent. Confirm pit or stay out.`],
    weather: [`Track wetness ${d.wet} percent. Confirm a tyre change or stay out.`, `Wetness reading ${d.wet} percent. Give us your grip assessment.`, `Conditions changing, wetness ${d.wet} percent. Box for suitable tyres or continue?`],
    damage: [`Damage reported, ${d.left} laps remaining. Box for repairs or manage the car?`, `${d.left} laps to go with damage. Keep clear of the kerbs and confirm your plan.`, `We need a damage decision, ${d.left} laps left. Repair or continue?`],
  }[event.type];
  return lines ? pick(event.type, lap, lines) : null;
}

export function voiceForOutcome(event, choiceId, outcome = {}, situation = {}) {
  if (!event || !['overtake', 'defend', 'pit_window', 'team_order', 'safety_car', 'weather', 'damage'].includes(event.type)) return null;
  const d = data(situation), id = choiceId ?? event.defaultChoiceId;
  if (outcome.timedOut) {
    const action = ({ pit: 'box this lap', repair: 'box for repairs', manage: 'manage the damage',
      normal: 'use standard defence', extend: 'extend the stint',
      wait: 'wait and assess grip', negotiate: 'hold position for now', stay: 'stay out', hold: 'hold position' })[event.defaultChoiceId] ?? 'hold position';
    return pick(`${event.type}:timeout`, event.lap ?? d.lap, [
      `No answer from you... we'll ${action}. Currently ${d.p}.`,
      `Still waiting... default instruction, ${action}. You are ${d.p}.`,
      `No confirmation... we'll ${action}. ${d.left} laps remaining.`,
    ]);
  }
  let lines;
  if (['overtake', 'defend'].includes(event.type) && !['hold', 'yield'].includes(id)) {
    lines = outcome.success === true
      ? (event.type === 'overtake' ? ['Move complete, good job.', 'Clean pass, well done.', 'Position gained, settle into rhythm.']
        : ['Position held, good defence.', 'You kept the place, well managed.', 'Defence complete, focus on the exit.'])
      : outcome.success === false
        ? (event.type === 'overtake' ? ['Move did not work, reset.', 'Attack unsuccessful, look after the tyres.', 'No pass this time, build another opportunity.']
          : ['Position lost, regroup.', 'They are through, focus ahead.', 'Defence unsuccessful, settle the car.'])
        : ['Situation changed, reassess the gap.', 'Opportunity has gone, maintain your rhythm.', 'Battle interrupted, follow the current conditions.'];
  } else {
    lines = ({
      hold: ['Copy, hold position.', 'Understood, prepare another opportunity.', 'Copy, save the tyres in the slipstream.'],
      yield: ['Copy, let the car through safely.', 'Understood, yield and protect the tyres.', 'Copy, give room and focus on your pace.'],
      pit: ['Copy, box this lap.', 'Box confirmed, pit entry this lap.', 'Understood, crew ready for your stop.'],
      push: ['Copy, push for one more lap.', 'Understood, attack the in-lap.', 'Copy, push now and reassess next lap.'],
      extend: ['Copy, Plan B, extend the stint.', 'Understood, stay out and save the tyres.', 'Copy, extend and keep the tyres alive.'],
      obey: outcome.success === null ? ['Swap no longer available.', 'Team order withdrawn for now.', 'Situation changed, maintain your rhythm.']
        : ['Copy, position swap complete.', 'Swap confirmed, thank you.', 'Understood, team instruction completed.'],
      refuse: ['Copy, you are declining the swap.', 'Understood, maintaining position.', 'Copy, we will discuss the team order later.'],
      negotiate: ['Copy, maintain the order for now.', 'Understood, show us your pace.', 'Copy, keep the team battle clean.'],
      stay: ['Copy, stay out.', 'Understood, keep track position.', 'Copy, maintain the safety car delta.'],
      conserve: ['Copy, conserve and keep temperature in the tyres.', 'Understood, save the tyres for the restart.', 'Copy, manage the pace and tyre temperatures.'],
      wait: ['Copy, one lap to assess grip.', 'Understood, wait and report conditions.', 'Copy, stay out and monitor grip.'],
      gamble: outcome.success === false ? ['Grip is insufficient, settle the car.', 'That did not work, reduce the risk.', 'Time lost in these conditions, reassess.']
        : outcome.success === true ? ['Conditions managed, good work.', 'That worked, keep monitoring grip.', 'Good control, continue assessing the surface.']
          : ['Copy, continue and monitor grip.', 'Understood, assess conditions as you go.', 'Copy, stay alert for changing grip.'],
      repair: ['Copy, box for repairs.', 'Understood, repairs at the stop.', 'Copy, crew preparing repairs.'],
      manage: ['Copy, manage the damage and avoid kerbs.', 'Understood, bring the car home carefully.', 'Copy, reduce the load on the car.'],
      risk: outcome.success === false ? ['Damage has worsened, ease off.', 'Car condition deteriorating, reduce the load.', 'That increased the damage, reassess the pace.']
        : outcome.success === true ? ['Copy, pace maintained with damage.', 'Understood, car holding together for now.', 'Copy, keep monitoring the damaged car.']
          : ['Copy, monitor the car closely.', 'Understood, report any change in handling.', 'Copy, keep assessing the damage.'],
    })[id];
  }
  return lines ? `${pick(`${event.type}:${id}:${outcome.success}`, event.lap ?? d.lap, lines)} You are ${d.p}, ${d.left} laps remaining.` : null;
}

export function voiceForRadio(topicId, situation = {}, forecast = {}) {
  const d = data(situation), life = number(forecast.tyreLifeLaps), target = tyre(forecast.recommendedCompound);
  const from = number(forecast.pitWindow?.[0]), to = number(forecast.pitWindow?.[1]);
  const a = d.ahead ? `Car ahead, ${d.ahead}.` : `Clear ahead, you are ${d.p}.`;
  const b = d.behind ? `Car behind, ${d.behind}.` : `No running car behind, you are ${d.p}.`;
  const lines = {
    tyres: [`${d.tyres}, wear ${d.wear} percent. Estimated life, ${life} laps.`, `Wear ${d.wear} percent on ${d.tyres}. Around ${life} laps of tyre life.`, `${d.tyres} have ${life} laps estimated life. Current wear ${d.wear} percent.`],
    gaps: [`${a} ${b}`, `${b} ${a}`, `${a} Currently ${d.p}, ${d.left} laps remaining.`],
    strategy: [`Plan A, box between laps ${from} and ${to} for ${target}.`, `Pit window, lap ${from} to ${to}. Next set, ${target}.`, `Next compound is ${target}. Target stop between laps ${from} and ${to}.`],
    plan_b: [`Plan B, extend and save tyres. Estimated life ${life} laps.`, `Alternative is an extended stint. We estimate ${life} laps remaining on these tyres.`, `Plan B available, conserve now. Tyre life estimate ${life} laps.`],
    undercut: forecast.undercutThreat ? [`Undercut threat from the car behind. Gap ${d.behind ?? 'unavailable'}, wear ${d.wear} percent.`, `Car behind could undercut us. Wear ${d.wear} percent, pit window ${from} to ${to}.`, `Undercut risk is active. Tyre life ${life} laps, consider covering the car behind.`]
      : [`No immediate undercut threat. Tyre life ${life} laps.`, `Undercut risk currently low. Pit window ${from} to ${to}.`, `No undercut alert at present. Wear ${d.wear} percent.`],
    weather: [`Track wetness ${d.wet} percent. ${d.left} laps remaining, monitor grip.`, `Current surface wetness ${d.wet} percent. Report any change in grip.`, `Wetness reading ${d.wet} percent. We are monitoring conditions.`],
    rivals: [`${a} They are on ${tyre(situation.carAhead?.tyre?.compound)}.`, `${b} Their compound is ${tyre(situation.carBehind?.tyre?.compound)}.`, `${a} ${b}`],
    push: [`${d.left} laps remaining, wear ${d.wear} percent. ${life < 3 ? 'Tyre life is low, pushing carries a risk.' : 'Tyre life allows a push if needed.'}`, `Push assessment, ${life} laps of tyre life. Watch the exits and tyre temperatures.`, `Current wear ${d.wear} percent. ${life < 3 ? 'A push will be difficult on these tyres.' : 'A push is available, monitor tyre wear.'}`],
    conserve: [`Recommend saving tyres, wear ${d.wear} percent. Estimated life ${life} laps.`, `Lift earlier and protect the exits. Tyre life ${life} laps.`, `Conserving will help this stint. Current wear ${d.wear} percent.`],
    pit: [`Box option available for ${target}. Pit window ${from} to ${to}.`, `Recommend ${target} at the stop. Window opens lap ${from}.`, `Crew can prepare ${target}. Target pit window ${from} to ${to}.`],
    cancel_pit: [`Copy, cancellation requested. Tyre wear ${d.wear} percent, confirm through the radio controls.`, `Understood, assess staying out. Estimated tyre life ${life} laps.`, `Pit cancellation option available. Current wear ${d.wear} percent.`],
    extend: [`Estimated tyre life ${life} laps. ${life >= 2 ? 'We can consider extending the stint.' : 'Extending is risky, tyres are near the limit.'}`, `Wear ${d.wear} percent. ${life >= 2 ? 'Save the tyres if you extend.' : 'We recommend stopping rather than extending.'}`, `Stint extension assessment, tyre life ${life} laps. Keep tyre temperatures under control.`],
    safety_car: situation.safetyCar === 'none' || !situation.safetyCar ? [`Green running, you are ${d.p}. No safety car pit saving available.`, `No neutralisation at present. Current position ${d.p}.`, `Race is green, ${d.left} laps remaining. Follow the normal pit window.`]
      : [`${situation.safetyCar === 'vsc' ? 'Virtual safety car' : 'Safety car'} active, you are ${d.p}. Pit loss is reduced, consider ${target}.`, `Neutralised running, wear ${d.wear} percent. Keep the delta positive.`, `Safety car conditions, ${d.left} laps remaining. A stop costs less time now.`],
    damage: [`Damage assessment, ${d.left} laps remaining. Avoid kerbs and report handling changes.`, `Manage the car carefully from ${d.p}. Confirm repairs through the decision controls.`, `${d.left} laps to manage the car. We need your feedback on the handling.`],
  }[topicId];
  return lines ? pick(`radio:${topicId}`, d.lap, lines) : null;
}

export function voiceForEngineEvent(event, playerId) {
  if (!event || playerId == null) return null;
  const player = event.carId === playerId;
  const mate = event.isTeammate === true || (event.teammateId != null && event.carId === event.teammateId);
  const lines = {
    sc_deploy: ['Safety car deployed. Keep the delta positive.', 'Safety car, safety car. No overtaking, watch your delta.', 'Race neutralised under the safety car. Keep tyre temperature.'],
    vsc_deploy: ['Virtual safety car deployed. Reduce speed and respect the delta.', 'VSC, VSC. Keep the delta positive.', 'Virtual safety car active. No overtaking, monitor your delta.'],
    sc_end: ['Green flag, racing resumed. Build the pace.', 'Neutralisation ended. Back to racing speed.', 'Track is green. Focus on the restart.'],
    rain_start: ['Rain affecting the circuit. Report grip levels.', 'Track getting wet. Watch traction on exit.', 'Rain has arrived. Assess the grip before committing.'],
    rain_stop: ['Track is drying. Look after the tyres.', 'Rain impact has eased. Assess the dry line.', 'Conditions improving. Watch for damp patches.'],
    pit: player ? [`Stop complete on ${tyre(event.compound)}. Rejoin safely.`, `${tyre(event.compound)} fitted. Watch traffic at pit exit.`, `You are on ${tyre(event.compound)}. Build temperature on the out-lap.`] : null,
    dnf: player ? ['Retire the car safely. Switch off when stopped.', 'We need to stop the car. Find a safe place.', 'That is retirement. Pull over safely.']
      : mate ? ['Your teammate has retired. Focus on your race.', 'Teammate out of the race. Keep your rhythm.', 'We have lost your teammate. Bring your car home.'] : null,
    fastest_lap: player ? ['Fastest lap, good job. Keep it tidy.', 'That is the fastest lap. Maintain your rhythm.', 'You have set the fastest lap. Good pace.'] : null,
    penalty: player ? [`Time penalty, ${fixed(event.seconds)} seconds. Keep it clean.`, `${fixed(event.seconds)} seconds added. Focus on the next lap.`, `Race control penalty, ${fixed(event.seconds)} seconds. Stay focused.`] : null,
    mistake: player ? ['Lock-up reported. Check for vibration.', 'Time lost, reset your rhythm. Watch the braking points.', 'Keep it tidy after that lock-up. Report tyre vibration.'] : null,
    overtake: event.by === playerId ? ['Pass complete. Focus on the car ahead.', 'Position gained. Settle into your rhythm.', 'You are through. Keep the exit clean.']
      : event.on === playerId ? ['Car behind is through. Regroup and look ahead.', 'Position lost. Focus on your pace.', 'They have passed us. Reset for the next opportunity.'] : null,
  }[event.type];
  if (!lines) return null;
  let line = pick(`engine:${event.type}:${player}:${event.by === playerId}`, event.lap, lines);
  // stepLap events do not carry lap/position; optional integration metadata adds them without inventing data.
  const detail = event.type === 'pit' && Number.isFinite(event.duration) ? `Stop time ${fixed(event.duration)} seconds`
    : Number.isFinite(event.position) ? `You are P${event.position}`
      : Number.isFinite(event.lap) ? `Lap ${event.lap}` : null;
  if (detail) {
    const sentences = line.split(/(?<=[.!?])\s+/);
    line = `${sentences[0]} ${detail}, ${sentences.slice(1).join(' ').replace(/^./, c => c.toLowerCase())}`;
  }
  return line;
}
