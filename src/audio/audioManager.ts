export type SoundEvent = 'deploy' | 'swing' | 'arrow' | 'hit' | 'death' | 'flag' | 'gate' | 'breach' | 'victory' | 'defeat';

export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;

  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.18;
      this.master.connect(this.context.destination);
    }
    void this.context.resume();
  }

  play(event: SoundEvent): void {
    if (!this.context || !this.master || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    const settings = this.getSettings(event);
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = settings.wave;
    oscillator.frequency.setValueAtTime(settings.frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, settings.endFrequency), now + settings.duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(settings.gain, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + settings.duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + settings.duration + 0.03);
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
    this.master = null;
  }

  private getSettings(event: SoundEvent): { frequency: number; endFrequency: number; duration: number; gain: number; wave: OscillatorType } {
    switch (event) {
      case 'deploy': return { frequency: 220, endFrequency: 520, duration: 0.16, gain: 0.22, wave: 'triangle' };
      case 'swing': return { frequency: 150, endFrequency: 72, duration: 0.11, gain: 0.16, wave: 'sawtooth' };
      case 'arrow': return { frequency: 720, endFrequency: 260, duration: 0.16, gain: 0.1, wave: 'sine' };
      case 'hit': return { frequency: 110, endFrequency: 58, duration: 0.09, gain: 0.18, wave: 'square' };
      case 'death': return { frequency: 125, endFrequency: 42, duration: 0.34, gain: 0.16, wave: 'triangle' };
      case 'flag': return { frequency: 420, endFrequency: 840, duration: 0.34, gain: 0.16, wave: 'triangle' };
      case 'gate': return { frequency: 90, endFrequency: 48, duration: 0.52, gain: 0.2, wave: 'sawtooth' };
      case 'breach': return { frequency: 180, endFrequency: 55, duration: 0.72, gain: 0.28, wave: 'square' };
      case 'victory': return { frequency: 520, endFrequency: 980, duration: 0.68, gain: 0.2, wave: 'triangle' };
      case 'defeat': return { frequency: 210, endFrequency: 52, duration: 0.72, gain: 0.2, wave: 'sine' };
    }
  }
}
