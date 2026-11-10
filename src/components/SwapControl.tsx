import { useEffect, useId, useRef, useState } from 'react';
import { getExercise, swapChoices, type StrengthItem, type TrainingPlan } from '../plan';

export type SwapHandler = (original: string, replacement: string | null) => void;

interface SwapControlProps {
  item: StrengthItem;
  plan: TrainingPlan;
  session: string | undefined;
  onSwap: SwapHandler;
}

/** "Remove and replace" for a planned exercise; the choice applies to the whole plan. */
export function SwapControl({ item, plan, session, onSwap }: SwapControlProps) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const panelId = useId();
  const original = item.replaces ?? item.exerciseId;
  const choices = swapChoices(item, plan, session);
  const originalName = item.replaces ? getExercise(item.replaces)?.name : undefined;

  useEffect(() => {
    if (open) {
      panelRef.current?.querySelector('button')?.focus();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      toggleRef.current?.focus();
    }
  }, [open, item.exerciseId]);

  const close = () => {
    restoreFocus.current = true;
    setOpen(false);
  };
  const choose = (replacement: string | null) => {
    onSwap(original, replacement);
    close();
  };

  if (choices.length === 0 && !item.replaces) return null;

  return (
    <div className="swap">
      {originalName && (
        <p className="item__note swap__info">
          Namiesto cviku <strong>{originalName}</strong>.
        </p>
      )}
      <button
        type="button"
        ref={toggleRef}
        className="swap__toggle"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {open ? 'Zavrieť' : 'Zmazať a nahradiť'}
      </button>
      {open && (
        <div
          id={panelId}
          ref={panelRef}
          className="swap__panel"
          role="group"
          aria-label="Náhrada cviku"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
        >
          <p className="swap__hint">
            Vyber náhradu. Zmena platí pre všetky dni plánu, série a opakovania ostávajú.
          </p>
          <ul className="swap__choices">
            {choices.map((exercise) => (
              <li key={exercise.id}>
                <button type="button" className="swap__choice" onClick={() => choose(exercise.id)}>
                  <span className="swap__name">{exercise.name}</span>
                  <span className="swap__equipment">{exercise.equipment}</span>
                </button>
              </li>
            ))}
            {item.replaces && originalName && (
              <li>
                <button
                  type="button"
                  className="swap__choice swap__choice--restore"
                  onClick={() => choose(null)}
                >
                  <span className="swap__name">Vrátiť pôvodný: {originalName}</span>
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
