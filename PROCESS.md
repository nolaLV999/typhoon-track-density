# Process

I used GitHub Copilot to inspect the IBTrACS NetCDF fields and build the track
parser, grid aggregation, and map. I kept the rule that counts each storm once
per 2-degree cell rather than counting every position fix; otherwise storms with
more recorded fixes could dominate the picture. I rejected presenting tracks as
wind-impact areas, because this global file does not contain complete, consistent
wind radii. I checked the field names against the downloaded file and ran the
script on the actual data, which produced 6,426 points for 117 storms in 2025.