# /// script
# requires-python = ">=3.10"
# dependencies = ["matplotlib", "netCDF4", "numpy", "requests"]
# ///

"""Global tropical cyclone track density from NOAA IBTrACS.

Run with::

    uv run typhoon_density.py

The map counts distinct storms per 2-degree grid cell, not observations, wind
footprints, or damage. The source file and both trimmed CSVs are kept so the
picture can be reproduced and the data inspected without another download.
"""

import csv
import json
import math
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import requests
from matplotlib.collections import PolyCollection
from netCDF4 import Dataset
from matplotlib.colors import LogNorm


YEAR = 2025
GRID_DEGREES = 2
PAPER = "#f8f7f2"
INK = "#20302f"
SEA = "#e5eff2"
LAND = "#f1eee3"
COAST = "#83958e"
COLOURS = "cividis"

HERE = Path(__file__).parent
DATA = HERE / "data"
OUT = HERE / "out"
CACHE = DATA / "IBTrACS.since1980.v04r01.nc"
LAND_CACHE = DATA / "ne_110m_land.geojson"
URL = (
    "https://www.ncei.noaa.gov/data/international-best-track-archive-for-"
    "climate-stewardship-ibtracs/v04r01/access/netcdf/"
    "IBTrACS.since1980.v04r01.nc"
)
LAND_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/"
    "geojson/ne_110m_land.geojson"
)
AGENT = "SD5913-PolyU-teaching/1.0 (course example; one request)"

LONGITUDE_EDGES = np.arange(-180, 180 + GRID_DEGREES, GRID_DEGREES)
LATITUDE_EDGES = np.arange(-90, 90 + GRID_DEGREES, GRID_DEGREES)


def fetch():
    """Download the official global best-track file once and cache it."""
    DATA.mkdir(exist_ok=True)
    print(f"data/{CACHE.name} is not here - downloading the NOAA file once.")
    reply = requests.get(URL, timeout=90, headers={"User-Agent": AGENT})
    reply.raise_for_status()
    CACHE.write_bytes(reply.content)
    print(f"saved data/{CACHE.name} ({CACHE.stat().st_size // 1024} KB).")


def fetch_land():
    """Download and cache Natural Earth's low-resolution land outlines."""
    DATA.mkdir(exist_ok=True)
    print(f"data/{LAND_CACHE.name} is not here - downloading the land outlines.")
    reply = requests.get(LAND_URL, timeout=30, headers={"User-Agent": AGENT})
    reply.raise_for_status()
    LAND_CACHE.write_text(reply.text, encoding="utf-8")
    print(f"saved data/{LAND_CACHE.name} ({LAND_CACHE.stat().st_size // 1024} KB).")


