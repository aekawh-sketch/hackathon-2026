// Распознавание плана — в фоне: на большом плане это секунда-две, интерфейс не должен замирать.
import { recognizePlan, type PlanImage } from '@space-map/map-core';

self.onmessage = (e: MessageEvent<PlanImage>) => {
  try {
    self.postMessage({ ok: true, plan: recognizePlan(e.data) });
  } catch (err) {
    self.postMessage({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};
