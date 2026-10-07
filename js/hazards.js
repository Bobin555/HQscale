// Ready-made hazards and safety checks for the module builder. Dropping one onto a scene creates
// a marker with this description, risk level and "how to check" list already filled in, and
// (where there is a picture) places the picture in the scene so it can be staged in any footage.
// Edit or extend this list to match your organisation's own procedures.

export const HAZARD_CATEGORIES = ['Office', 'Fire & emergency', 'Construction site', 'Warehouse', 'Electrical', 'Security'];

export const HAZARDS = [
  // ---------------- Office
  {
    id: 'trailing-cable', cat: 'Office', icon: '〰️', name: 'Trailing cable', type: 'hazard', risk: 'medium',
    body: 'A cable across a walkway is a trip hazard.',
    checklist: ['Route cables along walls or under desks', 'Use a cable cover where a cable must cross a walkway', 'Report damaged cables and stop using them'],
    sprite: { kind: 'cable' },
  },
  {
    id: 'spill', cat: 'Office', icon: '💧', name: 'Spill on the floor', type: 'hazard', risk: 'medium',
    body: 'Wet floors cause slips. Spills need to be cleaned up or cordoned off straight away.',
    checklist: ['Put out a wet-floor sign', 'Clean it up if it is safe to, or report it to Facilities', 'Remove the sign once the floor is dry'],
    sprite: { kind: 'puddle' },
  },
  {
    id: 'wet-floor-sign', cat: 'Office', icon: '🟨', name: 'Wet floor sign', type: 'check', risk: 'info',
    body: 'A wet-floor sign warns people about a slip hazard.',
    checklist: ['Sign is placed where people will see it before the wet area', 'Floor is dried as soon as possible', 'Sign is removed once the floor is dry'],
    sprite: { kind: 'wetfloor' },
  },
  {
    id: 'obstructed-walkway', cat: 'Office', icon: '📦', name: 'Obstructed walkway', type: 'hazard', risk: 'medium',
    body: 'Boxes and equipment left in walkways cause trips and slow down evacuation.',
    checklist: ['Walkways are kept clear', 'Deliveries are moved to storage promptly', 'Nothing is stored in corridors'],
    sprite: { kind: 'boxes' },
  },
  {
    id: 'workstation-setup', cat: 'Office', icon: '🪑', name: 'Poor workstation set-up', type: 'hazard', risk: 'low',
    body: 'A badly set-up desk, chair or screen leads to back, neck and eye strain.',
    checklist: ['Top of the screen is at eye level, an arm\'s length away', 'Feet flat on the floor, back supported', 'A display screen assessment has been done'],
  },

  // ---------------- Fire & emergency
  {
    id: 'blocked-fire-exit', cat: 'Fire & emergency', icon: '🚪', name: 'Blocked fire exit', type: 'hazard', risk: 'high',
    body: 'Fire exits and the routes to them must be kept clear at all times.',
    checklist: ['Nothing stored in front of or behind the door', 'Door opens freely and closes fully', 'Exit sign is visible and lit', 'Report obstructions to Facilities'],
    sprite: { kind: 'boxes' },
  },
  {
    id: 'fire-extinguisher', cat: 'Fire & emergency', icon: '🧯', name: 'Fire extinguisher', type: 'check', risk: 'info',
    body: 'Know where your nearest extinguisher is and how to tell it is usable.',
    checklist: ['Safety pin and tamper seal intact', 'Pressure gauge needle in the green', 'Inspection tag dated within the last 12 months', 'Mounted and not blocked'],
    sprite: { kind: 'extinguisher' },
  },
  {
    id: 'fire-door-wedged', cat: 'Fire & emergency', icon: '🔥', name: 'Fire door wedged open', type: 'hazard', risk: 'high',
    body: 'A wedged fire door lets fire and smoke spread through the building.',
    checklist: ['Fire doors are closed, never wedged', 'Door closes fully on its own', 'Seals and signs are undamaged'],
  },
  {
    id: 'first-aid-kit', cat: 'Fire & emergency', icon: '⛑️', name: 'First aid kit', type: 'check', risk: 'info',
    body: 'Know where the first aid kit is and who the first aiders are.',
    checklist: ['Kit is clearly signed and easy to reach', 'Contents are stocked and in date', 'First aider names are displayed nearby'],
    sprite: { kind: 'firstaid' },
  },

  // ---------------- Construction site
  {
    id: 'unprotected-edge', cat: 'Construction site', icon: '⚠️', name: 'Unprotected edge', type: 'hazard', risk: 'high',
    body: 'A missing or broken barrier at an edge risks a fall from height.',
    checklist: ['Guardrails or barriers are in place and secure', 'Gaps and damage are reported immediately', 'Nobody works near the edge without protection'],
    sprite: { kind: 'tape' },
  },
  {
    id: 'unsafe-ladder', cat: 'Construction site', icon: '🪜', name: 'Unsafe ladder use', type: 'hazard', risk: 'high',
    body: 'Ladders are for short, light work. Most falls happen from a poorly placed ladder.',
    checklist: ['Ladder is inspected and undamaged', 'Set at the right angle (1 out for every 4 up) on firm, level ground', 'Footed or tied, with three points of contact kept'],
    sprite: { kind: 'ladder' },
  },
  {
    id: 'ppe-not-worn', cat: 'Construction site', icon: '👷', name: 'PPE not worn', type: 'hazard', risk: 'medium',
    body: 'Hard hats, boots and hi-vis are required in this area.',
    checklist: ['Hard hat, safety boots and hi-vis are worn', 'PPE is in good condition', 'Signs show the PPE required for the area'],
    sprite: { kind: 'hardhat' },
  },
  {
    id: 'open-excavation', cat: 'Construction site', icon: '🕳️', name: 'Open excavation', type: 'hazard', risk: 'high',
    body: 'An unguarded hole or trench risks falls and collapse.',
    checklist: ['Excavation is fenced or covered', 'Edges are supported and spoil kept back', 'Inspected before each shift'],
    sprite: { kind: 'hole' },
  },
  {
    id: 'exclusion-zone', cat: 'Construction site', icon: '🚧', name: 'Exclusion zone', type: 'check', risk: 'info',
    body: 'Cones and barriers mark areas people must not enter.',
    checklist: ['Zone is clearly marked', 'Only authorised people inside', 'Barriers are not moved without permission'],
    sprite: { kind: 'cone' },
  },
  {
    id: 'overhead-load', cat: 'Construction site', icon: '🏗️', name: 'Suspended load', type: 'hazard', risk: 'high',
    body: 'Never walk or stand under a load being lifted.',
    checklist: ['Lifting area is cordoned off', 'A banksman controls the lift', 'Lifting equipment is certified and inspected'],
  },

  // ---------------- Warehouse
  {
    id: 'chemical-drum', cat: 'Warehouse', icon: '🛢️', name: 'Chemical storage', type: 'hazard', risk: 'high',
    body: 'Hazardous substances must be stored, labelled and handled safely (COSHH).',
    checklist: ['Containers are labelled and closed', 'Stored on a spill tray in a ventilated area', 'Safety data sheet is available', 'Spill kit is nearby'],
    sprite: { kind: 'drum' },
  },
  {
    id: 'unstable-stack', cat: 'Warehouse', icon: '📦', name: 'Unstable stacking', type: 'hazard', risk: 'medium',
    body: 'Overloaded or badly stacked goods can fall on people.',
    checklist: ['Heavy items stored low', 'Stacks are stable and within racking limits', 'Damaged racking is reported'],
    sprite: { kind: 'boxes' },
  },
  {
    id: 'forklift-route', cat: 'Warehouse', icon: '🚜', name: 'Forklift traffic', type: 'hazard', risk: 'high',
    body: 'People and forklifts must be kept apart.',
    checklist: ['Pedestrian walkways are marked and used', 'Hi-vis is worn', 'Drivers are trained and authorised'],
  },

  // ---------------- Electrical
  {
    id: 'overloaded-socket', cat: 'Electrical', icon: '🔌', name: 'Overloaded socket', type: 'hazard', risk: 'high',
    body: 'Too many plugs or daisy-chained extension leads can overheat and start a fire.',
    checklist: ['One extension lead per socket, never daisy-chained', 'No high-power items (heaters, kettles) on extension leads', 'Leads are PAT tested and undamaged'],
    sprite: { kind: 'socket' },
  },
  {
    id: 'exposed-wiring', cat: 'Electrical', icon: '⚡', name: 'Exposed wiring', type: 'hazard', risk: 'high',
    body: 'Damaged covers or exposed wires risk electric shock and fire.',
    checklist: ['Do not touch, and keep people away', 'Isolate the power if it is safe to', 'Report it to an electrician immediately'],
    sprite: { kind: 'wires' },
  },

  // ---------------- Security
  {
    id: 'unescorted-visitor', cat: 'Security', icon: '🧑', name: 'Unescorted visitor', type: 'hazard', risk: 'medium',
    body: 'Visitors must be escorted by their host at all times.',
    checklist: ['Visitor badge is worn and visible', 'Host stays with the visitor', 'Politely challenge, or report to Security'],
    sprite: { kind: 'person', opts: { lanyard: '#e53935', shirt: '#8e8e8e' } },
  },
  {
    id: 'unlocked-screen', cat: 'Security', icon: '🖥️', name: 'Unlocked screen', type: 'hazard', risk: 'low',
    body: 'An unattended, unlocked computer can expose confidential information.',
    checklist: ['Lock your screen whenever you leave your desk (Windows + L / Ctrl + Cmd + Q)', 'Clear desk: no confidential papers left out'],
    sprite: { kind: 'workstation', opts: { unlocked: true } },
  },
  {
    id: 'tailgating', cat: 'Security', icon: '🚶', name: 'Tailgating', type: 'hazard', risk: 'medium',
    body: 'Holding a secure door open lets people in without a badge.',
    checklist: ['Everyone badges in individually', 'Don\'t hold secure doors open for others', 'Report anyone without a badge to Security'],
  },
  {
    id: 'badge-outside', cat: 'Security', icon: '🪪', name: 'Badge worn outside', type: 'hazard', risk: 'low',
    body: 'A visible badge outside the building shows strangers where you work and can be copied.',
    checklist: ['Take your badge off when you leave the building', 'Never lend your badge', 'Report lost badges straight away'],
  },
];
