import { render } from 'preact';
import { App } from './App';
import './style.css';
import { setupServiceWorker } from './swUpdate';
import { applyTheme, loadPref, watchSystem } from './theme';

applyTheme(loadPref());
watchSystem(loadPref);
render(<App />, document.getElementById('app') as HTMLElement);

// No unsent edits can exist yet (there is no write queue); pass a real check here when one is added.
setupServiceWorker(() => false);
