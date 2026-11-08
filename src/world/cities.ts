// The cities behind the rooftop portals. Their streets and buildings come from
// OpenStreetMap (public/cities/<id>.json, built by tools/osm); this file is how
// each one looks: palette, sky, trees, traffic and what stands on the skyline.

import { Facade } from "./meshBuilder";

export type CityId = "nyc" | "tokyo" | "seoul" | "la";

/** Something far off on the horizon, by compass bearing (degrees from north, clockwise). */
export type Backdrop =
  | { kind: "ridge"; bearing: number; width: number; height: number; peaks: number; seed: number; color: string; snow?: boolean }
  | { kind: "tower"; bearing: number; shape: "tokyoTower" | "skytree" | "namsan" | "wtc" | "sign"; color: string };

/** How a landmark from the map data is dressed (see public/cities/<id>.json `landmarks`). */
export type LandmarkLook = {
  wall?: string;
  window?: string;
  facade?: Facade;
  roof?: string;
  /** A spire on its tallest part (meters), with stepped crown tiers under it. */
  spire?: number;
  crown?: boolean;
  /** Hand-built in place of the footprint. */
  model?: "gate" | "statue" | "seated";
};

export interface CityStyle {
  id: CityId;
  name: string;
  /** The name in the city's own script, under the portal label. */
  local?: string;
  /** Portal and UI accent. */
  color: string;
  /** Neighborhood shown before the first street name. */
  area: string;
  sky: { top: string; horizon: string; sun: string; sunIntensity: number; hemiSky: string; hemiGround: string; sunDir: [number, number, number] };
  ground: string;
  road: string;
  plaza: string;
  park: string;
  water: string;
  rail: string;
  /** Center line color, and whether it's doubled. */
  center: string;
  doubleCenter: boolean;
  roof: string[];
  /** Low and mid-rise walls. */
  walls: string[];
  /** Tower curtain-wall tints. */
  glass: string[];
  /** Window glass in punched facades. */
  window: string;
  trim: string;
  /** Facade patterns by height band. */
  facades: { low: Facade[]; mid: Facade[]; tall: Facade[] };
  /** Height for buildings OpenStreetMap has none for (meters). */
  defaultHeight: number;
  trees: { kind: "round" | "palm" | "ginkgo"; leaf: string[]; spacing: number };
  traffic: string[];
  /** Rooftop water tanks on mid-rises (New York). */
  waterTowers?: boolean;
  /** Glowing signs on street-facing walls: vertical (Tokyo) or stacked shop boards (Seoul). */
  signs?: { kind: "vertical" | "boards"; colors: string[] };
  /** Traffic keeps left (Tokyo). */
  driveLeft?: boolean;
  /** Height the swings top out at (meters): lower where the street walls are. */
  swingY?: number;
  landmarks?: Record<string, LandmarkLook>;
  backdrop: Backdrop[];
}

const TRUCKS = ["vehicle-truck-red", "vehicle-truck-yellow", "vehicle-truck-green", "vehicle-truck-purple"];

