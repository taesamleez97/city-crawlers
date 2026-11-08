// The real places behind each portal: the area to extract and the route through it.
//
// A route is a list of points along real streets, each one naming the street the
// hero swings down from there: `cross` = where two named streets meet, `on` = the
// middle of a named street (every carriageway) at a latitude or longitude.
// The first segment's street also gets the start perch, a rooftop at its end.
//
// `landmarks` are found by name in the data (`match`) or placed (`at`), so the
// game can dress them by hand.

export const CITIES = [
  {
    id: "nyc",
    center: [40.7505, -73.9812],
    radius: 1000,
    // North up Fifth Avenue from the Empire State Building past the library and
    // Bryant Park, then east on 42nd toward Grand Central and the Chrysler Building.
    route: [
      { cross: [/^5th Avenue$/, /^(East|West) 33rd Street$/], street: "5th Avenue" },
      { cross: [/^5th Avenue$/, /^(East|West) 42nd Street$/], street: "42nd Street" },
      { on: /^East 42nd Street$/, lon: -73.9769 },
    ],
    landmarks: [
      { id: "esb", match: /^Empire State Building$/ },
      { id: "chrysler", match: /^Chrysler Building$/ },
      { id: "vanderbilt", match: /^One Vanderbilt$/ },
      { id: "library", match: /^Stephen A\. Schwarzman Building$/ },
      { id: "grandcentral", match: /^Grand Central Terminal$/ },
    ],
  },
  {
    id: "tokyo",
    center: [35.6905, 139.6950],
    radius: 1000,
    // West down Chuo-dori from Shinjuku Station through the Nishi-Shinjuku towers,
    // then south on Koen-dori between the Metropolitan Government Building's twin
    // towers and Shinjuku Central Park.
    route: [
      { on: /^中央通り$/, lon: 139.6980, near: [35.6912, 139.6980], street: "Chuo-dori" },
      { cross: [/^中央通り$/, /^公園通り$/], street: "Koen-dori" },
      { on: /^公園通り$/, lat: 35.6884, near: [35.6884, 139.6905] },
    ],
    landmarks: [
      { id: "tocho", match: /^東京都庁舎 第一本庁舎$/ },
      { id: "tocho2", match: /^東京都庁舎 第二本庁舎$/ },
      { id: "assembly", match: /^東京都議会議事堂$/ },
      { id: "cocoon", match: /コクーン|Cocoon/ },
      { id: "center", match: /^新宿センタービル$/ },
    ],
  },
  {
    id: "seoul",
    center: [37.5728, 126.9795],
    radius: 1000,
    // East along Jong-ro past Jongno Tower, then north up Sejong-daero over
    // Gwanghwamun Square to the palace gate.
    route: [
      { on: /^종로$/, lon: 126.9851, street: "Jong-ro" },
      { cross: [/^종로$/, /^세종대로$/], street: "Sejong-daero" },
      { on: /^세종대로$/, lat: 37.5748 },
    ],
    perch: { w: 30, d: 30 },
    // Jong-ro and Sejong-daero are eight and ten lanes across.
    roadScale: 1.6,
    landmarks: [
      { id: "gwanghwamun", match: /^광화문$/ },
      { id: "jongnotower", match: /^종로타워$/ },
      { id: "kyobo", match: /^교보생명빌딩$/ },
      { id: "yi", at: [37.57120, 126.97692], yaw: 0 },
      { id: "sejong", at: [37.57280, 126.97690], yaw: 0 },
    ],
  },
  {
    id: "la",
    center: [34.0525, -118.2540],
    radius: 1000,
    // South down Grand Avenue on Bunker Hill past Disney Hall, the Broad and
    // California Plaza, then west on 5th Street under the U.S. Bank Tower.
    route: [
      { on: /^(North|South) Grand Avenue$/, lat: 34.0562, street: "Grand Avenue" },
      { cross: [/^South Grand Avenue$/, /^West 5th Street$/], street: "5th Street" },
      { on: /^West 5th Street$/, lon: -118.2568 },
    ],
    landmarks: [
      { id: "disney", match: /^Walt Disney Concert Hall$/ },
      { id: "broad", match: /^The Broad Museum$/ },
      { id: "usbank", match: /^U\.S\. Bank Tower$/ },
      { id: "wilshire", match: /^Wilshire Grand Building$/ },
      { id: "calplaza", match: /^(One|Two) California Plaza$/ },
    ],
  },
];