def cell_for(longitude, latitude):
    """Return a (row, column) for a coordinate, or None if it is invalid."""
    if not math.isfinite(longitude) or not math.isfinite(latitude):
        return None
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 360:
        return None

    longitude = (longitude + 180) % 360 - 180
    column = int((longitude + 180) // GRID_DEGREES)
    row = min(int((latitude + 90) // GRID_DEGREES), len(LATITUDE_EDGES) - 2)
    return row, column


def decode_char_array(values):
    """Decode a NetCDF character array into strings without deprecated helpers."""
    characters = np.asarray(values).astype("U1")
    width = characters.shape[-1]
    rows = characters.reshape(-1, width)
    decoded = np.array(["".join(row).rstrip("\x00 ") for row in rows])
    return decoded.reshape(characters.shape[:-1])


def load_tracks():
    """Return 2025 track points and distinct-storm counts for every grid cell."""
    if not CACHE.is_file():
        fetch()

    tracks = []
    density = np.zeros(
        (len(LATITUDE_EDGES) - 1, len(LONGITUDE_EDGES) - 1), dtype=np.int32
    )

    with Dataset(CACHE) as dataset:
        storm_ids = decode_char_array(dataset.variables["sid"][:])
        names = decode_char_array(dataset.variables["name"][:])
        times = decode_char_array(dataset.variables["iso_time"][:])
        seasons = dataset.variables["season"][:]
        latitudes = dataset.variables["lat"][:]
        longitudes = dataset.variables["lon"][:]

        for storm_index, raw_storm_id in enumerate(storm_ids):
            season = int(seasons[storm_index])
            if season != YEAR:
                continue

            storm_id = str(raw_storm_id).strip()
            name = str(names[storm_index]).strip()
            storm_cells = set()

            for point_index, (raw_lat, raw_lon) in enumerate(
                zip(latitudes[storm_index], longitudes[storm_index])
            ):
                if np.ma.is_masked(raw_lat) or np.ma.is_masked(raw_lon):
                    continue

                latitude = float(raw_lat)
                longitude = float(raw_lon)
                cell = cell_for(longitude, latitude)
                if cell is None:
                    continue

                timestamp = str(times[storm_index, point_index]).strip()
                if not timestamp:
                    continue

                tracks.append({
                    "storm_id": storm_id,
                    "season": season,
                    "name": name,
                    "time_utc": timestamp.replace(" ", "T") + "Z",
                    "lat": round(latitude, 2),
                    "lon": round(longitude, 2),
                })
                storm_cells.add(cell)

            for row, column in storm_cells:
                density[row, column] += 1

    return tracks, density


def save_tracks(tracks):
    """Write the source observations trimmed to the fields used by this map."""
    OUT.mkdir(exist_ok=True)
    target = OUT / f"typhoon-tracks-{YEAR}.csv"
    fields = ["storm_id", "season", "name", "time_utc", "lat", "lon"]
    with target.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(tracks)
    return target


def save_density(density):
    """Write the full grid, including cells with no recorded storm tracks."""
    OUT.mkdir(exist_ok=True)
    target = OUT / f"typhoon-track-density-{YEAR}.csv"
    fields = ["cell_lon", "cell_lat", "distinct_storms"]
    with target.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in range(density.shape[0]):
            for column in range(density.shape[1]):
                writer.writerow({
                    "cell_lon": LONGITUDE_EDGES[column] + GRID_DEGREES / 2,
                    "cell_lat": LATITUDE_EDGES[row] + GRID_DEGREES / 2,
                    "distinct_storms": int(density[row, column]),
                })
    return target


def draw_density(density):
    if not LAND_CACHE.is_file():
        fetch_land()
    land_data = json.loads(LAND_CACHE.read_text(encoding="utf-8"))
    land_polygons = []
    for feature in land_data["features"]:
        geometry = feature["geometry"]
        if geometry["type"] == "Polygon":
            land_polygons.append(geometry["coordinates"][0])
        elif geometry["type"] == "MultiPolygon":
            land_polygons.extend(polygon[0] for polygon in geometry["coordinates"])

    figure, axes = plt.subplots(figsize=(12, 6), facecolor=PAPER)
    axes.set_facecolor(SEA)
    axes.set_aspect("equal")
    axes.set_xlim(-180, 180)
    axes.set_ylim(-90, 90)
    axes.set_xticks([-180, -120, -60, 0, 60, 120, 180])
    axes.set_yticks([-60, -30, 0, 30, 60])
    axes.tick_params(colors=INK, labelsize=8)
    axes.grid(color=INK, alpha=0.12, linewidth=0.6)
    axes.add_collection(PolyCollection(
        land_polygons,
        facecolors=LAND,
        edgecolors=COAST,
        linewidths=0.35,
        zorder=1,
    ))

    rows, columns = np.nonzero(density)
    maximum = max(2, int(density.max()))
    painted = axes.scatter(
        LONGITUDE_EDGES[columns] + GRID_DEGREES / 2,
        LATITUDE_EDGES[rows] + GRID_DEGREES / 2,
        c=density[rows, columns],
        s=30,
        marker="o",
        cmap=COLOURS,
        norm=LogNorm(vmin=1, vmax=maximum),
        linewidths=0,
        zorder=2,
    )
    bar = figure.colorbar(painted, ax=axes, pad=0.02, shrink=0.78)
    bar.set_label(
        f"distinct storms per {GRID_DEGREES} degree cell (log scale)", color=INK
    )
    bar.ax.tick_params(colors=INK)

    axes.set_title(
        f"Global tropical cyclone track density, {YEAR}\n"
        "A storm is counted once per grid cell",
        color=INK,
        fontsize=12,
    )
    axes.set_xlabel("longitude (equirectangular)", color=INK)
    axes.set_ylabel("latitude", color=INK)
    for side in ("top", "right"):
        axes.spines[side].set_visible(False)

    OUT.mkdir(exist_ok=True)
    target = OUT / f"typhoon-track-density-{YEAR}.png"
    figure.tight_layout()
    figure.savefig(target, dpi=150, facecolor=PAPER)
    print(f"wrote {target.relative_to(HERE)}")
    plt.show()


def main():
    tracks, density = load_tracks()
    if not tracks:
        raise RuntimeError("The IBTrACS file contained no valid track points.")

    track_csv = save_tracks(tracks)
    density_csv = save_density(density)
    storm_count = len({point["storm_id"] for point in tracks})
    print(f"{YEAR}: {len(tracks):,} track points across {storm_count:,} storms")
    print(f"wrote {track_csv.relative_to(HERE)}")
    print(f"wrote {density_csv.relative_to(HERE)}")
    draw_density(density)


if __name__ == "__main__":
    main()