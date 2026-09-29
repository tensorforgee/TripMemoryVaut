// Repair only provenance emitted by the initial Step 6 development build.
// Preserve its complete contents as a note accepted by the existing Place model.
export const reconstructionProvenanceSchema = `
UPDATE places SET provenance_json=json_object('note',provenance_json)
WHERE json_type(provenance_json,'$.suggestionId')='text'
 AND json_extract(provenance_json,'$.algorithmVersion')=1
 AND json_extract(provenance_json,'$.rule')='250m photo cluster; user confirmed'
 AND EXISTS(SELECT 1 FROM draft_suggestions s WHERE s.id=json_extract(places.provenance_json,'$.suggestionId')
  AND s.vault_id=places.vault_id AND s.kind='location' AND s.state='accepted'
  AND json_extract(s.resolution_json,'$.placeId')=places.id);
`;