export const CITIES: CityStyle[] = [
  {
    id: "nyc",
    name: "New York",
    color: "#FFC23D",
    area: "Midtown",
    sky: { top: "#4FB2EE", horizon: "#D8EEF8", sun: "#FFF0D8", sunIntensity: 1.8, hemiSky: "#DDEFFF", hemiGround: "#A2958E", sunDir: [-0.45, 0.8, 0.4] },
    ground: "#CBC6BE",
    road: "#4A4F5B",
    plaza: "#DCD3C3",
    park: "#7CC95A",
    water: "#3DB8E0",
    rail: "#8C7F72",
    center: "#FFCE3D",
    doubleCenter: true,
    roof: ["#8E929C", "#7D818C", "#9A9089"],
    walls: ["#E6D8BC", "#C9A27A", "#B46450", "#BDB8AE", "#8E5C49", "#EFE9DD", "#D9B48C"],
    glass: ["#4D6C99", "#6A8DB6", "#3E5878", "#7FA3C4"],
    window: "#4E6690",
    trim: "#F2EBDD",
    facades: { low: [Facade.Grid], mid: [Facade.Grid, Facade.Grid, Facade.Piers], tall: [Facade.Curtain, Facade.Piers, Facade.Grid] },
    defaultHeight: 24,
    trees: { kind: "round", leaf: ["#5EBD4E", "#46A548", "#7CC955"], spacing: 13 },
    traffic: ["vehicle-truck-yellow", "vehicle-truck-yellow", "vehicle-truck-yellow", "vehicle-truck-red"],
    waterTowers: true,
    landmarks: {
      esb: { wall: "#DCD2BE", window: "#56708F", facade: Facade.Piers },
      chrysler: { wall: "#EEEBE4", window: "#4E5F78", facade: Facade.Piers, spire: 38, crown: true },
      vanderbilt: { wall: "#DCE6EE", window: "#86A9C8", facade: Facade.Curtain },
      library: { wall: "#F2EDE0", window: "#7B8796", facade: Facade.Grid, roof: "#B9B3A6" },
      grandcentral: { wall: "#E8D8B8", window: "#5C7390", facade: Facade.Grid, roof: "#7FAF9A" },
    },
    backdrop: [
      { kind: "tower", bearing: 205, shape: "wtc", color: "#8FB4D8" },
      { kind: "ridge", bearing: 290, width: 70, height: 1.2, peaks: 7, seed: 3, color: "#9CC3A0" },
      { kind: "ridge", bearing: 95, width: 60, height: 0.8, peaks: 6, seed: 8, color: "#A7C7B0" },
    ],
  },
  {
    id: "tokyo",
    name: "Tokyo",
    local: "東京",
    color: "#FF5DA2",
    area: "Nishi-Shinjuku",
    sky: { top: "#5E86DA", horizon: "#FFD3B5", sun: "#FFD9B0", sunIntensity: 1.6, hemiSky: "#FFE3D2", hemiGround: "#9C8C98", sunDir: [-0.75, 0.42, 0.35] },
    ground: "#D0D1D6",
    road: "#4F535E",
    plaza: "#E2DDD6",
    park: "#78C463",
    water: "#47B6D8",
    rail: "#8A8279",
    center: "#F4F2EA",
    doubleCenter: false,
    roof: ["#9DA3AE", "#8C929D", "#B0B4BC"],
    walls: ["#F1F0EB", "#CBCED3", "#E4DACA", "#B5C4D4", "#DDE1E6", "#C7BCAE"],
    glass: ["#5A7EA8", "#7F98B6", "#4A6688", "#93AFC9"],
    window: "#4F6F99",
    trim: "#F7F6F2",
    facades: { low: [Facade.Ribbon, Facade.Grid], mid: [Facade.Ribbon, Facade.Grid, Facade.Curtain], tall: [Facade.Curtain, Facade.Grid, Facade.Ribbon] },
    defaultHeight: 18,
    trees: { kind: "ginkgo", leaf: ["#7FC24E", "#A6CF4A", "#5EAF4A"], spacing: 14 },
    traffic: TRUCKS,
    signs: { kind: "vertical", colors: ["#FF4FA3", "#36DFFF", "#FFE14D", "#6BFF8A", "#FF8A3D", "#B07CFF"] },
    driveLeft: true,
    landmarks: {
      tocho: { wall: "#C8CCD4", window: "#56698A", facade: Facade.Grid },
      tocho2: { wall: "#C8CCD4", window: "#56698A", facade: Facade.Grid },
      assembly: { wall: "#C8CCD4", window: "#56698A", facade: Facade.Grid },
      cocoon: { wall: "#EEF3F6", window: "#7095BA", facade: Facade.Curtain },
      center: { wall: "#5E534D", window: "#3E4858", facade: Facade.Ribbon },
    },
    backdrop: [
      { kind: "ridge", bearing: 245, width: 9, height: 2.6, peaks: 1, seed: 1, color: "#8A9BC8", snow: true },
      { kind: "ridge", bearing: 270, width: 60, height: 0.9, peaks: 8, seed: 4, color: "#A9A6C6" },
      { kind: "tower", bearing: 72, shape: "skytree", color: "#CFD8F0" },
      { kind: "tower", bearing: 128, shape: "tokyoTower", color: "#FF6A3D" },
    ],
  },
  {
    id: "seoul",
    name: "Seoul",
    local: "서울",
    color: "#46B4FF",
    area: "Jongno",
    sky: { top: "#3FA6F2", horizon: "#CFEAFC", sun: "#FFF4E2", sunIntensity: 1.85, hemiSky: "#DCEFFF", hemiGround: "#9A938E", sunDir: [-0.35, 0.75, 0.55] },
    ground: "#CDCDD0",
    road: "#4B505D",
    plaza: "#DCD6CB",
    park: "#86CC5E",
    water: "#3FC0E6",
    rail: "#8D857B",
    center: "#FFCE3D",
    doubleCenter: true,
    roof: ["#9AA0AA", "#8A909B", "#A7A39C"],
    walls: ["#CAC8C2", "#EEEDE8", "#DCD1BE", "#A9886F", "#BFC9D2", "#E2E4E6"],
    glass: ["#3F5E80", "#4F8F9A", "#6C8FB2", "#36506E"],
    window: "#4A6788",
    trim: "#F1F1EC",
    facades: { low: [Facade.Grid, Facade.Ribbon], mid: [Facade.Curtain, Facade.Ribbon, Facade.Grid], tall: [Facade.Curtain, Facade.Curtain, Facade.Ribbon] },
    defaultHeight: 16,
    // November: the ginkgo avenues have turned gold.
    trees: { kind: "ginkgo", leaf: ["#F4C430", "#F7D24A", "#E9B522"], spacing: 12 },
    traffic: TRUCKS,
    signs: { kind: "boards", colors: ["#E8443A", "#2F6FD6", "#F5C518", "#21A366", "#F7F7F2", "#FF7A2F"] },
    swingY: 27,
    landmarks: {
      gwanghwamun: { model: "gate" },
      jongnotower: { wall: "#5F6772", window: "#3C4F66", facade: Facade.Curtain },
      kyobo: { wall: "#6E4F40", window: "#3A3F48", facade: Facade.Ribbon },
      yi: { model: "statue" },
      sejong: { model: "seated" },
    },
    backdrop: [
      { kind: "ridge", bearing: 355, width: 26, height: 7.5, peaks: 3, seed: 11, color: "#6E9E80" },
      { kind: "ridge", bearing: 325, width: 22, height: 5.5, peaks: 3, seed: 5, color: "#7FA78C" },
      { kind: "ridge", bearing: 20, width: 40, height: 4.2, peaks: 5, seed: 9, color: "#86AD95" },
      { kind: "tower", bearing: 165, shape: "namsan", color: "#78A884" },
    ],
  },
  {
    id: "la",
    name: "Los Angeles",
    color: "#FF8A3D",
    area: "Bunker Hill",
    sky: { top: "#4FA3E6", horizon: "#FFE6BE", sun: "#FFE2B8", sunIntensity: 1.9, hemiSky: "#FFF0DA", hemiGround: "#B09A86", sunDir: [-0.7, 0.55, 0.45] },
    ground: "#D6CFC2",
    road: "#525661",
    plaza: "#E8DCC6",
    park: "#8CCB5C",
    water: "#3DBFE3",
    rail: "#9A8C7C",
    center: "#FFCE3D",
    doubleCenter: true,
    roof: ["#A49C92", "#948D86", "#B3A99B"],
    walls: ["#E8D6B6", "#D98E62", "#F2EEE4", "#EDB9A6", "#CFC2A8", "#E3C9A0"],
    glass: ["#4F88BA", "#5FA39A", "#3B5577", "#78A9CF"],
    window: "#4E7AA6",
    trim: "#F6F1E6",
    facades: { low: [Facade.Wall, Facade.Grid], mid: [Facade.Ribbon, Facade.Grid, Facade.Curtain], tall: [Facade.Curtain, Facade.Curtain, Facade.Piers] },
    defaultHeight: 14,
    trees: { kind: "palm", leaf: ["#4FAF4A", "#5FBF52", "#3E9C44"], spacing: 16 },
    traffic: TRUCKS,
    landmarks: {
      disney: { wall: "#D8DDE3", facade: Facade.Wall, roof: "#C9CFD6" },
      broad: { wall: "#F5F3EE", window: "#D9D5CB", facade: Facade.Grid, roof: "#E8E5DE" },
      usbank: { wall: "#CDBFA9", window: "#4C6A8C", facade: Facade.Piers },
      wilshire: { wall: "#A9C8E0", window: "#6E9CC6", facade: Facade.Curtain },
      calplaza: { wall: "#9DB7C8", window: "#557A99", facade: Facade.Curtain },
    },
    backdrop: [
      { kind: "ridge", bearing: 15, width: 80, height: 3.4, peaks: 9, seed: 2, color: "#A99AB8" },
      { kind: "ridge", bearing: 315, width: 30, height: 2.4, peaks: 4, seed: 6, color: "#B4A08C" },
      { kind: "tower", bearing: 318, shape: "sign", color: "#B4A08C" },
    ],
  },
];

export const cityById = (id: string): CityStyle | undefined => CITIES.find((c) => c.id === id);
