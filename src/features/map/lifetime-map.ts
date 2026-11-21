import type { DreamDestination } from '../../domain/dream';
import type { GlobalMapArchive, GlobalMapPlace } from './repository';
import type { Coordinate } from './model';

export type LifetimePlace = {
  id: string; name: string; layer: 'been' | 'dreaming'; coordinate: Coordinate | null;
  visit?: GlobalMapPlace; dream?: DreamDestination;
};

// Dreams never contribute to visited-place counts or remembered routes.
export function lifetimePlaces(archive: GlobalMapArchive, dreams: readonly DreamDestination[]): LifetimePlace[] {
  return [
    ...archive.places.map(visit => ({ id: `been-${visit.id}`, name: visit.name, layer: 'been' as const, coordinate: visit.coordinate, visit })),
    ...dreams.filter(dream => dream.status === 'dreaming' && !dream.isArchived && !dream.deletedAt).map(dream => ({
      id: `dream-${dream.id}`, name: dream.title, layer: 'dreaming' as const, dream,
      coordinate: dream.longitude !== null && dream.latitude !== null ? [dream.longitude, dream.latitude] as Coordinate : null,
    })),
  ];
}
