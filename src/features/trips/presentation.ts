import { parseDateSpec, unknownDates, type DateSpec, type PartialDate } from '../../domain/date-spec';
import type { Trip, TripFields } from '../../domain/trip';
import type { TripRepository } from './repository';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function endpoint(date: PartialDate): string {
  if (date.precision === 'unknown') return 'Unknown';
  const [year, month, day] = date.value.split('-');
  if (date.precision === 'year') return year;
  return `${date.precision === 'day' ? `${Number(day)} ` : ''}${months[Number(month) - 1]} ${year}`;
}
export function dateLabel(dates: DateSpec): string {
  const knownEnd = dates.end && dates.end.precision !== 'unknown';
  let label = dates.start.precision === 'unknown'
    ? (knownEnd ? `Start unknown – ${endpoint(dates.end!)}` : 'Date unknown')
    : `${endpoint(dates.start)}${knownEnd ? ` – ${endpoint(dates.end!)}` : ' · End unknown'}`;
  if (dates.certainty === 'approximate') label = `Approximate · ${label}`;
  return dates.label ? `${label} · ${dates.label}` : label;
}
export type TripForm = { title: string; summary: string; startPrecision: PartialDate['precision']; start: string;
  endPrecision: PartialDate['precision']; end: string; approximate: boolean; label: string; isFavourite: boolean };
export function tripForm(trip?: Trip): TripForm {
  const dates = trip?.dates ?? unknownDates();
  return { title: trip?.title ?? '', summary: trip?.summary ?? '', startPrecision: dates.start.precision,
    start: dates.start.precision === 'unknown' ? '' : dates.start.value,
    endPrecision: dates.end?.precision ?? 'unknown', end: !dates.end || dates.end.precision === 'unknown' ? '' : dates.end.value,
    approximate: dates.certainty === 'approximate', label: dates.label ?? '', isFavourite: trip?.isFavourite ?? false };
}
export function formPatch(form: TripForm, original?: Trip): Pick<TripFields, 'title' | 'summary' | 'dates' | 'isFavourite'> {
  const fullyUnknown = form.startPrecision === 'unknown' && form.endPrecision === 'unknown';
  let dates = parseDateSpec({
    start: form.startPrecision === 'unknown' ? { precision: 'unknown' } : { precision: form.startPrecision, value: form.start.trim() },
    end: form.endPrecision === 'unknown' ? null : { precision: form.endPrecision, value: form.end.trim() },
    certainty: fullyUnknown ? 'unknown' : form.approximate ? 'approximate' : 'exact', source: 'user',
    ...(form.label.trim() ? { label: form.label.trim() } : {}),
  });
  // Editing another field must not rewrite date provenance or unknown endpoint representation.
  if (original) {
    const before = tripForm(original);
    const dateKeys = ['startPrecision', 'start', 'endPrecision', 'end', 'approximate', 'label'] as const;
    if (dateKeys.every(key => before[key] === form[key])) dates = original.dates;
  }
  return { title: form.title.trim(), summary: form.summary.trim() || null, dates, isFavourite: form.isFavourite };
}
export async function saveTripForm(repository: TripRepository, form: TripForm, original?: Trip, status?: TripFields['status']): Promise<Trip> {
  const patch = formPatch(form, original);
  if (original) return repository.updateBasicTripFields(original.id, { ...patch, ...(status ? { status } : {}) });
  // New forms autosave as resumable drafts; publishing is a separate explicit action.
  return repository.createTripDraft(patch);
}
export function tripSections(trips: Trip[]): { title: string; data: Trip[] }[] {
  return [
    { title: 'Saved trips', data: trips.filter(t => !t.deletedAt && t.status === 'saved' && t.dates.start.precision !== 'unknown') },
    { title: 'Undated', data: trips.filter(t => !t.deletedAt && t.status === 'saved' && t.dates.start.precision === 'unknown') },
    { title: 'Drafts', data: trips.filter(t => !t.deletedAt && t.status === 'draft') },
  ].filter(section => section.data.length > 0);
}
