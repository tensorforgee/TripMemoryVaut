import { parseProposal, parseViaPoints, sameInput, type RoadProposal, type SegmentInput, type ViaPoint } from './model';
import type { RoutingProvider } from './provider';

// A session owns a proposal only. Cancelling/editing never changes the saved row.
// Request generations prevent late replies resurrecting discarded previews.
export class RouteProposalSession {
  viaPoints: ViaPoint[];
  proposal: RoadProposal | null = null;
  error = '';
  busy = false;
  private generation = 0;
  private controller: AbortController | undefined;
  constructor(readonly input: SegmentInput, viaPoints: ViaPoint[] = []) { this.viaPoints = parseViaPoints(viaPoints); }
  editVia(points: ViaPoint[]) { const parsed = parseViaPoints(points); this.discard(); this.viaPoints = parsed; }
  discard() { this.generation++; this.controller?.abort(); this.controller = undefined; this.proposal = null; this.error = ''; this.busy = false; }
  async generate(provider: RoutingProvider) {
    this.discard(); const generation = this.generation;
    this.controller = new AbortController(); this.busy = true;
    try {
      const proposal = await provider.propose(this.input, this.viaPoints, this.controller.signal);
      if (generation === this.generation) {
        const parsed = parseProposal(proposal);
        if (!sameInput(parsed.input, this.input) || JSON.stringify(parsed.viaPoints) !== JSON.stringify(this.viaPoints))
          throw new Error('Routing response does not match this proposal’s inputs.');
        this.proposal = parsed;
      }
    } catch (error) {
      if (generation === this.generation) this.error = error instanceof Error ? error.message : 'Road route generation failed.';
    } finally { if (generation === this.generation) this.busy = false; }
  }
  async confirm(save: (proposal: RoadProposal) => Promise<void>) {
    if (!this.proposal || this.busy) throw new Error('Generate and review a proposal first.');
    const proposal = this.proposal;
    await save(proposal); this.discard();
  }
}
