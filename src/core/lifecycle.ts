// Game options Nucleus reads before the session starts: when it loads the handler, or on the game
// list and the setup screen. Setting them (or calling Game.AddOption) inside Game.Play or another
// callback is too late. Checked in splitscreenme-nucleus: none of these is read by
// GenericGameHandler during the session (or, for GUID/GameName, it already used them to load
// the handler). Most other Game options DO work inside Game.Play, for that instance and after:
// half the Hub handlers set Proto Input, FakeFocus and window options there.
export const BEFORE_SESSION: Record<string, string> = {
  'Game.GUID': 'Nucleus reads it when it loads the handler: the game list, profiles and the content folder are named after it',
  'Game.GameName': 'Nucleus reads it when it loads the handler, for the game list',
  'Game.MaxPlayers': 'the game list and the setup screen read it, before any Game.Play runs',
  'Game.SupportsKeyboard': 'the setup screen reads it when players pick their input, before any Game.Play runs',
  'Game.Description': 'only the game list shows it',
  'Game.AddOption': 'options are shown on the setup screen, before the session starts',
};
