import type { TripDay } from '../../domain/trip-day';
import { dateLabel } from '../trips/presentation';

export function sectionTitle(day: Pick<TripDay, 'label' | 'dates'>): string {
  return day.label ?? (day.dates ? dateLabel(day.dates) : 'Untitled section');
}
