"""Server option field definitions for the Satisfactory WebUI config editor.

These are the options exposed by the game's HTTPS API (GetServerOptions /
ApplyServerOptions) and Advanced Game Settings (GetAdvancedGameSettings /
ApplyAdvancedGameSettings). Descriptions are concise and grounded in the
official wiki (satisfactory.wiki.gg/wiki/Dedicated_servers) and the observed
values on the Axtriss server. Values are always strings on the wire.
"""

# Server options (GetServerOptions / ApplyServerOptions).
# Each: key -> {label, help, kind, choices?, min?, max?, step?, default?}
SERVER_OPTIONS = {
    "FG.WeatherPreset": {
        "label": "Weather preset",
        "help": "Weather preset index. 0 = none, higher values select a preset.",
        "kind": "int",
        "min": 0,
        "max": 4,
        "default": "4",
    },
    "FG.DSAutoPause": {
        "label": "Auto-pause when empty",
        "help": "Pause the simulation when no players are connected.",
        "kind": "bool",
        "default": "False",
    },
    "FG.DSAutoSaveOnDisconnect": {
        "label": "Save on disconnect",
        "help": "Save the game when the last player disconnects.",
        "kind": "bool",
        "default": "True",
    },
    "FG.AutosaveInterval": {
        "label": "Autosave interval (s)",
        "help": "Seconds between autosaves. Default 300 (5 min). Shorter = more frequent saves but a performance dip while saving.",
        "kind": "float",
        "min": 0,
        "max": 3600,
        "step": 5,
        "default": "300.0",
    },
    "FG.EnableSeasonalEvents": {
        "label": "Seasonal events",
        "help": "Enable seasonal events such as FICSMAS.",
        "kind": "bool",
        "default": "True",
    },
    "FG.NetworkQuality": {
        "label": "Network quality",
        "help": "Network quality preset (0-3). Higher = more bandwidth for smoother multiplayer.",
        "kind": "int",
        "min": 0,
        "max": 3,
        "default": "3",
    },
    "FG.SendGameplayData": {
        "label": "Send gameplay data",
        "help": "Send anonymous gameplay telemetry to the developers.",
        "kind": "bool",
        "default": "True",
    },
    "FG.ServerRestartTimeSlot": {
        "label": "Restart time slot (min)",
        "help": "Minutes after midnight (UTC) for the automatic daily restart window. 720 = 12:00.",
        "kind": "float",
        "min": 0,
        "max": 1440,
        "step": 15,
        "default": "720.0",
    },
}

# Advanced Game Settings (GetAdvancedGameSettings / ApplyAdvancedGameSettings).
ADVANCED_SETTINGS = {
    "FG.GameRules.DisableArachnidCreatures": {
        "label": "Disable arachnid creatures",
        "help": "Replace spider-like creatures with harmless cats.",
        "kind": "bool",
        "default": "False",
    },
    "FG.PlayerRules.FlightMode": {
        "label": "Flight mode",
        "help": "Allow players to fly.",
        "kind": "bool",
        "default": "False",
    },
    "FG.GameRules.UnlockAllResearchSchematics": {
        "label": "Unlock all research schematics",
        "help": "Unlock every research/MAM schematic.",
        "kind": "bool",
        "default": "False",
    },
    "FG.GameRules.UnlockAllResourceSinkSchematics": {
        "label": "Unlock all AWESOME Sink schematics",
        "help": "Unlock every AWESOME Sink shop schematic.",
        "kind": "bool",
        "default": "False",
    },
    "FG.GameRules.GiveAllTiers": {
        "label": "Give all tiers",
        "help": "Unlock all milestone tiers.",
        "kind": "bool",
        "default": "False",
    },
    "FG.GameRules.GiveItems": {
        "label": "Give items",
        "help": "Comma-separated item list to grant (e.g. IronIngot:100). Empty = none.",
        "kind": "text",
        "default": "Empty",
    },
    "FG.PlayerRules.GodMode": {
        "label": "God mode",
        "help": "Players take no damage and cannot die.",
        "kind": "bool",
        "default": "False",
    },
    "FG.GameRules.UnlockInstantAltRecipes": {
        "label": "Unlock instant alt recipes",
        "help": "Unlock all alternate recipes immediately.",
        "kind": "bool",
        "default": "False",
    },
    "FG.PlayerRules.NoBuildCost": {
        "label": "No build cost",
        "help": "Buildings cost nothing to construct.",
        "kind": "bool",
        "default": "False",
    },
    "FG.GameRules.NoFuelCost": {
        "label": "No fuel cost",
        "help": "Vehicles and generators consume no fuel.",
        "kind": "bool",
        "default": "False",
    },
    "FG.GameRules.NoPower": {
        "label": "No power requirement",
        "help": "Buildings require no power to operate.",
        "kind": "bool",
        "default": "False",
    },
    "FG.GameRules.NoUnlockCost": {
        "label": "No unlock cost",
        "help": "Schematics unlock without spending coupons/items.",
        "kind": "bool",
        "default": "False",
    },
    "FG.GameRules.SetGamePhase": {
        "label": "Game phase",
        "help": "Force the game phase index (0 = Project Assembly Phase 0).",
        "kind": "int",
        "min": 0,
        "max": 8,
        "default": "0",
    },
    "FG.GameRules.StartingTier": {
        "label": "Starting tier",
        "help": "Starting milestone tier for new players.",
        "kind": "int",
        "min": 0,
        "max": 9,
        "default": "0",
    },
}
