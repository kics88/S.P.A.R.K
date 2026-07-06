// Shared mutable store — all tab modules read/write here.
export const store = {
  wheel: {},
  giveaway: {},
  timers: { list:[] },
  tasks: { list:[], settings:{} },
  goals: { bars:[] },
  checkins: { configs:[], firstClaim:{} },
  songrequest: { cfg:{}, queue:[] },
  chat: {},
  counters: {},
  credits: {},
  settings: {},
  twitch_tokens: {},
  overlayUrls: {},
  twitch: { connected:false, userId:'', login:'', clientId:'' },
};
