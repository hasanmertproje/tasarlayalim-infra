from __future__ import annotations

import sys
from pathlib import Path
from urllib.request import urlopen

ROOT = Path('/opt/FreyaTTS')
DEFAULT_VOXCPM_COMMIT = 'cce58a5b59303c9bd63d12f23afe6a49a4a80c59'


def fetch_text(url: str) -> str:
    return urlopen(url, timeout=30).read().decode('utf-8')


def main() -> None:
    voxcpm_commit = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_VOXCPM_COMMIT

    requirements = ROOT / 'requirements.txt'
    filtered: list[str] = []
    for line in requirements.read_text(encoding='utf-8').splitlines():
        if line.strip().lower() == 'voxcpm':
            continue
        filtered.append(line)
    requirements.write_text('\n'.join(filtered) + '\n', encoding='utf-8')

    base = f'https://raw.githubusercontent.com/OpenBMB/VoxCPM/{voxcpm_commit}'
    audiovae = fetch_text(base + '/src/voxcpm/modules/audiovae/audio_vae_v2.py')
    (ROOT / 'freyatts' / '_audiovae_v2.py').write_text(audiovae, encoding='utf-8')

    license_text = fetch_text(base + '/LICENSE')
    (ROOT / 'THIRD_PARTY_VOXCPM_LICENSE').write_text(license_text, encoding='utf-8')

    vae_path = ROOT / 'freyatts' / 'vae.py'
    source = vae_path.read_text(encoding='utf-8')
    needle = 'from voxcpm.modules.audiovae import AudioVAEV2, AudioVAEConfigV2'
    replacement = 'from ._audiovae_v2 import AudioVAE as AudioVAEV2, AudioVAEConfig as AudioVAEConfigV2'
    if needle not in source:
        raise RuntimeError('FreyaTTS AudioVAE import contract changed; refusing an unsafe patch')
    vae_path.write_text(source.replace(needle, replacement), encoding='utf-8')


if __name__ == '__main__':
    main()
