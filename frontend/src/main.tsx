import { render } from 'preact';
import { App } from './App';
import './style.css';
import { applyTheme, loadPref, watchSystem } from './theme';

applyTheme(loadPref());
watchSystem(loadPref);
render(<App />, document.getElementById('app') as HTMLElement);

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('./sw.js');
}
