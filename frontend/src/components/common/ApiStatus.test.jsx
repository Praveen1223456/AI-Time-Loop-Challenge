import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import ApiStatus from './ApiStatus.jsx';
import * as api from '../../services/api.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ApiStatus', () => {
  it('shows a checking state first, then connected when the API and database are healthy', async () => {
    vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', environment: 'development', database: { status: 'connected' } });
    render(<ApiStatus />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking');
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('development')).toBeInTheDocument();
  });

  it('is honest when the API is up but the database is not', async () => {
    vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'degraded', environment: 'development', database: { status: 'disconnected' } });
    render(<ApiStatus />);
    expect(await screen.findByText(/database not connected/i)).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('reports an unreachable API and lets the user retry', async () => {
    const spy = vi.spyOn(api, 'getHealth').mockRejectedValueOnce(new api.ApiError(0, 'NETWORK_ERROR', 'down'));
    render(<ApiStatus />);
    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
    spy.mockResolvedValueOnce({ status: 'ok', environment: 'test', database: { status: 'connected' } });
    fireEvent.click(screen.getByRole('button', { name: /check again/i }));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('disables the retry button while a check is in flight', async () => {
    vi.spyOn(api, 'getHealth').mockReturnValue(new Promise(() => {}));
    render(<ApiStatus />);
    await waitFor(() => expect(screen.getByRole('button', { name: /check again/i })).toBeDisabled());
  });
});
