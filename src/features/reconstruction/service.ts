import { randomUUID } from 'expo-crypto';
import { openVaultDatabase } from '../../core/database/open';
import { ReconstructionRepository } from './repository';
export async function reconstructionService(){const v=await openVaultDatabase();return {vault:v,repository:new ReconstructionRepository(v.database,v.vault.id,randomUUID)};}
