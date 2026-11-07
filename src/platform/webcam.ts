// A browser with no Little host (the Mac, for development): the webcam and an
// in-page pose model stand in for the television's camera and `sense.motion`.
// Frames go out in the same shape Little sends, so the gesture code, the camera
// mirror and the coaching all run unchanged. Never used inside a Little host.

import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import type { MotionFrame, MotionHandlers, MotionOptions } from "@kabletv/little-sdk";
import type { CameraFeed } from "./little";

// Keep in step with the exact version in package.json.
const MEDIAPIPE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm";
const MODEL = (size: "full" | "heavy") =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${size}/float16/latest/pose_landmarker_${size}.task`;

/** BlazePose's 33 landmarks → the COCO-17 names Little uses (both anatomical left/right). */
const COCO: ReadonlyArray<readonly [number, string]> = [
  [0, "nose"], [2, "left_eye"], [5, "right_eye"], [7, "left_ear"], [8, "right_ear"],
  [11, "left_shoulder"], [12, "right_shoulder"], [13, "left_elbow"], [14, "right_elbow"],
  [15, "left_wrist"], [16, "right_wrist"], [23, "left_hip"], [24, "right_hip"],
  [25, "left_knee"], [26, "right_knee"], [27, "left_ankle"], [28, "right_ankle"],
];
const RATE_HZ = 30;

export const webcamAvailable = () => !!navigator.mediaDevices?.getUserMedia;

// One camera stream shared by the pose model and the on-screen mirror.
let streamP: Promise<MediaStream> | null = null;
let refs = 0;

function acquire(): Promise<MediaStream> {
  refs++;
  streamP ??= navigator.mediaDevices
    .getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false })
    .catch((e) => {
      streamP = null;
      throw e;
    });
  return streamP;
}

function release() {
  refs = Math.max(0, refs - 1);
  if (refs > 0 || !streamP) return;
  const p = streamP;
  streamP = null;
  void p.then((s) => s.getTracks().forEach((t) => t.stop()), () => {});
}

const landmarkers = new Map<string, Promise<PoseLandmarker>>();

function landmarker(size: "full" | "heavy"): Promise<PoseLandmarker> {
  let p = landmarkers.get(size);
  if (!p) {
    p = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const files = await FilesetResolver.forVisionTasks(MEDIAPIPE);
      const make = (delegate: "GPU" | "CPU") =>
        PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL(size), delegate },
          runningMode: "VIDEO",
          numPoses: 1,
        });
      return make("GPU").catch(() => make("CPU"));
    })();
    p.catch(() => landmarkers.delete(size));
    landmarkers.set(size, p);
  }
  return p;
}

const reasonOf = (e: unknown) => (e instanceof DOMException ? e.name : String(e));

/** `sense.motion` from the webcam. Returns a closer. */
export function webcamMotion(h: MotionHandlers, o?: MotionOptions): () => void {
  let closed = false;
  let held = false;
  let video: HTMLVideoElement | null = null;
  let seq = 0;
  let lastTs = 0;
  h.onStatus?.({ state: "starting" });

  const close = () => {
    if (closed) return;
    closed = true;
    if (video) video.srcObject = null;
    if (held) release();
  };

  void (async () => {
    try {
      const stream = await acquire();
      held = true;
      if (closed) return release();
      const lm = await landmarker(o?.accuracy === "high" ? "heavy" : "full");
      if (closed) return;
      const v = (video = document.createElement("video"));
      v.muted = true;
      v.playsInline = true;
      v.srcObject = stream;
      await v.play();
      if (closed) return;
      h.onStatus?.({ state: "ready" });
      const step = (now: number, capturedAt: number) => {
        if (closed) return;
        schedule();
        // VIDEO mode needs strictly increasing timestamps; 30 Hz is plenty.
        if (now - lastTs < 1000 / RATE_HZ - 2 || v.readyState < 2 || !v.videoWidth) return;
        lastTs = now;
        const res = lm.detectForVideo(v, now);
        h.onFrame?.(toFrame(res.landmarks[0], v.videoWidth, v.videoHeight, Math.min(capturedAt, now), seq++));
      };
      const schedule = () =>
        "requestVideoFrameCallback" in v
          ? v.requestVideoFrameCallback((t, meta) => step(t, meta.captureTime ?? meta.expectedDisplayTime ?? t))
          : requestAnimationFrame((t) => step(t, t));
      schedule();
    } catch (e) {
      // A failed getUserMedia still counted this subscriber.
      if (!held) release();
      if (closed) return;
      console.warn("[webcam] pose unavailable", e);
      close();
      h.onStatus?.({ state: "unavailable", reason: reasonOf(e) });
    }
  })();
  return close;
}

/** `media.camera` from the webcam: the same stream the pose model reads. */
export async function webcamCamera(): Promise<CameraFeed> {
  try {
    const stream = await acquire();
    let done = false;
    return { stream, stop: () => void (!done && ((done = true), release())) };
  } catch (e) {
    release();
    return { stream: null, reason: reasonOf(e), stop: () => {} };
  }
}

type Point = { x: number; y: number; visibility?: number };

function toFrame(points: Point[] | undefined, width: number, height: number, t: number, sequence: number): MotionFrame {
  const at = { measuredAtMs: t, valueAtMs: t };
  const entities: MotionFrame["entities"] = [];
  if (points?.length) {
    const landmarks = COCO.map(([i, name]) => {
      const p = points[i];
      // Joints guessed outside the picture are not evidence.
      const inside = !!p && p.x > -0.02 && p.x < 1.02 && p.y > -0.02 && p.y < 1.02;
      if (!inside) return { name, state: "missing" as const, confidence: 0, ...at };
      return { name, state: "observed" as const, confidence: p.visibility ?? 1, ...at, position: { x: p.x, y: p.y } };
    });
    entities.push({
      id: "webcam-0",
      kind: "person",
      state: "observed",
      confidence: 1,
      ...at,
      channels: [{ channelId: "body.pose-2d", state: "observed", confidence: 1, ...at, bodyPose2d: { skeleton: "coco-17", landmarks } }],
    });
  }
  return {
    schemaVersion: 1,
    sequence,
    streamEpoch: "webcam",
    capturedAtMs: t,
    producedAtMs: performance.now(),
    descriptorId: "webcam",
    sourceId: "webcam",
    image: { width, height, rotationDegrees: 0, mirrored: false },
    channelAvailability: [],
    entities,
  };
}
