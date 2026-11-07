import { playerText } from '../hudModel';
import { BURNOUT_RECOVERY_THRESHOLD, BURNOUT_STRESS_THRESHOLD } from '../../shared/stressThresholds';

/** How each archetype looks and where they sit. Joined to the live cast on `archetype`. */
export interface Look {
    archetype: string;
    floor: number;
    x: number;
    color: string;
    hair: string;
    skin: string;
}
export const looks: Look[] = [
    { archetype: 'CEO', floor: 0, x: 52, color: '#a383b7', hair: '#463137', skin: '#e5af82' },
    { archetype: 'Ops manager', floor: 1, x: 22, color: '#e2ad58', hair: '#33272f', skin: '#ba805c' },
    { archetype: 'Breadwinner', floor: 1, x: 40, color: '#82ab86', hair: '#5a3c32', skin: '#d6a07b' },
    { archetype: 'Gossip hub', floor: 1, x: 63, color: '#db8867', hair: '#914d31', skin: '#e5b88d' },
    { archetype: 'Climber', floor: 1, x: 79, color: '#b68ac7', hair: '#56364c', skin: '#e7b893' },
    { archetype: 'Loyalist', floor: 2, x: 23, color: '#669fc6', hair: '#654737', skin: '#e5b38c' },
    { archetype: 'Skeptic', floor: 2, x: 48, color: '#d0b56c', hair: '#302b32', skin: '#b87953' },
    { archetype: 'Flight risk', floor: 2, x: 77, color: '#69b9ad', hair: '#b66b3e', skin: '#e9bd96' },
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
}
/** Portrait expression by stress band. */
export type Mood = 'calm' | 'stretched' | 'snapping';
export const moodFor = (stress: number): Mood =>
    stress > BURNOUT_STRESS_THRESHOLD ? 'snapping' : stress >= BURNOUT_RECOVERY_THRESHOLD ? 'stretched' : 'calm';
const MOUTH: Record<Mood, string> = { calm: 'M9 7h1v1H9zM10 8h2v1h-2z', stretched: 'M9 8h3v1H9z', snapping: 'M9 8h1v1H9zM10 7h2v1h-2z' };
export function Sprite({ person, small = false, quit = false, crop = false, mood }: {
    person: Pick<Look, 'color' | 'hair' | 'skin'>;
    small?: boolean;
    quit?: boolean;
    /** Adds a mouth (and a frown and sweat when snapping). Office sprites leave it unset. */
    mood?: Mood;
    /** Head and shoulders only, for a square portrait. */
    crop?: boolean;
}) {
    return <svg className={small ? 'sprite small' : 'sprite'} viewBox={crop ? '1 0 14 14' : '0 0 16 24'} shapeRendering="crispEdges" aria-hidden="true">
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
function Landscape() {
    return <svg className="landscape" viewBox="0 0 1000 540" preserveAspectRatio="xMidYMid slice" shapeRendering="crispEdges" aria-hidden="true">
  <rect width="1000" height="540" fill="#273f50"/><circle cx="862" cy="75" r="29" fill="#eee0ae"/><path d="M0 270 130 110 250 255 405 89 600 280 760 135 1000 270V540H0" fill="#345765"/><path d="M0 330 170 200 350 340 550 180 760 340 900 240 1000 310V540H0" fill="#3b6267"/>
  {Array.from({ length: 19 }, (_, i) => <g key={i} transform={`translate(${i * 61 - 25} ${80 + (i * 37) % 110})`}><rect x="22" y="50" width="9" height="340" fill="#304c50"/><path d="M26 0 0 70H12L-9 110H9L-20 155H72L44 110H63L41 70H53Z" fill={i % 2 ? '#315456' : '#2c4c51'}/></g>)}
  <path d="M0 498h1000v42H0z" fill="#263e37"/><path d="M0 497h1000v8H0z" fill="#6b8a57"/>
  {Array.from({ length: 70 }, (_, i) => <rect key={i} x={i * 17} y={507 + (i % 3) * 9} width="5" height="4" fill="#46513e"/>)}
    </svg>;
}
export function Office({ people, selected, onSelect, highlight, speaking = null }: {
    people: Person[];
    selected: string | null;
    onSelect: (id: string) => void;
    highlight: string[];
    /** The agent the dialogue bar is showing. */
    speaking?: string | null;
}) {
    return <div className="office-scene"><Landscape /><div className="building"><div className="roof"></div>
    {['EXECUTIVE', 'SALES & OPERATIONS', 'ENGINEERING'].map((floor, index) => <div className={`floor floor-${index}`} key={floor}>
      <span className="floor-label">0{3 - index} / {floor}</span><div className="window window-left"/><div className="window window-right"/><div className="wall-light left"/><div className="wall-light right"/>
      {index === 0 && <><div className="wall-picture">↗<small>GROWTH</small></div><div className="bookcase"><i /><i /><i /></div><div className="plant">♠<b /></div></>}
      {index === 1 && <div className="cooler"><i /><b /></div>}
      {index === 2 && <div className="exit"><span>EXIT →</span><i /></div>}
      {people.filter(p => p.floor === index).map(p => {
        const thought = p.archetype === 'Flight risk';
        const bubble = thought ? p.thinks : p.says;
        return <div key={p.id} className={`station ${selected === p.id ? 'selected' : ''} ${highlight.includes(p.id) ? 'highlighted' : ''} ${p.quit ? 'departed' : ''} ${speaking === p.id ? 'speaking' : ''}`} style={{ left: `${p.x}%` }}>
        <div className="desk"><i className="monitor"/><i className="mug"/></div><button className="person" data-employee={p.id} aria-label={`Inspect ${p.name}`} aria-haspopup="dialog" aria-expanded={selected === p.id} onClick={() => onSelect(p.id)}><Sprite person={p} quit={p.quit}/><span className="name-label">{p.name}{p.stress > BURNOUT_STRESS_THRESHOLD && <b>!</b>}</span></button>
        {((index === 0) || (p.archetype === 'Gossip hub') || thought) && bubble && <button onClick={() => onSelect(p.id)} className={`bubble ${thought ? 'thought' : ''}`}><small>{thought ? 'Thinking' : 'Saying'}</small><span>{playerText(bubble)}</span></button>}
      </div>;
      })}
    </div>)}
  </div></div>;
}
