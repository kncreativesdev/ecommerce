import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MarketingNotificationsPage } from '../MarketingNotificationsPage.jsx';
import { AnnouncementsPage } from '../AnnouncementsPage.jsx';
import {
  createMarketingNotification,
  fetchMarketingNotificationsAdmin,
  updateMarketingNotification,
} from '../../services/marketing.service.js';
import { fetchAnnouncementsAdmin, updateAnnouncement } from '../../services/announcement.service.js';

vi.mock('../../services/marketing.service.js', () => ({
  fetchMarketingNotificationsAdmin: vi.fn(),
  fetchMarketingNotificationAdmin: vi.fn(),
  createMarketingNotification: vi.fn(),
  updateMarketingNotification: vi.fn(),
  setMarketingNotificationActive: vi.fn(),
  deleteMarketingNotification: vi.fn(),
}));

vi.mock('../../services/announcement.service.js', () => ({
  fetchAnnouncementsAdmin: vi.fn(),
  fetchAnnouncementAdmin: vi.fn(),
  createAnnouncement: vi.fn(),
  updateAnnouncement: vi.fn(),
  setAnnouncementActive: vi.fn(),
  deleteAnnouncement: vi.fn(),
}));

function notificationFixture(overrides = {}) {
  return {
    id: 'm1',
    title: 'Festive Sale',
    message: 'Up to 30% off on audio.',
    type: 'OFFER',
    isActive: true,
    startsAt: null,
    expiresAt: null,
    linkType: 'SHOP',
    linkValue: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function announcementFixture(overrides = {}) {
  return {
    id: 'a1',
    message: 'Free shipping this weekend',
    isActive: true,
    startsAt: null,
    expiresAt: null,
    linkLabel: 'Shop now',
    linkTarget: '/catalog/products',
    priority: 10,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MarketingNotificationsPage', () => {
  it('lists server notifications with type, destination, and status', async () => {
    fetchMarketingNotificationsAdmin.mockResolvedValue([notificationFixture()]);
    render(
      <MemoryRouter>
        <MarketingNotificationsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Festive Sale')).toBeInTheDocument();
    expect(screen.getByText('OFFER')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows the empty state when no notifications exist', async () => {
    fetchMarketingNotificationsAdmin.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <MarketingNotificationsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();
  });

  it('blocks save with validation errors when required fields are empty', async () => {
    const user = userEvent.setup();
    fetchMarketingNotificationsAdmin.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <MarketingNotificationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Notification' }));
    await user.clear(screen.getByLabelText(/Title/));
    await user.clear(screen.getByLabelText(/Message/));
    await user.click(screen.getByRole('button', { name: 'Create notification' }));

    expect(await screen.findByText('Title is required.')).toBeInTheDocument();
    expect(screen.getByText('Message is required.')).toBeInTheDocument();
    expect(createMarketingNotification).not.toHaveBeenCalled();
  });
});

describe('AnnouncementsPage', () => {
  it('lists announcements and highlights the live current one', async () => {
    fetchAnnouncementsAdmin.mockResolvedValue([
      announcementFixture({ id: 'a-low', priority: 1, message: 'Low priority note' }),
      announcementFixture({ id: 'a-high', priority: 99, message: 'High priority note' }),
    ]);
    render(
      <MemoryRouter>
        <AnnouncementsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('High priority note')).toBeInTheDocument();
    expect(screen.getByText('Low priority note')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Current')).toBeInTheDocument();
  });

  it('rejects external link targets in the form', async () => {
    const user = userEvent.setup();
    fetchAnnouncementsAdmin.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <AnnouncementsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('No announcements yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Announcement' }));
    await user.type(screen.getByLabelText(/Message/), 'Hello shoppers');
    await user.clear(screen.getByLabelText(/Link target/));
    await user.type(screen.getByLabelText(/Link target/), 'https://evil.test/x');
    await user.click(screen.getByRole('button', { name: 'Create announcement' }));

    expect(
      await screen.findByText('Link must be an internal route starting with a single / (no schemes).'),
    ).toBeInTheDocument();
  });
});

describe('admin form focus stability (modal must not steal focus per keystroke)', () => {
  it('announcement message textarea keeps focus across multi-character typing', async () => {
    const user = userEvent.setup();
    fetchAnnouncementsAdmin.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <AnnouncementsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('No announcements yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Announcement' }));
    const field = screen.getByLabelText(/Message/);
    await user.click(field);
    await user.type(field, 'Hello shoppers');

    expect(field).toHaveValue('Hello shoppers');
    expect(document.activeElement).toBe(field);
  });

  it('announcement link input keeps focus across multi-character typing', async () => {
    const user = userEvent.setup();
    fetchAnnouncementsAdmin.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <AnnouncementsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('No announcements yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Announcement' }));
    const field = screen.getByLabelText(/Link target/);
    await user.click(field);
    await user.type(field, '/shop');

    expect(field).toHaveValue('/shop');
    expect(document.activeElement).toBe(field);
  });

  it('editing an announcement preserves content and submits the full string', async () => {
    const user = userEvent.setup();
    fetchAnnouncementsAdmin.mockResolvedValue([announcementFixture()]);
    render(
      <MemoryRouter>
        <AnnouncementsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Free shipping this weekend')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit announcement' }));
    const field = screen.getByLabelText(/Message/);
    expect(field).toHaveValue('Free shipping this weekend');
    await user.click(field);
    await user.type(field, ' today');

    expect(field).toHaveValue('Free shipping this weekend today');
    expect(document.activeElement).toBe(field);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateAnnouncement).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ message: 'Free shipping this weekend today' }),
    );
  });

  it('notification title input keeps focus across multi-character typing', async () => {
    const user = userEvent.setup();
    fetchMarketingNotificationsAdmin.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <MarketingNotificationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Notification' }));
    const field = screen.getByLabelText(/Title/);
    await user.click(field);
    await user.type(field, 'Festive Sale');

    expect(field).toHaveValue('Festive Sale');
    expect(document.activeElement).toBe(field);
  });

  it('notification message textarea keeps focus across multi-character typing', async () => {
    const user = userEvent.setup();
    fetchMarketingNotificationsAdmin.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <MarketingNotificationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Notification' }));
    const field = screen.getByLabelText(/^Message/);
    await user.click(field);
    await user.type(field, 'Up to 30% off on audio.');

    expect(field).toHaveValue('Up to 30% off on audio.');
    expect(document.activeElement).toBe(field);
  });

  it('editing a notification preserves content and submits the full strings', async () => {
    const user = userEvent.setup();
    fetchMarketingNotificationsAdmin.mockResolvedValue([
      notificationFixture({ linkType: null, linkValue: null }),
    ]);
    render(
      <MemoryRouter>
        <MarketingNotificationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Festive Sale')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit notification Festive Sale' }));
    const title = screen.getByLabelText(/Title/);
    expect(title).toHaveValue('Festive Sale');
    await user.click(title);
    await user.type(title, ' 2026');

    expect(title).toHaveValue('Festive Sale 2026');
    expect(document.activeElement).toBe(title);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateMarketingNotification).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ title: 'Festive Sale 2026' }),
    );
  });
});
