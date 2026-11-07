import * as sdk from "@kabletv/little-sdk";

import { webcamAvailable, webcamCamera, webcamMotion } from "./webcam";

// The narrow slice of the Little SDK the game depends on. Everything else in the
// codebase talks to this interface, so the stub and the real SDK are interchangeable.
export interface LittlePlatform {
  readonly isStub: boolean;
  onEnter(h: (info: { params: Record<string, unknown>; state: Record<string, unknown>; restored: boolean }) => void): void;
  onPause(h: () => void): void;
  onResume(h: () => void): void;
  tool(name: string, h: (args: Record<string, unknown>) => unknown): void;
  emit(name: string, data?: Record<string, unknown>): void;
  saveState(state: Record<string, unknown>): void;
  exit(): void;
  can(capability: string): boolean;
  setActiveTools(names: string[] | null): void;
  /** Body-pose evidence stream (`sense.motion`); returns a closer. */
  motion(handlers: sdk.MotionHandlers, options?: sdk.MotionOptions): () => void;
  /** The live camera picture (`media.camera`), for showing players where they stand. */
  camera(): Promise<CameraFeed>;
}

export type CameraFeed = { stream: MediaStream; stop(): void } | { stream: null; reason: string; stop(): void };

declare const __LITTLE_STUB__: boolean;
export const isStub = __LITTLE_STUB__;

type EnterInfo = Parameters<Parameters<LittlePlatform["onEnter"]>[0]>[0];

/** Call synchronously at startup: enter info is buffered for handlers added after loading. */
export function connectLittle(): LittlePlatform {
  const debug = new URLSearchParams(location.search).has("littleDebug");
  const app = (sdk.connect as (o?: unknown) => any)(debug ? { debug: true } : undefined);
  let entered: EnterInfo | null = null;
  const enterHandlers: Array<(info: EnterInfo) => void> = [];
  app.onEnter((info: any) => {
    entered = { params: info?.params ?? {}, state: info?.state ?? {}, restored: !!info?.restored };
    for (const h of enterHandlers) h(entered);
  });
  return {
    isStub,
    onEnter: (h) => {
      enterHandlers.push(h);
      if (entered) h(entered);
    },
    onPause: (h) => void app.onPause?.(h),
    onResume: (h) => void app.onResume?.(h),
    tool: (name, h) => void app.tool(name, h),
    emit: (name, data) => void app.emit?.(name, data ?? {}),
    saveState: (state) => void app.saveState?.(state)?.catch?.(() => {}),
    exit: () => void app.exit?.(),
    // A host always enters at startup; without one (a desktop browser) the webcam stands in.
    can: (c) => (entered ? !!app.can?.(c) : (c === "sense.motion" || c === "media.camera") && webcamAvailable()),
    setActiveTools: (names) => void app.setActiveTools?.(names),
    motion: (handlers, options) => {
      if (!entered) return webcamMotion(handlers, options);
      if (!app.sense?.motion) {
        handlers.onStatus?.({ state: "unavailable", reason: "no_host" });
        return () => {};
      }
      const sub = app.sense.motion(handlers, options);
      return () => sub.close();
    },
    camera: async () => {
      const none = (reason: string): CameraFeed => ({ stream: null, reason, stop: () => {} });
      if (!entered) return webcamCamera();
      if (!app.media?.camera || !app.can?.("media.camera")) return none("not_granted");
      try {
        const grant = await app.media.camera({ facing: "user", width: 640, height: 360, fps: 15 });
        if (grant.ok) return { stream: grant.stream as MediaStream, stop: () => grant.stop() };
        grant.stop?.();
        return none(grant.error?.code ?? "unavailable");
      } catch (e) {
        return none(String(e));
      }
    },
  };
}
