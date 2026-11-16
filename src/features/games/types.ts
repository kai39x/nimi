export type GameId = "star" | "moon" | "memory";

/** What the games tab hands a game and hears back (the HUD lives in the tab, board 15). */
export type GameProps = {
  paused: boolean;
  onScore: (score: number) => void;
  onLives?: (lives: number) => void;
  /** Seconds played (memory shows it; the others cap their round with it). */
  onTime?: (seconds: number) => void;
  /** The round ended; `final` is the score (memory: milliseconds, lower is better). */
  onOver: (final: number) => void;
};
