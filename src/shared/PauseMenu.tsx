// Pause menu shared by both Rush styles. The Rush component owns the pause state and its game loop;
// this is only the overlay. Esc / P toggling is handled by the Rush component.

import { useEffect, useRef } from 'react';
import './pause.css';

export interface PauseMenuProps {
  onResume: () => void;
  /** Close the stand now, exactly as at closing time. */
  onEndDay: () => void;
}

export function PauseMenu({ onResume, onEndDay }: PauseMenuProps) {
  const resumeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => resumeRef.current?.focus(), []);

  return (
    <div className="pz-overlay" role="dialog" aria-modal="true" aria-labelledby="pz-title">
      <div className="pz-card">
        <h2 id="pz-title">Paused</h2>
        <button ref={resumeRef} type="button" className="pz-btn pz-primary" onClick={onResume}>
          Resume <small>(Esc)</small>
        </button>
        <button type="button" className="pz-btn" onClick={onEndDay}>
          End the day now
        </button>
        <p className="pz-note">
          Ending early closes the stand: customers still waiting go home (they don't count against you), and lemonade
          left in the jug is poured out.
        </p>
      </div>
    </div>
  );
}
