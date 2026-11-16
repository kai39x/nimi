/** The capsule is 148×52 at the default size 64; both scale together with the size setting. */
export const DEFAULT_NIMI_SIZE = 64;
export const CAPSULE_WIDTH = 148;
export const CAPSULE_HEIGHT = 52;
/** Expanded panel (design spec §5, board 11). */
export const PANEL_WIDTH = 880;
export const PANEL_HEIGHT = 620;
/** Panel top offset inside the overlay window so NIMI's head (poking above the panel) stays visible. */
export const PANEL_TOP = 44;
export const CAPSULE_TOP = 10;
/** NIMI's nominal size on top of the panel. */
export const PANEL_NIMI_SIZE = 96;
/** Music island (spec §4, board 07 option B) and NIMI's size in its left slot. */
export const ISLAND_WIDTH = 736;
export const ISLAND_HEIGHT = 160;
export const ISLAND_NIMI_SIZE = 100;
/** Feeding (board 08): NIMI grows so the mouth and Nuri make real drop targets. */
export const FEED_NIMI_SIZE = 130;
/** NIMI's body center inside the feeding layout (shell-local px). */
export const FEED_NIMI_CENTER = { x: 270, y: 84 };
/** The capsule while music plays: art · NIMI · equalizer · time (board 06/07 ①). */
export const MUSIC_CAPSULE_WIDTH = 220;
/** NIMI above the command bar (board 10). */
export const COMMAND_NIMI_SIZE = 72;
