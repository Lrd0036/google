import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import RoyalDukeExperience from '@lrd0036/sclc/page';
import '@fontsource/share-tech-mono/400.css';
import '@lrd0036/sclc/styles';
import './styles/royal-duke-host.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <StrictMode><RoyalDukeExperience /></StrictMode>
  );
}
