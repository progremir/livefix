// One clock for everything (game ticks, voice, frames): epoch milliseconds with sub-ms precision.
export const now = () => performance.timeOrigin + performance.now();
