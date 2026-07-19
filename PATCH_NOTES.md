# SPARK Patch Notes

Added - D.I.Y tab. Build your own chat and alert widgets and add them to OBS as browser sources. Style them with the visual designer (colours, fonts, glow, animations, per role name colours and icons) or write your own CSS with a live preview that updates as you type. Alert widgets cover follows, subs, bits and raids, each with editable text and an optional sound. Chat widgets can scroll in any direction, tilt, show follows/subs/raids inline, and can be set to single line so long messages get cut off with ... instead of wrapping. Widgets can be duplicated to try out variations.
Added - Bits and raids now come through Twitch EventSub, powering the new D.I.Y alert widgets. Reconnect Twitch in Settings once so SPARK can pick up the new bits permission.
Added - Wheel spin sound. A second sound that plays while the wheel spins, separate from the winner sound.
Added - Wheel winner chat announcement. Optionally posts the winner to your Twitch chat, with {winner} and {spinner} tokens for the message.
Added - Seek bar colour picker in Song Request settings. Applies to every Now Playing style, defaults to the usual yellow.

Fixed - The Banner style Now Playing card. The seek bar now runs the full length of the card along its top edge, the song time sits next to the title, and the text is a little bigger.
Fixed - Credits restarting from the top mid-roll whenever live chat activity came in. The roll now finishes before any restyle is applied.
