import type { NodeGraphData } from './schema';
import type { Picks } from './marks';

export interface NodeGraphProps {
  graph: NodeGraphData;
  ariaLabel: string;
  /** canvas height, px (default 360) */
  height?: number;
  /** default NG_CARD_W */
  cardW?: number;
  /** default 'center' */
  align?: 'center' | 'top';
  /** right panel: smaller text and controls, no title / badge */
  compact?: boolean;
  /** play the entrance on mount (still subject to reduced motion and the 150-card limit) */
  entrance?: boolean;
  selected?: string | null;
  /** click a card / Enter on a card */
  onSelect?: (id: string) => void;
  /** default: every card is selectable when onSelect is given */
  canSelect?: (id: string) => boolean;
  /** controlled dropdowns */
  picks?: Picks;
  /** none → rows only show text */
  onPick?: (key: string, value: string) => void;
  className?: string;
}
