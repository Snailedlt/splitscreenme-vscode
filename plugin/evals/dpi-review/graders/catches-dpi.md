---
type: regex
pattern: 'Scaled|DPIHandling\.True'
flags: i
---
Game.DPIHandling = true converts to 1, which is Nucleus.DPIHandling.Scaled; the fix is Nucleus.DPIHandling.True.
