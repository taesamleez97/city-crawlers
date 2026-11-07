// Stand-in for @kabletv/little-sdk with the subset of the surface City Crawlers uses.
// vite.config.ts aliases the real package to this file until it is installed
// (the real SDK is on an auth-gated registry; see README "Manual steps").

type Unsubscribe = () => void;
type EnterInfo = {
  params: Record<string, unknown>;
  state: Record<string, unknown>;
  restored: boolean;
  granted?: string[];
  denied?: string[];
};
type ToolHandler = (args: Record<string, unknown>) => unknown;

export function connect(_options?: unknown) {
  const enterHandlers: Array<(info: EnterInfo) => void> = [];
  const tools = new Map<string, ToolHandler>();
  queueMicrotask(() => {
    for (const h of enterHandlers) h({ params: {}, state: {}, restored: false, granted: [], denied: [] });
  });
  const app = {
    paused: false,
    onEnter(h: (info: EnterInfo) => void): Unsubscribe {
      enterHandlers.push(h);
      return () => enterHandlers.splice(enterHandlers.indexOf(h), 1);
    },
    onPause(_h: () => void): Unsubscribe {
      return () => {};
    },
    onResume(_h: () => void): Unsubscribe {
      return () => {};
    },
    tool(name: string, handler: ToolHandler): Unsubscribe {
      tools.set(name, handler);
      return () => tools.delete(name);
    },
    async call(name: string, args: Record<string, unknown> = {}) {
      const h = tools.get(name);
      return h ? ((await h(args)) ?? { ok: true }) : { ok: false, detail: `no handler for ${name}` };
    },
    emit(_name: string, _data?: unknown) {},
    async saveState(_state: unknown) {
      return { ok: false, error: { code: "no_host" } };
    },
    async exit() {
      return { ok: false, error: { code: "no_host" } };
    },
    can(_name: string) {
      return false;
    },
    setActiveTools(_names: string[] | null) {},
  };
  (window as unknown as { __little: unknown }).__little = app;
  return app;
}
