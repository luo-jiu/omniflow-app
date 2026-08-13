export type ViewerInitialRestoreSource = 'warm' | 'cold' | 'none' | 'blocked';

export class ViewerSessionRestoreGate {
  private interacted = false;
  private settledSource: ViewerInitialRestoreSource | null = null;
  private readonly settledPromise: Promise<ViewerInitialRestoreSource>;
  private resolveSettled!: (source: ViewerInitialRestoreSource) => void;

  constructor() {
    this.settledPromise = new Promise((resolve) => {
      this.resolveSettled = resolve;
    });
  }

  canApplyCold(options: { hasNewerWarmSnapshot: boolean }): boolean {
    return this.settledSource === null
      && !this.interacted
      && !options.hasNewerWarmSnapshot;
  }

  getSettledSource(): ViewerInitialRestoreSource | null {
    return this.settledSource;
  }

  markInteracted(): void {
    this.interacted = true;
    this.settle('blocked');
  }

  settle(source: ViewerInitialRestoreSource): void {
    if (this.settledSource !== null) return;
    this.settledSource = source;
    this.resolveSettled(source);
  }

  wait(): Promise<ViewerInitialRestoreSource> {
    return this.settledPromise;
  }

  dispose(): void {
    this.settle('blocked');
  }
}
