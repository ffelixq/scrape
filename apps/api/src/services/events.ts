import type { Investigation } from '@proofline/contracts';
import { EventEmitter } from 'node:events';

class InvestigationEvents extends EventEmitter {
  publish(investigation: Investigation) {
    this.emit(investigation.id, investigation);
  }

  subscribe(id: string, listener: (investigation: Investigation) => void) {
    this.on(id, listener);
    return () => this.off(id, listener);
  }
}

export const investigationEvents = new InvestigationEvents();
investigationEvents.setMaxListeners(200);
