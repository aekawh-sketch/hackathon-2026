// План манежа, вручную отредактированный владельцем и экспортированный из редактора.
// Каждое открытие получает свою копию: правки демо не меняют исходный шаблон.
import plan from './demo-plan.json' with { type: 'json' };
import type { MapDocument } from './types.ts';

export function demoVenue(): MapDocument {
  return JSON.parse(JSON.stringify(plan)) as MapDocument;
}
