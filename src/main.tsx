import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import Desktop from './desktop';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><HashRouter><Desktop /></HashRouter></StrictMode>,
);
