import { createAdapter } from './adapter.mjs';
import { createPreferences } from './preferences.mjs';
import { installRenderer } from './renderer.mjs';

export const injection = `(${installRenderer.toString()})(${createAdapter.toString()},${createPreferences.toString()})`;
export function inject(session) { return session.expression(injection); }
