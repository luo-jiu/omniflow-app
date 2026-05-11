export type SystemVideoWindowOpenPayload = {
  src: string;
  title: string;
  currentTime: number;
  duration?: number;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
};

export type SystemVideoWindowStatePayload = {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  ended: boolean;
};

export type SystemVideoWindowCommandPayload =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; time: number };
