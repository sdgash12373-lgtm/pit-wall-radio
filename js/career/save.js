import { CAREER_VERSION } from './career.js';

const PREFIX = 'pit-wall-radio:career:';
const getStorage = storage => {
  try { return storage ?? globalThis.localStorage ?? null; }
  catch { return null; }
};
const keyFor = slot => PREFIX + String(slot);
const validState = state => state && state.version === CAREER_VERSION && Number.isInteger(state.year)
  && state.player && state.season && Array.isArray(state.season.calendar)
  && Array.isArray(state.season.results) && Array.isArray(state.drivers) && Array.isArray(state.teams)
  && Array.isArray(state.season.driverStandings);

function readEnvelope(text) {
  try {
    const value = JSON.parse(text);
    return value?.version === CAREER_VERSION && validState(value.state)
      && typeof value.timestamp === 'string' && value.summary && typeof value.summary === 'object' ? value : null;
  } catch { return null; }
}

export function saveCareer(state, slot, storage) {
  try {
    const target = getStorage(storage);
    if (!target || !validState(state)) return null;
    const summary = { year: state.year, round: state.season.round,
      teamId: state.contract?.teamId ?? null,
      team: state.teams.find(t => t.id === state.contract?.teamId)?.name ?? '尚未簽約',
      position: state.season.driverStandings.find(d => d.carId === state.player.id)?.position ?? null };
    const envelope = { version: CAREER_VERSION, timestamp: new Date().toISOString(), summary, state };
    target.setItem(keyFor(slot), JSON.stringify(envelope));
    return { slot: String(slot), version: envelope.version, timestamp: envelope.timestamp, summary };
  } catch { return null; }
}

export function loadCareer(slot, storage) {
  try { return readEnvelope(getStorage(storage)?.getItem(keyFor(slot)))?.state ?? null; }
  catch { return null; }
}

export function listSaves(storage) {
  try {
    const target = getStorage(storage);
    if (!target) return [];
    const saves = [];
    for (let i = 0; i < target.length; i++) {
      const key = target.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const value = readEnvelope(target.getItem(key));
      if (value) saves.push({ slot: key.slice(PREFIX.length), version: value.version,
        timestamp: value.timestamp, summary: value.summary });
    }
    return saves.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.slot.localeCompare(b.slot));
  } catch { return []; }
}

export function deleteSave(slot, storage) {
  try {
    const target = getStorage(storage);
    if (!target) return false;
    target.removeItem(keyFor(slot));
    return true;
  } catch { return false; }
}
