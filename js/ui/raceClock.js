// Presentation clock only. All sporting rules stay in RaceSim / DecisionDirector.
// 每圈動畫秒數由整場目標時間換算（預設 3 分鐘）；motion = 已播完圈數 + 本圈進度，連續遞增。
export class RaceClock {
  constructor({ check, step, onDecision, onFinish, lapSeconds = 3 }) {
    Object.assign(this, { check, step, onDecision, onFinish });
    this.lapSeconds = lapSeconds;
    this.speed = 1; this.elapsed = 0; this.completed = 0; this.pending = null;
    this.started = false; this.finished = false;
  }
  get motion() { return this.completed + this.elapsed / this.lapSeconds; }
  begin() {
    this.started = true;
    this.pending = this.check();
    this.remaining = this.pending?.timeLimit ?? 0;
    if (this.pending) this.onDecision(this.pending);
  }
  choose(choice, resolve) {
    if (!this.pending) return;
    const event = this.pending;
    this.pending = null;
    resolve(event, choice);
    this.advance();
  }
  advance() {
    this.finished = !!this.step();
    if (this.finished) this.onFinish();
  }
  tick(seconds, resolve) {
    if (this.finished) return;
    if (!this.started) { this.begin(); if (!this.pending) this.advance(); }
    // 決策等待期間畫面放慢到約 0.35 倍但不停；倒數使用真實秒數。
    this.elapsed += seconds * this.speed * (this.pending ? 0.35 : 1);
    if (this.pending) {
      this.elapsed = Math.min(this.elapsed, this.lapSeconds * 0.98);
      this.remaining = Math.max(0, this.remaining - seconds);
      if (this.remaining <= 0) this.choose(null, resolve);
      return;
    }
    if (this.elapsed >= this.lapSeconds) {
      this.elapsed -= this.lapSeconds;
      this.completed++;
      this.begin();
      if (!this.pending) this.advance();
    }
  }
}
