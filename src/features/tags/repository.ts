import type { LocalDatabase, SqlConnection } from '../../core/database/database';
import { tagName, normalizeTagNameV1, type Tag, type TagTarget } from '../../domain/tag';
import { uuid, utcTimestamp } from '../../domain/validation';

export class TagRepository {
  constructor(private readonly database: LocalDatabase, private readonly vaultId: string, private readonly newId: () => string,
    private readonly now: () => string = () => new Date().toISOString()) { uuid(vaultId, 'vaultId'); }
  list(): Promise<Tag[]> {
    return this.database.run(c => c.getAllAsync<Tag>(`SELECT g.id,g.name FROM tags g JOIN vaults v ON v.id=g.vault_id
      WHERE g.vault_id=? AND g.deleted_at IS NULL AND v.deleted_at IS NULL ORDER BY g.normalized_name,g.id`, this.vaultId));
  }
  private async unique(c: SqlConnection, name: string, id = '') {
    if (await c.getFirstAsync('SELECT id FROM tags WHERE vault_id=? AND normalized_name=? AND deleted_at IS NULL AND id<>?', this.vaultId, normalizeTagNameV1(name), id))
      throw new Error('A tag with this name already exists. Choose the existing tag.');
  }
  create(value: string): Promise<Tag> {
    const name = tagName(value);
    return this.database.transaction(async c => {
      await this.unique(c, name); const id = uuid(this.newId(), 'tag.id'), now = utcTimestamp(this.now(), 'now');
      await c.runAsync('INSERT INTO tags(id,vault_id,name,normalized_name,created_at,updated_at) VALUES(?,?,?,?,?,?)', id,this.vaultId,name,normalizeTagNameV1(name),now,now);
      return {id,name};
    });
  }
  rename(id: string, value: string): Promise<void> {
    uuid(id,'tag.id'); const name=tagName(value);
    return this.database.transaction(async c => {
      await this.requireTag(c,id); await this.unique(c,name,id);
      await c.runAsync('UPDATE tags SET name=?,normalized_name=?,updated_at=? WHERE id=? AND vault_id=?',name,normalizeTagNameV1(name),utcTimestamp(this.now(),'now'),id,this.vaultId);
    });
  }
  remove(id: string): Promise<void> {
    uuid(id,'tag.id'); return this.database.transaction(async c => {
      await this.requireTag(c,id); const now=utcTimestamp(this.now(),'now');
      await c.runAsync('UPDATE tags SET deleted_at=?,updated_at=? WHERE id=? AND vault_id=?',now,now,id,this.vaultId);
    });
  }
  private async requireTag(c: SqlConnection,id: string) {
    if (!await c.getFirstAsync('SELECT id FROM tags WHERE id=? AND vault_id=? AND deleted_at IS NULL',id,this.vaultId)) throw new Error('Tag unavailable');
  }
  private async requireTarget(c: SqlConnection,target: TagTarget) {
    uuid(target.id,'target.id');
    if (target.kind !== 'trip' && target.kind !== 'memory') throw new Error('Invalid tag target');
    const sql=target.kind==='trip' ? 'SELECT id FROM trips WHERE id=? AND vault_id=? AND deleted_at IS NULL'
      : 'SELECT n.id FROM memories n JOIN trips t ON t.id=n.trip_id AND t.vault_id=n.vault_id WHERE n.id=? AND n.vault_id=? AND n.deleted_at IS NULL AND t.deleted_at IS NULL';
    if (!await c.getFirstAsync(sql,target.id,this.vaultId)) throw new Error('Tagged item unavailable');
  }
  forTarget(target: TagTarget): Promise<Tag[]> {
    return this.database.run(async c => {
      await this.requireTarget(c,target);
      return c.getAllAsync<Tag>(`SELECT g.id,g.name FROM tags g JOIN ${target.kind}_tags l ON l.tag_id=g.id AND l.vault_id=g.vault_id
        WHERE l.${target.kind}_id=? AND l.vault_id=? AND l.deleted_at IS NULL AND g.deleted_at IS NULL ORDER BY g.normalized_name,g.id`,target.id,this.vaultId);
    });
  }
  setAttached(target: TagTarget,tagId: string,attached: boolean): Promise<void> {
    uuid(tagId,'tag.id'); return this.database.transaction(async c => {
      await this.requireTarget(c,target); await this.requireTag(c,tagId); const now=utcTimestamp(this.now(),'now');
      const table=`${target.kind}_tags`, column=`${target.kind}_id`;
      const row=await c.getFirstAsync<{id:string;deleted_at:string|null}>(`SELECT id,deleted_at FROM ${table} WHERE vault_id=? AND ${column}=? AND tag_id=?`,this.vaultId,target.id,tagId);
      if (row) {
        if ((row.deleted_at===null) !== attached) await c.runAsync(`UPDATE ${table} SET deleted_at=?,updated_at=? WHERE id=?`,attached?null:now,now,row.id);
      } else if (attached) await c.runAsync(`INSERT INTO ${table}(id,vault_id,${column},tag_id,created_at,updated_at) VALUES(?,?,?,?,?,?)`,uuid(this.newId(),'membership.id'),this.vaultId,target.id,tagId,now,now);
    });
  }
}
