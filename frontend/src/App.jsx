import { Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout.jsx';
import HomePage from './pages/HomePage.jsx';
import CreateScenarioPage from './pages/CreateScenarioPage.jsx';
import GamePage from './pages/GamePage.jsx';
import EndingPage from './pages/EndingPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="create" element={<CreateScenarioPage />} />
        <Route path="game/:gameId" element={<GamePage />} />
        <Route path="game/:gameId/ending" element={<EndingPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
