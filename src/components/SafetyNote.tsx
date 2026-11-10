import { SAFETY_NOTE } from '../plan';

export function SafetyNote() {
  return (
    <aside className="safety" aria-label="Bezpečnostné upozornenie">
      <strong>Upozornenie:</strong> {SAFETY_NOTE}
    </aside>
  );
}
