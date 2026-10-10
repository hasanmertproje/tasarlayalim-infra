import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const TASO_ANIMATION_PRESETS = ['calm', 'pulse', 'orbit', 'breathe', 'minimal'] as const;
export type TasoAnimationPreset = (typeof TASO_ANIMATION_PRESETS)[number];

export type TasoBranding = {
  assistantName: string;
  assistantSubtitle: string;
  iconDataUrl?: string;
  lightIconDataUrl?: string;
  animationPreset: TasoAnimationPreset;
  updatedAt: string;
};

export type TasoControlPlaneSnapshot = {
  branding: TasoBranding;
};

function isoNow() { return new Date().toISOString(); }

function defaultFilePath() {
  return process.env.TASO_CONTROL_PLANE_FILE?.trim()
    || (process.env.NODE_ENV === 'production' ? '/data/taso-control-plane.json' : undefined);
}

function defaults(): TasoControlPlaneSnapshot {
  return {
    branding: {
      assistantName: 'Taso',
      assistantSubtitle: 'AI Operations',
      animationPreset: 'calm',
      updatedAt: isoNow(),
    },
  };
}

function validateDataUrl(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('Icon must be a data URL.');
  if (value.length > 1_500_000) throw new Error('Icon is too large. Maximum encoded size is 1.5 MB.');
  if (!/^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    throw new Error('Only PNG or WebP icon data URLs are accepted.');
  }
  return value;
}

export class ControlPlaneStore {
  private readonly filePath = defaultFilePath();
  private snapshot: TasoControlPlaneSnapshot = this.load();

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.snapshot)) as TasoControlPlaneSnapshot;
  }

  updateBranding(input: Partial<Omit<TasoBranding, 'updatedAt'>>) {
    const current = this.snapshot.branding;
    if (input.assistantName !== undefined) {
      const value = input.assistantName.trim().slice(0, 40);
      if (!value) throw new Error('Assistant name cannot be empty.');
      current.assistantName = value;
    }
    if (input.assistantSubtitle !== undefined) current.assistantSubtitle = input.assistantSubtitle.trim().slice(0, 80);
    if (input.animationPreset !== undefined) {
      if (!TASO_ANIMATION_PRESETS.includes(input.animationPreset)) throw new Error('Unknown animation preset.');
      current.animationPreset = input.animationPreset;
    }
    if ('iconDataUrl' in input) current.iconDataUrl = validateDataUrl(input.iconDataUrl);
    if ('lightIconDataUrl' in input) current.lightIconDataUrl = validateDataUrl(input.lightIconDataUrl);
    current.updatedAt = isoNow();
    this.persist();
    return this.getSnapshot().branding;
  }

  private load(): TasoControlPlaneSnapshot {
    if (!this.filePath) return defaults();
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<TasoControlPlaneSnapshot>;
      const fallback = defaults();
      return {
        branding: {
          ...fallback.branding,
          ...(parsed.branding ?? {}),
          animationPreset: TASO_ANIMATION_PRESETS.includes(parsed.branding?.animationPreset as TasoAnimationPreset)
            ? parsed.branding!.animationPreset as TasoAnimationPreset
            : fallback.branding.animationPreset,
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults();
      throw new Error(`Taso control plane state could not be loaded: ${(error as Error).message}`);
    }
  }

  private persist() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, this.filePath);
  }
}
