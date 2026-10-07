import type { CoreHealth, DataClass, Mission, MissionEvent, Project, Provider, RiskLevel } from './types';

const API_URL = (import.meta.env.VITE_TASO_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : `Taso API error (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export const tasoApi = {
  health: () => request<CoreHealth>('/health'),
  projects: () => request<{ projects: Project[] }>('/v1/projects'),
  missions: () => request<{ missions: Mission[] }>('/v1/missions'),
  providers: () => request<{ providers: Provider[] }>('/v1/providers'),
  missionEvents: (id: string) => request<{ events: MissionEvent[] }>(`/v1/missions/${encodeURIComponent(id)}/events`),
  createProject: (input: { slug: string; name: string; repository: string; isExisting: boolean; defaultBranch?: string }) =>
    request<{ project: Project }>('/v1/projects', { method: 'POST', body: JSON.stringify(input) }),
  createMission: (input: {
    projectId: string;
    objective: string;
    riskLevel: RiskLevel;
    dataClass: DataClass;
  }) => request<{ mission: Mission }>('/v1/missions', { method: 'POST', body: JSON.stringify(input) }),
  approveMission: (id: string) =>
    request<{ mission: Mission }>(`/v1/missions/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  cancelMission: (id: string) =>
    request<{ mission: Mission }>(`/v1/missions/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
};
