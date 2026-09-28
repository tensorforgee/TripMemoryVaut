import { parseDateSpec, type DateSpec, type PartialDate } from '../../domain/date-spec';
import { placeFields, type Place, type PlaceFields } from '../../domain/place';
import type { Stop, StopFields } from '../../domain/stop';

export type PlaceForm = { name: string; latitude: string; longitude: string; coordinatePrecision: PlaceFields['coordinatePrecision'] };
export function placeForm(place?: Place): PlaceForm {
  return { name: place?.name ?? '', latitude: place?.latitude?.toString() ?? '', longitude: place?.longitude?.toString() ?? '', coordinatePrecision: place?.coordinatePrecision ?? 'unknown' };
}
export function placeFormPatch(form: PlaceForm, original?: Place): Partial<PlaceFields> & { name: string } {
  function coordinate(value: string): number | null {
    if (!value.trim()) return null;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) throw new Error('Coordinates must be decimal numbers, or blank for unknown.');
    return Number(value.trim());
  }
  const patch = { name: form.name.trim(), latitude: coordinate(form.latitude), longitude: coordinate(form.longitude), coordinatePrecision: form.coordinatePrecision };
  placeFields(patch);
  if (original && patch.latitude === original.latitude && patch.longitude === original.longitude && patch.coordinatePrecision === original.coordinatePrecision) return { name: patch.name };
  return { ...patch, source: 'user' };
}
export type DateForm = { start: string; end: string; approximate: boolean; label: string };
export function dateForm(date: DateSpec | null): DateForm {
  return { start: date?.start.precision && date.start.precision !== 'unknown' ? date.start.value : '',
    end: date?.end && date.end.precision !== 'unknown' ? date.end.value : '', approximate: date?.certainty === 'approximate', label: date?.label ?? '' };
}
export function formDate(form: DateForm, original: DateSpec | null = null): DateSpec | null {
  if (JSON.stringify(form) === JSON.stringify(dateForm(original))) return original;
  const partial = (value: string): PartialDate => {
    value = value.trim();
    if (!value) return { precision: 'unknown' };
    const precision = /^\d{4}$/.test(value) ? 'year' : /^\d{4}-\d{2}$/.test(value) ? 'month' : 'day';
    return { precision, value };
  };
  if (!form.start.trim() && !form.end.trim() && !form.label.trim()) return null;
  return parseDateSpec({ start: partial(form.start), end: form.end.trim() ? partial(form.end) : null,
    certainty: !form.start.trim() && !form.end.trim() ? 'unknown' : form.approximate ? 'approximate' : 'exact', source: 'user',
    ...(form.label.trim() ? { label: form.label.trim() } : {}) });
}
export type StopForm = { kind: StopFields['kind']; visitConfirmed: boolean; detailCertainty: StopFields['detailCertainty'];
  note: string; lodgingLabel: string; dates: DateForm; checkoutDates: DateForm };
export function stopForm(stop?: Stop): StopForm {
  return { kind: stop?.kind ?? 'visit', visitConfirmed: stop?.visitConfirmed ?? true, detailCertainty: stop?.detailCertainty ?? 'unknown',
    note: stop?.note ?? '', lodgingLabel: stop?.lodgingLabel ?? '', dates: dateForm(stop?.dates ?? null), checkoutDates: dateForm(stop?.checkoutDates ?? null) };
}
export function stopFormPatch(form: StopForm, original?: Stop): Omit<StopFields, 'placeId' | 'source'> {
  return { kind: form.kind, visitConfirmed: form.visitConfirmed, detailCertainty: form.detailCertainty, note: form.note.trim() || null,
    lodgingLabel: form.kind === 'stay' ? form.lodgingLabel.trim() || null : null,
    dates: formDate(form.dates, original?.dates), checkoutDates: form.kind === 'stay' ? formDate(form.checkoutDates, original?.checkoutDates) : null };
}
