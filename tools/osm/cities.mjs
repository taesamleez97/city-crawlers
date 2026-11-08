// The real places behind each portal: the area to extract and the route through it.
//
// A route is a list of points along real streets, each one naming the street the
// hero swings down from there: `cross` = where two named streets meet, `on` = the
// middle of a named street (every carriageway) at a latitude or longitude.
// The first segment's street also gets the start perch, a rooftop at its end.
//
// `landmarks` are found by name in the data (`match`) or placed (`at`), so the
// game can dress them by hand.
//
// `sections` are the city's other runs ("Next Area" after a finish), each its own
// file (<id>-2.json…) cut from the same extract: a route with the area's name, and
// anything else to override. Routes keep to the middle of the extract so its edges
// stay out past the fog.

export const CITIES = [
  {
    id: "nyc",
    center: [40.7505, -73.9812],
    radius: 1000,
    area: "Midtown",
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
    sections: [
      {
        area: "Times Square",
        // North up Sixth Avenue from Herald Square, past Bryant Park and the Bank of
        // America Tower, then west on 42nd into Times Square.
        route: [
          { cross: [/^6th Avenue$/, /^West 34th Street$/], street: "6th Avenue" },
          { cross: [/^6th Avenue$/, /^West 42nd Street$/], street: "42nd Street" },
          { on: /^West 42nd Street$/, lon: -73.9863 },
        ],
        landmarks: [
          { id: "esb", match: /^Empire State Building$/ },
          { id: "library", match: /^Stephen A\. Schwarzman Building$/ },
          { id: "vanderbilt", match: /^One Vanderbilt$/ },
        ],
      },
    ],
  },
  {
    id: "tokyo",
    center: [35.6905, 139.6950],
    radius: 1000,
    area: "Nishi-Shinjuku",
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
    sections: [
      {
        area: "Ome-kaido",
        // West along Ome-kaido under the northern towers, then south down Koen-dori
        // toward the Metropolitan Government Building.
        route: [
          { on: /^青梅街道$/, lon: 139.6985, street: "Ome-kaido" },
          { cross: [/^青梅街道$/, /^公園通り$/], street: "Koen-dori" },
          { on: /^公園通り$/, lat: 35.6921, near: [35.6921, 139.6905] },
        ],
        landmarks: [
          { id: "tocho", match: /^東京都庁舎 第一本庁舎$/ },
          { id: "tocho2", match: /^東京都庁舎 第二本庁舎$/ },
          { id: "cocoon", match: /コクーン|Cocoon/ },
        ],
      },
    ],
  },
  {
    id: "seoul",
    center: [37.5728, 126.9795],
    radius: 1000,
    area: "Jongno",
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
    sections: [
      {
        area: "Cheonggyecheon",
        // West over the Cheonggyecheon stream between its two roads, then south down
        // Mugyo-ro toward City Hall.
        route: [
          { on: /^청계천로$/, lon: 126.9870, street: "Cheonggyecheon-ro" },
          { cross: [/^청계천로$/, /^무교로$/], street: "Mugyo-ro" },
          { on: /^무교로$/, lat: 37.5676 },
        ],
        landmarks: [
          { id: "jongnotower", match: /^종로타워$/ },
          { id: "kyobo", match: /^교보생명빌딩$/ },
        ],
      },
    ],
  },
  {
    id: "la",
    center: [34.0525, -118.2540],
    radius: 1000,
    area: "Bunker Hill",
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
    sections: [
      {
        area: "Financial District",
        // South down Flower Street past the Bonaventure and the towers of the
        // financial district, then west on 7th to Figueroa by the Wilshire Grand.
        route: [
          { cross: [/^South Flower Street$/, /^West 3rd Street$/], street: "Flower Street" },
          { cross: [/^South Flower Street$/, /^West 7th Street$/], street: "7th Street" },
          { cross: [/^South Figueroa Street$/, /^West 7th Street$/] },
        ],
        landmarks: [
          { id: "usbank", match: /^U\.S\. Bank Tower$/ },
          { id: "wilshire", match: /^Wilshire Grand Building$/ },
        ],
      },
    ],
  },
];
