import {createRoot} from 'react-dom/client';
import './app/globals.css';
import Home from './app/page';
import './desktop.css';
(window as any).__TAURI__ ??= (window.parent as any).__TAURI__;
createRoot(document.getElementById('root')!).render(<Home/>);
