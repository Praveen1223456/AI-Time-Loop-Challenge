import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';
import * as api from './services/api.js';
import * as gameApi from './services/gameApi.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const renderAt = (path) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

describe('App routing', () => {
  it('renders the home page with a status panel and a real navigation link (no inert buttons)', async () => {
    vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', environment: 'test', database: { status: 'connected' } });
    vi.spyOn(gameApi, 'listSamples').mockResolvedValue([]);
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: /break the loop/i })).toBeInTheDocument();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start a time loop/i })).toHaveAttribute('href', '/create');
    expect(screen.queryByRole('button', { name: /start a time loop/i })).not.toBeInTheDocument();
  });

  it('renders a not-found page for unknown routes', () => {
    renderAt('/nope');
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  });
});
