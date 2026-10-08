# Playtest: how to observe

One session, one player who has not read the spec, one observer (you). About 30 minutes. The
player drives; you watch and write. This note is for you, not for them.

## Setup

- A laptop at 1440×900 or larger, Chrome, sound off. Open `dist-single/signal.html` from disk
  (no `?demo=1`: the player starts at A1 with a clean profile). Clear `localStorage` first.
- Tell the player only this: "It's a racing game where the only feedback is data. Think out loud.
  I can't help, but I'm taking notes." Then stop talking.
- Keep a clock running. Note the time at every level start, every run, and every hint opened.

## What to watch for

1. **The first ten seconds on A1.** Do they read the brief, or click BEGIN straight away? Do they
   find RUN without being told?
2. **Do they read the strips at all?** After the first run, do their eyes go to the graphs or only
   to the big time? Ask nothing; note where they point or hover.
3. **Do they pull a strip in from the table?** The default stack never contains the channel that
   answers the level. Note the run on which they first add a channel, and which one. On A2 the
   discovery is `wheel_speed_rl` leaving `speed`; does it happen without a hint?
4. **Hints.** When do they open the first one, and why (stuck, curious, or panicking at the run
   budget)? Do they stop at tier 1 (the channel) or go straight to tier 3 (the lever)? After a
   tier-1 hint, do they click the channel link?
5. **One change at a time.** Do they change one lever per run or several? The amber underline on
   the setup chips marks changes; note whether they seem to notice it.
6. **The cursor.** Do they hover a strip and read across the stack? Do they find click-to-pin or
   the track view's Replay?
7. **B1L, the join.** The A4 wing that won the corner now loses the straight. Do they expect the
   A4 answer to carry over? When do they find `segment_delta`, and do they read it at the dashed
   boundaries? Do they understand the compromise-gap chip without asking?
8. **B4L, the Puzzle.** How long do they scroll the channel table? Do they say anything about the
   number of channels? Do they leave `oil_temp` in the stack, or remove it? If they turn the assist
   on, do they treat its five rows as an answer or as a shortlist to check?
9. **The debrief.** Do they read it, or click Continue? Do they look at the strips of the
   channels that mattered, and at the response surface?
10. **Frustration and delight.** Write down the exact words at every sigh, laugh, "oh" or "what".

## What not to explain

- Do not explain what any channel means, which channels matter, or what a lever does.
- Do not explain the hint cost, the run budget, the noise rule, the assist, or the debrief.
- Do not point at the screen. If they ask "what should I do?", answer "what would you try?"
- Do not reassure ("you're doing great") or warn ("careful with the budget").
- If they are stuck for more than three minutes on one level, note it, then say only "the hints
  are there if you want them". If still stuck after two more minutes, let them move on through the
  debrief (exhausting the budget unlocks the next level).

## Afterwards (5 minutes)

Ask, in this order, and write the answers verbatim:

1. What was the game asking you to do?
2. Which graph helped you most? Which one did you ignore?
3. When did you feel you understood a level, and what made it click?
4. On the last level, what did the assist do for you?
5. What would you change first?

## What to send back

Your timestamped notes, the five answers, the levels' run counts and scores from the level
select, and anything the player said that surprised you.
