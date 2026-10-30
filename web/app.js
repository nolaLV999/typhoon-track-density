const TRACKS_URL = "../out/typhoon-tracks-2025.csv";
const LAND_URL = "../data/ne_110m_land.geojson";
const TRACK_COLOUR = "#78918d";
const SELECTED_COLOUR = "#e66c44";

const canvas = document.querySelector("#storm-map");
const context = canvas.getContext("2d");
const loading = document.querySelector("#map-loading");
const stormSelect = document.querySelector("#storm-select");
const stormCount = document.querySelector("#storm-count");
const stormName = document.querySelector("#storm-name");
const stormId = document.querySelector("#storm-id");
const slider = document.querySelector("#time-slider");
const pointCount = document.querySelector("#point-count");
const playButton = document.querySelector("#play-button");
const playIcon = document.querySelector("#play-icon");
const playLabel = document.querySelector("#play-label");
const observationTime = document.querySelector("#observation-time");
const latitude = document.querySelector("#latitude");
const longitude = document.querySelector("#longitude");
const errorMessage = document.querySelector("#error-message");

let landData;
let storms = [];
let selectedStorm;
let currentIndex = 0;
let playback;
let mapBounds = { x: 0, y: 0, width: 0, height: 0 };

function parseCsvRow(line) {
  const fields = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (insideQuotes && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (character === "," && !insideQuotes) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  fields.push(field);
  return fields;
}

function parseTracks(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error("The track file contains no observations.");
  }

  const headers = parseCsvRow(lines[0]);
  const expectedHeaders = ["storm_id", "season", "name", "time_utc", "lat", "lon"];
  if (expectedHeaders.some((header) => !headers.includes(header))) {
    throw new Error("The track file is missing one or more required columns.");
  }

  const positions = new Map();
  for (const [lineIndex, line] of lines.slice(1).entries()) {
    if (!line.trim()) continue;
    const values = parseCsvRow(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    const time = Date.parse(row.time_utc);
    if (!row.storm_id || !row.name || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(time)) {
      throw new Error(`The track file has an invalid observation on row ${lineIndex + 2}.`);
    }

    if (!positions.has(row.storm_id)) {
      positions.set(row.storm_id, {
        id: row.storm_id,
        name: row.name,
        points: [],
      });
    }
    positions.get(row.storm_id).points.push({
      time: row.time_utc,
      lat,
      lon,
    });
  }

  return [...positions.values()]
    .map((storm) => ({
      ...storm,
      points: storm.points.sort((left, right) => Date.parse(left.time) - Date.parse(right.time)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function getJson(response, label) {
  if (!response.ok) {
    throw new Error(`Could not load ${label} (HTTP ${response.status}).`);
  }
  return response.json();
}

async function loadData() {
  const [trackResponse, landResponse] = await Promise.all([
    fetch(TRACKS_URL),
    fetch(LAND_URL),
  ]);
  if (!trackResponse.ok) {
    throw new Error(`Could not load the track file (HTTP ${trackResponse.status}).`);
  }
  const [csv, geojson] = await Promise.all([
    trackResponse.text(),
    getJson(landResponse, "the coastline data"),
  ]);
  landData = geojson;
  storms = parseTracks(csv);
  if (storms.length === 0) {
    throw new Error("The track file contains no storms for this season.");
  }
  populateStorms();
  resizeMap();
  loading.hidden = true;
}

function populateStorms() {
  const options = document.createDocumentFragment();
  for (const storm of storms) {
    const option = document.createElement("option");
    option.value = storm.id;
    option.textContent = `${storm.name} · ${storm.id}`;
    options.append(option);
  }
  stormSelect.replaceChildren(options);
  stormSelect.disabled = false;
  stormCount.textContent = `${storms.length} storms`;
  stormSelect.addEventListener("change", () => selectStorm(stormSelect.value));
  slider.addEventListener("input", () => {
    stopPlayback();
    currentIndex = Number(slider.value);
    updateObservation();
    drawMap();
  });
  playButton.addEventListener("click", togglePlayback);
  const firstStorm = storms.find((storm) => storm.name === "RAGASA") ?? storms[0];
  selectStorm(firstStorm.id);
}

function selectStorm(id) {
  stopPlayback();
  selectedStorm = storms.find((storm) => storm.id === id);
  if (!selectedStorm) {
    throw new Error(`The selected storm "${id}" is not in the loaded track file.`);
  }
  stormSelect.value = selectedStorm.id;
  currentIndex = 0;
  slider.min = "0";
  slider.max = String(selectedStorm.points.length - 1);
  slider.value = String(currentIndex);
  slider.disabled = selectedStorm.points.length < 2;
  playButton.disabled = selectedStorm.points.length < 2;
  stormName.textContent = selectedStorm.name;
  stormId.textContent = selectedStorm.id;
  updateObservation();
  drawMap();
}

function formatTime(value) {
  return new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function coordinate(value, direction) {
  const hemisphere = direction === "lat"
    ? (value < 0 ? "S" : "N")
    : (value < 0 ? "W" : "E");
  return `${Math.abs(value).toFixed(1)}° ${hemisphere}`;
}

function updateObservation() {
  const point = selectedStorm.points[currentIndex];
  slider.value = String(currentIndex);
  pointCount.textContent = `${currentIndex + 1} / ${selectedStorm.points.length} fixes`;
  observationTime.textContent = formatTime(point.time);
  latitude.textContent = coordinate(point.lat, "lat");
  longitude.textContent = coordinate(point.lon, "lon");
}

function togglePlayback() {
  if (playback) {
    stopPlayback();
    return;
  }
  if (currentIndex >= selectedStorm.points.length - 1) {
    currentIndex = 0;
    updateObservation();
    drawMap();
  }
  playIcon.textContent = "Ⅱ";
  playLabel.textContent = "Pause track";
  playback = window.setInterval(() => {
    if (currentIndex >= selectedStorm.points.length - 1) {
      stopPlayback();
      return;
    }
    currentIndex += 1;
    updateObservation();
    drawMap();
  }, 420);
}

function stopPlayback() {
  if (playback) {
    window.clearInterval(playback);
    playback = undefined;
  }
  playIcon.textContent = "▶";
  playLabel.textContent = "Play track";
}

function normalizedLongitude(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function project(lon, lat) {
  const x = mapBounds.x + (normalizedLongitude(lon) + 180) * mapBounds.width / 360;
  const y = mapBounds.y + (90 - lat) * mapBounds.height / 180;
  return { x, y };
}

function setMapBounds(width, height) {
  const scale = Math.min(width / 360, height / 180);
  mapBounds = {
    x: (width - 360 * scale) / 2,
    y: (height - 180 * scale) / 2,
    width: 360 * scale,
    height: 180 * scale,
  };
}

function drawGrid(width, height) {
  context.save();
  context.strokeStyle = "#c8d9d8";
  context.lineWidth = 0.65;
  for (let lon = -150; lon <= 150; lon += 30) {
    const x = project(lon, 0).x;
    context.beginPath();
    context.moveTo(x, mapBounds.y);
    context.lineTo(x, mapBounds.y + mapBounds.height);
    context.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = project(0, lat).y;
    context.beginPath();
    context.moveTo(mapBounds.x, y);
    context.lineTo(mapBounds.x + mapBounds.width, y);
    context.stroke();
  }
  context.strokeStyle = "#9fb6b4";
  context.lineWidth = 0.8;
  context.strokeRect(mapBounds.x, mapBounds.y, mapBounds.width, mapBounds.height);
  context.restore();
}

function drawLand() {
  context.save();
  context.fillStyle = "#d2dbcf";
  context.strokeStyle = "#a9b8ac";
  context.lineWidth = 0.55;

  for (const feature of landData.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const polygons = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
    context.beginPath();
    for (const polygon of polygons) {
      for (const ring of polygon) {
        ring.forEach(([lon, lat], index) => {
          const point = project(lon, lat);
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
        context.closePath();
      }
    }
    context.fill("evenodd");
    context.stroke();
  }
  context.restore();
}

function drawStorm(storm, colour, lineWidth, points) {
  context.save();
  context.strokeStyle = colour;
  context.lineWidth = lineWidth;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  let previousX;
  for (const point of points) {
    const projected = project(point.lon, point.lat);
    if (previousX === undefined || Math.abs(projected.x - previousX) > mapBounds.width / 2) {
      context.moveTo(projected.x, projected.y);
    } else {
      context.lineTo(projected.x, projected.y);
    }
    previousX = projected.x;
  }
  context.stroke();
  context.restore();
}

function drawMap() {
  if (!landData || !selectedStorm) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  setMapBounds(width, height);
  drawLand();
  drawGrid(width, height);

  for (const storm of storms) {
    if (storm.id !== selectedStorm.id) {
      drawStorm(storm, TRACK_COLOUR, 0.75, storm.points);
    }
  }
  const visiblePoints = selectedStorm.points.slice(0, currentIndex + 1);
  drawStorm(selectedStorm, SELECTED_COLOUR, 2.2, visiblePoints);

  const currentPoint = selectedStorm.points[currentIndex];
  const marker = project(currentPoint.lon, currentPoint.lat);
  context.beginPath();
  context.arc(marker.x, marker.y, 5.2, 0, Math.PI * 2);
  context.fillStyle = SELECTED_COLOUR;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = "#fffefa";
  context.stroke();
}

function resizeMap() {
  if (landData) drawMap();
}

const resizeObserver = new ResizeObserver(resizeMap);
resizeObserver.observe(canvas);
window.addEventListener("beforeunload", stopPlayback);

loadData().catch((error) => {
  loading.hidden = true;
  errorMessage.hidden = false;
  errorMessage.textContent = `${error.message} Start the local web server from the repository root and reload this page.`;
});
