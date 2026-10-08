import { render } from 'preact';
import { App } from './app/App';
import { installAppBindings } from './app/bindings';
import { startDemoProfile } from './app/game-store';
import './styles/tokens.css';
import './styles/base.css';

installAppBindings();
startDemoProfile();

const root = document.getElementById('app');
if (root) render(<App />, root);
