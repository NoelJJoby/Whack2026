import { BURNOUT_RECOVERY_THRESHOLD, BURNOUT_STRESS_THRESHOLD } from '../shared/stressThresholds';

/** How each archetype looks. Joined to the live cast on `archetype`. */
export interface Look {
    archetype: string;
    color: string;
    hair: string;
    skin: string;
}
export const looks: Look[] = [
    { archetype: 'CEO', color: '#a383b7', hair: '#463137', skin: '#e5af82' },
    { archetype: 'Ops manager', color: '#e2ad58', hair: '#33272f', skin: '#ba805c' },
    { archetype: 'Breadwinner', color: '#82ab86', hair: '#5a3c32', skin: '#d6a07b' },
    { archetype: 'Gossip hub', color: '#db8867', hair: '#914d31', skin: '#e5b88d' },
    { archetype: 'Climber', color: '#b68ac7', hair: '#56364c', skin: '#e7b893' },
    { archetype: 'Loyalist', color: '#669fc6', hair: '#654737', skin: '#e5b38c' },
    { archetype: 'Skeptic', color: '#d0b56c', hair: '#302b32', skin: '#b87953' },
    { archetype: 'Flight risk', color: '#69b9ad', hair: '#b66b3e', skin: '#e9bd96' },
];
export function lookFor(archetype: string, index: number): Look {
    return looks.find(l => l.archetype === archetype) ?? looks[index % looks.length];
}
/** One employee as the UI shows them: a look plus live state. */
export interface Person extends Look {
    id: string;
    name: string;
    role: string;
    stress: number;
    workload: number;
    burnout: number;
    trust: number;
    action: string;
    says: string;
    thinks: string;
    quit: boolean;
    present?: boolean;
    late?: boolean;
    /** Display-only model selection for the CEO. */
    model?: string;
}
/** Portrait expression by stress band. */
export type Mood = 'calm' | 'stretched' | 'snapping';
export const moodFor = (stress: number): Mood =>
    stress > BURNOUT_STRESS_THRESHOLD ? 'snapping' : stress >= BURNOUT_RECOVERY_THRESHOLD ? 'stretched' : 'calm';
const MOUTH: Record<Mood, string> = { calm: 'M9 7h1v1H9zM10 8h2v1h-2z', stretched: 'M9 8h3v1H9z', snapping: 'M9 8h1v1H9zM10 7h2v1h-2z' };
/** Pixel portrait for the dialogue bar and employee panel. */
export function Sprite({ person, quit = false, crop = false, mood }: {
    person: Pick<Look, 'color' | 'hair' | 'skin'>;
    quit?: boolean;
    /** Adds a mouth (and a frown and sweat when snapping). The employee panel leaves it unset. */
    mood?: Mood;
    /** Head and shoulders only, for a square portrait. */
    crop?: boolean;
}) {
    return <svg className="sprite" viewBox={crop ? '1 0 14 14' : '0 0 16 24'} shapeRendering="crispEdges" aria-hidden="true">
    <path fill="#252836" d="M4 17h8v5H9v-3H7v3H4zM3 22h4v2H3zM9 22h5v2H9z"/>
    <path fill={person.color} d="M4 9h8v9H4zM2 10h2v6H2zM12 10h2v6h-2z"/>
    <path fill={person.skin} d="M5 2h7v7H5zM3 15h2v3H3zM12 15h2v3h-2z"/>
    <path fill={person.hair} d="M4 1h8v2h1v3h-2V4H6v3H4z"/>
    <path fill="#302732" d="M9 5h1v1H9zM12 5h1v1h-1z"/>
    <path fill="#f0d3a0" d="M7 10h2v3H7z"/>
    {mood && <path fill="#302732" d={MOUTH[mood]}/>}
    {mood === 'snapping' && <path fill="#669fc6" d="M7 4h1v2H7z"/>}
    {quit && <><path fill="#b88953" d="M0 13h11v7H0z"/><path fill="#e1b574" d="M0 13h11v2H0zM5 15h2v3H5z"/></>}
  </svg>;
}
