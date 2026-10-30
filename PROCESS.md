# Process

## Starting idea

The original project showed where 2025 tropical cyclones travelled most often,
but a density map cannot tell the story of one storm over time. I wanted a
curious viewer to choose a storm and answer: "Where was it, and when?"

## What changed

I extended the static map into a browser interaction: choose a storm, drag its
timeline or play its observations. The highlighted trail, current map marker,
UTC timestamp and coordinates update together. Playback can be paused; changing
the selection or timeline stops it, and Play at the final observation restarts
from the beginning. I kept the original density picture as a separate view,
because it answers a different question.

I used GitHub Copilot to help inspect the IBTrACS NetCDF fields and build the
track parser, grid aggregation, map and browser page. I kept the once-per-cell
storm counting rule; counting every position fix would let storms with more
recorded fixes dominate the density map. I rejected showing the tracks as
wind-impact areas because the source does not contain complete, consistent
global wind radii.

For the interactive map, I kept the suggestion to make one storm selectable
and replayable. It gives the viewer a focused way to explore the real
observations without adding an API or inventing data. I changed the generated
track drawing to split lines at the map's date line; connecting those points
would draw a misleading line across the whole map.

## Usability refinement

The first version selected the first storm alphabetically and showed its last
observation immediately. That made Play jump back to the beginning, which
could make the first action feel backwards. I changed the opening example to
Ragasa and set each newly selected storm to its first observation. Play now
moves forward from the beginning; the viewer can still drag the slider to any
position.

## Checks

I checked the NetCDF field names against the downloaded source and ran the
plotting script on the actual data. It produced 6,426 position fixes for 117
storms in 2025. In the first browser version, I changed storms and timeline
positions and checked that playback advanced the position counter. In the
revised version, I also checked that Ragasa starts at fix 1 and playback moves
forward. I simulated a missing track file: the page showed an error with a
local-server/reload instruction, and it loaded the storms again after I restored
the request. The page makes no remote data requests. It needs a local static
server because browsers block its data-file requests when opened directly as
`file://`.

## Try-out with another person — required, not completed

I have not yet asked another person to try the page, so I am not claiming
user-test evidence. Before submitting, ask someone to use it before explaining
the controls. Then replace this note with a brief, anonymous record:

- What they tried first:
- Where they hesitated or made a mistake:
- What I changed in response, or why I kept the design:

Do not include the person's name or a recording.
