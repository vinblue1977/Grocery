import { render } from 'preact';
import { App } from './App';
import { pendingCount } from './queue';
import './style.css';
import { setupServiceWorker } from './swUpdate';
import { announceUpdate } from './UpdateBanner';
import { applyTheme, loadPref, watchSystem } from './theme';

applyTheme(loadPref());
watchSystem(loadPref);
render(<App />, document.getElementById('app') as HTMLElement);

// A reload waits while edits are queued (they are saved on this device anyway, so this only avoids churn).
setupServiceWorker(() => pendingCount() > 0, undefined, announceUpdate);
