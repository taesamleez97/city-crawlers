import * as sdk from "@kabletv/little-sdk";

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
}

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
    can: (c) => !!app.can?.(c),
    setActiveTools: (names) => void app.setActiveTools?.(names),
  };
}
