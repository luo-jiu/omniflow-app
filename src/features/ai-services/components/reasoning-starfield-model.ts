const STAR_COUNT = 14;

function randomUnit(index: number, channel: number): number {
  const value = Math.sin(index * 91.713 + channel * 37.119 + 0.73) * 43758.5453;
  return value - Math.floor(value);
}

interface StarPosition { x: number; y: number }
export interface ReasoningStar {
  anchor: number;
  opacity: number;
  radius: number;
  index: number;
  cycle: number;
  startedAt: number;
  duration: number;
  from: StarPosition;
  to: StarPosition;
}

function position(index: number, cycle: number): StarPosition {
  return {
    x: Math.round((randomUnit(index, cycle * 3 + 1) - 0.5) * 8),
    y: Math.round(12 + (randomUnit(index, cycle * 3 + 2) - 0.5) * 14),
  };
}

function duration(index: number, cycle: number): number {
  return 1.6 * (0.8 + randomUnit(index, cycle * 3 + 3) * 1.2);
}

export function createReasoningStars(): ReasoningStar[] {
  return Array.from({ length: STAR_COUNT }, (_, index) => ({
    index, cycle: 1, startedAt: 0,
    anchor: (4 + randomUnit(index, 501) * 92) / 100,
    opacity: 0.4 + randomUnit(index, 502) * 0.6,
    radius: 1.5 * (0.5 + randomUnit(index, 503) * 0.45),
    from: position(index, 0), to: position(index, 1), duration: duration(index, 1),
  }));
}

// Solve the slow drift's cubic-bezier(.45, 0, .55, 1), including its x curve.
function bezierProgress(progress: number, x1: number, x2: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 12; iteration++) {
    const t = (lower + upper) / 2;
    const x = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3;
    if (x < progress) lower = t; else upper = t;
  }
  const t = (lower + upper) / 2;
  return t * t * (3 - 2 * t);
}

/** Updates one small uniform buffer. Stars stay near their anchors; none cross the track. */
export function writeReasoningStars(stars: ReasoningStar[], seconds: number, width: number, height: number, output: Float32Array): void {
  stars.forEach((star, index) => {
    while (seconds > star.startedAt + star.duration) {
      star.startedAt += star.duration;
      star.from = star.to;
      star.cycle += 1;
      star.to = position(star.index, star.cycle);
      star.duration = duration(star.index, star.cycle);
    }
    const progress = bezierProgress((seconds - star.startedAt) / star.duration, .45, .55);
    output[index * 4] = star.anchor * width + star.from.x + (star.to.x - star.from.x) * progress;
    output[index * 4 + 1] = (star.from.y + (star.to.y - star.from.y) * progress) * height / 24;
    output[index * 4 + 2] = star.radius;
    output[index * 4 + 3] = star.opacity;
  });
}

export function writeFastReasoningStars(seconds: number, width: number, height: number, startPercent: number, output: Float32Array): void {
  for (let index = 0; index < STAR_COUNT; index++) {
    const period = 1.9 / (1 + (randomUnit(index, 601) - .5) * .4);
    const delay = index * 1.9 / STAR_COUNT - period * (1 - startPercent / 100);
    const elapsed = seconds - delay;
    const progress = ((elapsed / period) % 1 + 1) % 1;
    const opacity = elapsed < 0 ? 0 : Math.min(1, progress / .08, (1 - progress) / .08);
    output[index * 4] = width * (1 - progress);
    output[index * 4 + 1] = height * (.12 + randomUnit(index, 602) * .76);
    output[index * 4 + 2] = 1.5 * (.5 + randomUnit(index, 503) * .45);
    output[index * 4 + 3] = (.4 + randomUnit(index, 502) * .6) * opacity;
  }
}

export interface ReasoningParticleTransition {
  enabled: boolean;
  changedAt: number | null;
  fastOpacityFrom?: number;
}

export function reasoningParticleLayers(transition: ReasoningParticleTransition, seconds: number, maximum: boolean) {
  const elapsed = transition.changedAt === null ? Infinity : Math.max(0, seconds - transition.changedAt);
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  if (transition.enabled) {
    return {
      phase: elapsed < 1.2 ? 'entering' : 'active',
      ordinaryOpacity: maximum ? 1 - bezierProgress((elapsed - 1) / .55, .42, 1) : 0,
      ordinaryOffset: -110 * bezierProgress((elapsed - .2) / 1.35, .42, 1),
      fastOpacity: (transition.fastOpacityFrom ?? 0) + (1 - (transition.fastOpacityFrom ?? 0))
        * bezierProgress(elapsed / (maximum ? .25 : .08), .42, maximum ? 1 : .58),
    };
  }
  return {
    phase: elapsed < .35 ? 'exiting' : 'inactive',
    ordinaryOpacity: maximum ? clamp((elapsed - .05) / .5) : 0,
    ordinaryOffset: 28 * (1 - bezierProgress((elapsed - .05) / .5, 0, .58)),
    fastOpacity: (transition.fastOpacityFrom ?? 1) * (maximum ? 1 - clamp((elapsed - .1) / .3) : 1 - bezierProgress(elapsed / .25, .42, .58)),
  };
}
