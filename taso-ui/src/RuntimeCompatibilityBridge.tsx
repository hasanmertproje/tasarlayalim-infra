import { useEffect, useState } from 'react';

/**
 * Compatibility shim for runtime modules that still resolve the active workspace
 * through `.project-tab.active`. It mirrors the new context bar without exposing
 * another visible project switcher. Remove once all consumers use a shared
 * workspace store.
 */
export default function RuntimeCompatibilityBridge() {
  const [projectName, setProjectName] = useState('');

  useEffect(() => {
    const sync = () => {
      const next = document.querySelector<HTMLElement>('.nova-context-project > span')?.textContent?.trim() ?? '';
      setProjectName((current) => current === next ? current : next);
    };
    sync();
    const root = document.getElementById('root');
    const observer = root ? new MutationObserver(sync) : undefined;
    observer?.observe(root!, { childList: true, subtree: true, characterData: true });
    return () => observer?.disconnect();
  }, []);

  return <button type="button" className="project-tab active nova-project-runtime-bridge" aria-hidden="true" tabIndex={-1}>{projectName}</button>;
}
