export class GlobalAudioPlaybackRequestGate {
  private generation = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  cancel(generation: number): boolean {
    if (!this.isCurrent(generation)) return false;
    this.generation += 1;
    return true;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}
