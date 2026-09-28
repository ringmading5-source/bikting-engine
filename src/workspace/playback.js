export class PlaybackController {
  constructor({ result, onStep }) {
    this.result = result;
    this.steps = result.workspace?.steps ?? result.explanation ?? [];
    this.scene = result.workspace?.scene ?? result.visual;
    this.onStep = onStep;
    this.index = 0;
    this.speaking = false;
    this.timer = null;
  }
  show(index) {
    this.index = Math.max(0, Math.min(index, this.steps.length - 1));
    const visualIndex = typeof this.steps[this.index]?.visualState === 'number' ? this.steps[this.index].visualState : this.index;
    this.onStep(this.index, this.steps[this.index], this.scene?.states?.[visualIndex]);
    return this.index;
  }
  next() { if (this.index < this.steps.length - 1) this.show(this.index + 1); else this.stop(); }
  previous() { this.stop(); this.show(this.index - 1); }
  play() {
    const spokenSteps = this.steps.map((step, index) => ({ step, index, speech: step.narration || step.text })).filter(({ speech }) => typeof speech === 'string' && speech.trim());
    if (!spokenSteps.length || !('speechSynthesis' in window)) {
      if (!this.scene?.states?.length) return;
      this.stop();
      const firstFrame = this.steps.findIndex((step) => typeof step.visualState === 'number');
      this.show(firstFrame < 0 ? 0 : firstFrame);
      this.timer = setInterval(() => {
        if (this.index >= this.steps.length - 1) this.stop();
        else this.next();
      }, 1400);
      return;
    }
    this.stop(); this.speaking = true;
    let position = spokenSteps.findIndex(({ index }) => index >= this.index);
    if (position < 0) position = 0;
    const speakNext = (nextPosition) => {
      if (!this.speaking || nextPosition >= spokenSteps.length) { this.speaking = false; return; }
      const { speech, index } = spokenSteps[nextPosition];
      this.show(index);
      const utterance = new SpeechSynthesisUtterance(speech);
      utterance.rate = 0.95;
      utterance.onend = () => speakNext(nextPosition + 1);
      utterance.onerror = () => { this.speaking = false; };
      speechSynthesis.speak(utterance);
    };
    speakNext(position);
  }
  stop() { this.speaking = false; if (this.timer) clearInterval(this.timer); this.timer = null; if ('speechSynthesis' in window) speechSynthesis.cancel(); }
}
