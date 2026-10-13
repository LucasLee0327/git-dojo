import { render } from 'preact';
import { App } from './ui/app';
import './styles.css';

const root = document.getElementById('app');
if (root) render(<App />, root);
