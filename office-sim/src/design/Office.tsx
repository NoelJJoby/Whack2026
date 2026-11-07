export interface Employee {
    id: string;
    name: string;
    role: string;
    floor: number;
    x: number;
    color: string;
    hair: string;
    skin: string;
    stress: number;
    burnout: number;
    trust: number;
    action: string;
    says: string;
    thinks: string;
}
export const employees: Employee[] = [
    { id: 'marcus', name: 'Marcus', role: 'CEO', floor: 0, x: 52, color: '#a383b7', hair: '#463137', skin: '#e5af82', stress: 34, burnout: 20, trust: 82, action: 'Working', says: 'An exciting new chapter for all of us.', thinks: 'The board needs to see results. Whatever it takes.' },
    { id: 'priya', name: 'Priya', role: 'Ops manager', floor: 1, x: 22, color: '#e2ad58', hair: '#33272f', skin: '#ba805c', stress: 76, burnout: 62, trust: 39, action: 'Overworking', says: 'Let’s just get through this week.', thinks: 'I’m enforcing a policy I wouldn’t survive myself.' },
    { id: 'sam', name: 'Sam', role: 'Breadwinner', floor: 1, x: 40, color: '#82ab86', hair: '#5a3c32', skin: '#d6a07b', stress: 81, burnout: 68, trust: 32, action: 'Working', says: 'I can pick up the extra shift.', thinks: 'Rent is due Friday. Quitting isn’t an option.' },
    { id: 'dan', name: 'Dan', role: 'Gossip hub', floor: 1, x: 63, color: '#db8867', hair: '#914d31', skin: '#e5b88d', stress: 58, burnout: 37, trust: 46, action: 'Spreading gossip', says: 'Apparently, Sales is next…', thinks: 'Jess needs to hear this. Well, my version of it.' },
    { id: 'jess', name: 'Jess', role: 'Climber', floor: 1, x: 79, color: '#b68ac7', hair: '#56364c', skin: '#e7b893', stress: 61, burnout: 42, trust: 51, action: 'Listening', says: 'I’m sure leadership has a plan.', thinks: 'If Dan leaves, that senior role opens up.' },
    { id: 'tom', name: 'Tom', role: 'Loyalist', floor: 2, x: 23, color: '#669fc6', hair: '#654737', skin: '#e5b38c', stress: 72, burnout: 58, trust: 55, action: 'Overworking', says: 'They’ve always looked after us.', thinks: 'Twenty hours? This isn’t the company I joined.' },
    { id: 'ravi', name: 'Ravi', role: 'Skeptic', floor: 2, x: 48, color: '#d0b56c', hair: '#302b32', skin: '#b87953', stress: 65, burnout: 49, trust: 24, action: 'Verifying rumour', says: 'Where did that number come from?', thinks: 'Nobody has checked a single word of this.' },
    { id: 'lena', name: 'Lena', role: 'Flight risk', floor: 2, x: 77, color: '#69b9ad', hair: '#b66b3e', skin: '#e9bd96', stress: 92, burnout: 87, trust: 12, action: 'Slacking off', says: 'Just taking a quick break.', thinks: 'I’m done. There has to be more to life than this.' },
];
export function Sprite({ person, small = false, quit = false }: {
    person: Employee;
    small?: boolean;
    quit?: boolean;
}) {
    return <svg className={small ? 'sprite small' : 'sprite'} viewBox="0 0 16 24" shapeRendering="crispEdges" aria-hidden="true">
    <path fill="#252836" d="M4 17h8v5H9v-3H7v3H4zM3 22h4v2H3zM9 22h5v2H9z"/>
    <path fill={person.color} d="M4 9h8v9H4zM2 10h2v6H2zM12 10h2v6h-2z"/>
    <path fill={person.skin} d="M5 2h7v7H5zM3 15h2v3H3zM12 15h2v3h-2z"/>
    <path fill={person.hair} d="M4 1h8v2h1v3h-2V4H6v3H4z"/>
    <path fill="#302732" d="M9 5h1v1H9zM12 5h1v1h-1z"/>
    <path fill="#f0d3a0" d="M7 10h2v3H7z"/>
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
export function Office({ selected, onSelect, highlight, departed }: {
    selected: string;
    onSelect: (id: string) => void;
    highlight: string[];
    departed: boolean;
}) {
    return <div className="office-scene"><Landscape /><div className="scene-caption"><span className="live-dot"/> THE OFFICE <span>•</span> 3 FLOORS / 8 PERSONALITIES</div><div className="building"><div className="roof"><span>ORDINARY COMPANY, EXTRAORDINARY DRAMA.</span></div>
    {['EXECUTIVE', 'SALES & OPERATIONS', 'ENGINEERING'].map((floor, index) => <div className={`floor floor-${index}`} key={floor}>
      <span className="floor-label">0{3 - index} / {floor}</span><div className="window window-left"/><div className="window window-right"/><div className="wall-light left"/><div className="wall-light right"/>
      {index === 0 && <><div className="wall-picture">↗<small>GROWTH</small></div><div className="bookcase"><i /><i /><i /></div><div className="plant">♠<b /></div></>}
      {index === 1 && <div className="cooler"><i /><b /></div>}
      {index === 2 && <div className="exit"><span>EXIT →</span><i /></div>}
      {employees.filter(p => p.floor === index).map(p => <div key={p.id} className={`station ${selected === p.id ? 'selected' : ''} ${highlight.includes(p.id) ? 'highlighted' : ''} ${departed && p.id === 'lena' ? 'departed' : ''}`} style={{ left: `${p.x}%` }}>
        <div className="desk"><i className="monitor"/><i className="mug"/></div><button className="person" aria-label={`Inspect ${p.name}`} onClick={() => onSelect(p.id)}><Sprite person={p} quit={departed && p.id === 'lena'}/><span className="name-label">{p.name}{p.stress > 75 && <b>!</b>}</span></button>
        {((index === 0) || (p.id === 'dan') || (p.id === 'lena')) && <button onClick={() => onSelect(p.id)} className={`bubble ${p.id === 'lena' ? 'thought' : ''}`}><small>{p.id === 'lena' ? '••• THINKING' : 'SAYING'}</small>{departed && p.id === 'lena' ? '“I choose me.”' : p.id === 'lena' ? 'There has to be more to life.' : p.says}</button>}
      </div>)}
    </div>)}
  </div><div className="scene-legend"><span>▰ Public voice</span><span className="thought-key">☁ Private thoughts</span><span>Click an employee to look closer ↗</span></div></div>;
}
