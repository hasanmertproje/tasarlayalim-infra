import { createId, nowIso } from './domain.js';

export type MissionEventType =
  | 'mission.created'
  | 'mission.approval_required'
  | 'mission.approved'
  | 'mission.cancelled'
  | 'mission.retry_scheduled'
  | 'mission.status_changed'
  | 'mission.note'
  | 'agent.started'
  | 'agent.progress'
  | 'agent.completed'
  | 'agent.failed';

export interface MissionEvent {
  id: string;
  missionId: string;
  type: MissionEventType;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export class MissionEventStore {
  private readonly events = new Map<string, MissionEvent[]>();

  constructor(initialEvents: MissionEvent[] = [], private readonly onChange: () => void = () => {}) {
    for (const event of initialEvents) {
      const list = this.events.get(event.missionId) ?? [];
      list.push(structuredClone(event));
      this.events.set(event.missionId, list);
    }
  }

  append(
    missionId: string,
    type: MissionEventType,
    message: string,
    metadata?: Record<string, unknown>,
  ): MissionEvent {
    const event: MissionEvent = {
      id: createId('event'),
      missionId,
      type,
      message,
      metadata,
      createdAt: nowIso(),
    };
    const list = this.events.get(missionId) ?? [];
    list.push(event);
    this.events.set(missionId, list);
    this.onChange();
    return event;
  }

  list(missionId: string): MissionEvent[] {
    return [...(this.events.get(missionId) ?? [])];
  }

  all(): MissionEvent[] {
    return [...this.events.values()].flat().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
