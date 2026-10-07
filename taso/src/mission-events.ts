import { createId, nowIso } from './domain.js';

export type MissionEventType =
  | 'mission.created'
  | 'mission.approval_required'
  | 'mission.approved'
  | 'mission.cancelled'
  | 'mission.status_changed'
  | 'mission.note';

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
    return event;
  }

  list(missionId: string): MissionEvent[] {
    return [...(this.events.get(missionId) ?? [])];
  }
}
