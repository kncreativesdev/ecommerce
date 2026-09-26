import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AnnouncementBar } from '../AnnouncementBar.jsx';
import { useAnnouncementStore } from '../../../../stores/useAnnouncementStore.js';
import { fetchCurrentAnnouncement } from '../../../../services/announcement.service.js';
import { siteConfig } from '../../../../config/site.js';

vi.mock('../../../../services/announcement.service.js', () => ({
  fetchCurrentAnnouncement: vi.fn(),
}));

function renderBar() {
  return render(
    <MemoryRouter>
      <AnnouncementBar />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAnnouncementStore.getState().reset();
});

describe('AnnouncementBar', () => {
  it('renders the active backend message with its internal link', async () => {
    fetchCurrentAnnouncement.mockResolvedValue({
      message: 'Festive sale is live',
      linkLabel: 'Shop now',
      linkTarget: '/shop',
    });
    renderBar();

    expect(await screen.findByText('Festive sale is live')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Shop now' });
    expect(link.getAttribute('href')).toBe('/shop');
  });

  it('hides the bar cleanly when no announcement is active', async () => {
    fetchCurrentAnnouncement.mockResolvedValue(null);
    const { container } = renderBar();

    // Settles with no content — no fallback message, no empty strip.
    await vi.waitFor(() => {
      expect(useAnnouncementStore.getState().status).toBe('success');
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('never renders hardcoded copy', async () => {
    fetchCurrentAnnouncement.mockResolvedValue({
      message: 'Backend-driven festive message',
      linkLabel: null,
      linkTarget: null,
    });
    renderBar();

    expect(await screen.findByText('Backend-driven festive message')).toBeInTheDocument();
    expect(screen.queryByText(siteConfig.announcement.message)).not.toBeInTheDocument();
  });

  it('keeps the session-local dismiss button', async () => {
    fetchCurrentAnnouncement.mockResolvedValue({
      message: 'Festive sale is live',
      linkLabel: null,
      linkTarget: null,
    });
    const { container } = renderBar();

    expect(await screen.findByText('Festive sale is live')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss announcement' }));
    expect(container).toBeEmptyDOMElement();
  });
});
