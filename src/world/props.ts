import { type AnimationClip, BufferAttribute, BufferGeometry, type Mesh, type Object3D } from "three";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const base = import.meta.env.BASE_URL;

export const KIT_MODELS = [
  "vehicle-truck-red", "vehicle-truck-yellow", "vehicle-truck-green", "vehicle-truck-purple",
  "grass-trees-tall", "grass-trees", "pavement-fountain",
  "building-small-a", "building-small-b", "building-small-c", "building-small-d",
] as const;

/** First-person arms variants; `?arms=custom` picks the in-house blocky rig. */
const ARMS_FILES: Record<string, string> = { psx: "arms-psx.glb", custom: "arms.glb" };
const armsFile = ARMS_FILES[new URLSearchParams(location.search).get("arms") ?? ""] ?? ARMS_FILES.psx;

/** Quantized (normalized int) attributes → plain floats so transforms can be baked. */
function toFloat(geo: BufferGeometry): BufferGeometry {
  const out = new BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.getAttribute(name) as BufferAttribute;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c);
    out.setAttribute(name, new BufferAttribute(arr, a.itemSize));
  }
  if (geo.index) out.setIndex(geo.index.clone());
  return out;
}

function bakeMeshes(root: Object3D): Map<string, BufferGeometry> {
  root.updateMatrixWorld(true);
  const out = new Map<string, BufferGeometry>();
  root.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    const mesh = o as Mesh;
    const g = toFloat(mesh.geometry);
    g.applyMatrix4(mesh.matrixWorld);
    // Blender exports one node per prop; meshes under it share the node's name.
    let named: Object3D = mesh;
    while (named.parent && named.parent !== root && !named.name) named = named.parent;
    const name = named.name || mesh.name;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    out.set(name, g);
  });
  return out;
}

export class PropLibrary {
  readonly geometries = new Map<string, BufferGeometry>();
  arms!: GLTF;

  static async load(onProgress?: (p: number) => void): Promise<PropLibrary> {
    const lib = new PropLibrary();
    const jobs: Array<Promise<void>> = [];
    let done = 0;
    const total = 2 + KIT_MODELS.length;
    const tick = () => onProgress?.(++done / total);
    jobs.push(
      loader.loadAsync(`${base}models/props.glb`).then((g) => {
        for (const [k, v] of bakeMeshes(g.scene)) lib.geometries.set(k, v);
        tick();
      }),
    );
    for (const name of KIT_MODELS) {
      jobs.push(
        loader.loadAsync(`${base}models/kit/${name}.glb`).then((g) => {
          const geos = [...bakeMeshes(g.scene).values()];
          lib.geometries.set(`kit:${name}`, geos[0]);
          tick();
        }),
      );
    }
    jobs.push(
      loader.loadAsync(`${base}models/${armsFile}`).then((g) => {
        lib.arms = g;
        tick();
      }),
    );
    await Promise.all(jobs);
    return lib;
  }

  get(name: string): BufferGeometry {
    const g = this.geometries.get(name);
    if (!g) throw new Error(`Missing prop geometry "${name}". Run \`npm run assets\`.`);
    return g;
  }

  armsClips(): AnimationClip[] {
    return this.arms.animations;
  }
}
