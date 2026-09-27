export class PlaybackController {
  constructor({ result, onStep }) {
    this.result = result;
    this.steps = result.workspace?.steps ?? result.explanation ?? [];
    this.scene = result.workspace?.scene ?? result.visual;
    this.onStep = onStep;
    this.index = 0;
    this.speaking = false;
  }
  show(index) {
    this.index = Math.max(0, Math.min(index, this.steps.length - 1));
    this.onStep(this.index, this.steps[this.index], this.scene?.states?.[this.index]);
    return this.index;
  }
  next() { if (this.index < this.steps.length - 1) this.show(this.index + 1); else this.stop(); }
  previous() { this.stop(); this.show(this.index - 1); }
  play() {
    if (!('speechSynthesis' in window)) return;
    const narrationSteps = this.steps.map((step, index) => ({ step, index })).filter(({ step }) => step.narration);
    if (!narrationSteps.length) return;
    this.stop(); this.speaking = true;
    let position = narrationSteps.findIndex(({ index }) => index >= this.index);
    if (position < 0) position = 0;
    const speakNext = (nextPosition) => {
      if (!this.speaking || nextPosition >= narrationSteps.length) { this.speaking = false; return; }
      const { step, index } = narrationSteps[nextPosition];
      this.show(index);
      const utterance = new SpeechSynthesisUtterance(step.narration);
      utterance.rate = 0.95;
      utterance.onend = () => speakNext(nextPosition + 1);
      utterance.onerror = () => { this.speaking = false; };
      speechSynthesis.speak(utterance);
    };
    speakNext(position);
  }
  stop() { this.speaking = false; if ('speechSynthesis' in window) speechSynthesis.cancel(); }
}
