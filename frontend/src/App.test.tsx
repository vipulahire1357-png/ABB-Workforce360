import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('WIR sign-in view', () => {
  it('shows the authorized administrator login before worker records', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'WIR — Worker ID & Registration' })).toBeTruthy();
    expect(screen.getByLabelText('Username')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.queryByText('Gate Entry')).toBeNull();
    expect(screen.queryByText('Canteen')).toBeNull();
  });
});
