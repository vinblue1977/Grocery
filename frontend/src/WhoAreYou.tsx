import { useEffect, useState } from 'preact/hooks';
import { ApiError, type Api } from './api';
import { avatarColor, initial } from './people';

interface Props {
  api: Api;
  onPicked: (person: string) => void;
  onSignedOut: () => void;
}

/** Shown once on a device that just signed in with an invite or recovery code: who is holding it? */
export function WhoAreYou({ api, onPicked, onSignedOut }: Props) {
  const [people, setPeople] = useState<string[] | null>(null);
  const [typing, setTyping] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.people().then(setPeople, (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) onSignedOut();
      else setPeople([]); // offline or failing: typing a name still works
    });
  }, []);

  const pick = async (person: string) => {
    if (!person || busy) return;
    setBusy(true);
    setError('');
    try {
      onPicked((await api.setPerson(person)).person);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onSignedOut();
      else setError('Could not save that. Check your connection and try again.');
      setBusy(false);
    }
  };

  const showForm = typing || (people !== null && people.length === 0);

  return (
    <main class="app">
      <h1>Who are you?</h1>
      <section class="card">
        <p class="muted">Pick your name so the others see who added what.</p>
        {people === null && <p class="muted">Loading…</p>}
        {people !== null && people.length > 0 && (
          <div class="people">
            {people.map((person) => (
              <button type="button" key={person} disabled={busy} onClick={() => void pick(person)}>
                <span class="av" aria-hidden="true" style={{ background: avatarColor(person) }}>
                  {initial(person)}
                </span>
                {person}
              </button>
            ))}
            {!showForm && (
              <button type="button" disabled={busy} onClick={() => setTyping(true)}>
                + I'm someone new
              </button>
            )}
          </div>
        )}
        {showForm && (
          <form
            class="add"
            onSubmit={(e) => {
              e.preventDefault();
              void pick(name.trim());
            }}
          >
            <input value={name} maxLength={40} placeholder="Your name" aria-label="Your name" onInput={(e) => setName(e.currentTarget.value)} />
            <button type="submit" disabled={busy || !name.trim()}>
              Save
            </button>
          </form>
        )}
        {error && <p class="error">{error}</p>}
      </section>
    </main>
  );
}
