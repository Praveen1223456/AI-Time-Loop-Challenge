/**
 * DEVELOPMENT FIXTURE: hand-authored sample scenario (no AI involved).
 * Phase 3 will produce blueprints of this same shape from Gemini; they must pass
 * the same validateBlueprint() gate.
 *
 * Loop window 20:45 -> 21:00 (15 in-game minutes). Intended route:
 *   Loop 1: explore, learn about the unusual alarm (and that the lights die at 21:00).
 *   Loop 2: use that knowledge to question the engineer (keycard + restricted corridor).
 *   Loop 3: read the maintenance log (unlocks the relay reset), then
 *   Final loop: obtain keycard, reach the reactor hall, reset relay R-7 before 20:55.
 */
const travel = (id, from, to, cost, label, extra = {}) => ({
  id, type: 'travel', label, locationId: from, destinationId: to, timeCost: cost,
  prerequisites: [], effects: [], narrative: label, ...extra,
});

export const sampleScenario = {
  slug: 'nine-minutes-to-darkness',
  title: 'Nine Minutes to Darkness',
  premise:
    'Helios-7, a deep-field research station, will lose all power at 9:00 PM. You have fifteen minutes before the lights die, and every time they do, the clock snaps back to 8:45 PM. You remember. The station does not.',
  objective: 'Find out why Helios-7 loses power at 21:00 and stop it before the loop ends.',
  theme: 'sci-fi',
  difficulty: 'medium',
  initialTime: '20:45',
  loopEndTime: '21:00',
  loopLength: 15,
  maxLoops: 5,
  startLocationId: 'control_room',
  reset: { allowManualReset: true },

  locations: [
    { id: 'control_room', name: 'Control Room', description: 'Banks of dim monitors hum around a central console. A status board glows on the far wall.' },
    { id: 'engineering_bay', name: 'Engineering Bay', description: 'Tool racks, half-open panels and the smell of hot solder. A workbench is buried in cables.' },
    { id: 'reactor_hall', name: 'Reactor Hall', description: 'A cavernous hall lined with relays. The air is warm. Relay R-7 sits behind a scuffed safety rail.' },
    { id: 'maintenance_corridor', name: 'Maintenance Corridor', description: 'A restricted service corridor. Cable trays run overhead; a terminal holds the maintenance logs.', lockedByDefault: true },
  ],

  characters: [
    { id: 'okoye', name: 'Director Imani Okoye', role: 'Station director', initialLocationId: 'control_room', publicFacts: ['Runs the station by the book.', 'Has been awake for twenty hours.'] },
    { id: 'reyes', name: 'Tomas Reyes', role: 'Chief engineer', initialLocationId: 'engineering_bay', publicFacts: ['Pushed a firmware update to the relays this afternoon.', 'Always carries a maintenance keycard.'] },
    { id: 'vance', name: 'Officer Dana Vance', role: 'Security officer', initialLocationId: 'maintenance_corridor', publicFacts: ['Guards the restricted corridor.'] },
  ],

  objects: [
    { id: 'main_breaker', name: 'Main breaker B-1', locationId: 'reactor_hall', initialState: 'closed', states: ['closed', 'open'] },
  ],

  items: [
    { id: 'maintenance_keycard', name: 'Maintenance keycard', description: 'Opens restricted maintenance systems. Reset with each loop.', persistent: false },
    { id: 'field_notebook', name: 'Field notebook', description: 'Your own notebook. Somehow it survives the loop.', persistent: true },
  ],

  facts: [
    { id: 'fact_blackout_at_2100', text: 'The main breaker is scheduled to open at 21:00, cutting all station power.' },
    { id: 'fact_cutoff_disabled', text: "Firmware 2.3.1 disabled relay R-7's thermal cutoff, so it overheats and trips." },
  ],

  clues: [
    { id: 'clue_unusual_alarm', title: 'The silenced alarm', description: 'An R7-TH alarm was silenced at 20:41. Someone wanted it quiet.', persistence: 'persistent' },
    { id: 'clue_blackout_time', title: 'Scheduled blackout', description: 'The status board shows breaker B-1 opening at 21:00, logged as "overload".', persistence: 'persistent' },
    { id: 'clue_director_remark', title: "The Director's remark", description: 'Okoye says Reyes pushed a relay firmware update this afternoon.', persistence: 'persistent' },
    { id: 'clue_r7_patch', title: 'Reyes admits the patch', description: "Reyes confirms his patch touched relay R-7's thermal settings. He hands over his keycard to check the log.", persistence: 'persistent' },
    { id: 'clue_patch_log', title: 'The patch log', description: "The maintenance log shows R-7's thermal cutoff was set to zero. The revert procedure only needs a keycard and access to R-7.", persistence: 'persistent' },
    { id: 'clue_relay_scorch', title: 'Scorched relay', description: 'Relay R-7 is discolored and warm to the touch.', persistence: 'persistent' },
    { id: 'clue_temp_reading', title: 'Gauge reading (this loop)', description: 'The thermal gauge reads dangerously high. It only tells you about this loop.', persistence: 'loop' },
  ],

  actions: [
    // ---- Control room ----
    { id: 'inspect_control_panel', type: 'inspect', label: 'Inspect the control panel', locationId: 'control_room', targetId: 'control_panel', timeCost: 1, prerequisites: [], effects: [{ type: 'discover_clue', clueId: 'clue_unusual_alarm' }], narrative: 'An R7-TH alarm light is dark, but the log shows it was silenced at 20:41.' },
    { id: 'inspect_status_board', type: 'inspect', label: 'Read the status board', locationId: 'control_room', targetId: 'status_board', timeCost: 1, prerequisites: [], effects: [{ type: 'discover_clue', clueId: 'clue_blackout_time' }, { type: 'confirm_fact', factId: 'fact_blackout_at_2100' }], narrative: 'Breaker B-1 is scheduled to open at 21:00. The reason given: "overload".' },
    { id: 'talk_director', type: 'talk', label: 'Talk to Director Okoye', locationId: 'control_room', targetId: 'okoye', timeCost: 2, prerequisites: ['char:okoye@control_room'], effects: [{ type: 'discover_clue', clueId: 'clue_director_remark' }], narrative: '"Reyes pushed an update to the relays this afternoon. Why are you asking?"' },
    { id: 'take_field_notebook', type: 'interact', label: 'Take your field notebook', locationId: 'control_room', targetId: 'notebook', timeCost: 1, prerequisites: ['!item:field_notebook'], effects: [{ type: 'add_item', itemId: 'field_notebook' }], narrative: 'You pocket the notebook. You have a feeling you will want it again.' },
    travel('go_control_to_engineering', 'control_room', 'engineering_bay', 2, 'Go to the Engineering Bay'),
    travel('go_control_to_reactor', 'control_room', 'reactor_hall', 3, 'Go to the Reactor Hall'),

    // ---- Engineering bay ----
    { id: 'talk_engineer_generic', type: 'talk', label: 'Talk to Tomas Reyes', locationId: 'engineering_bay', targetId: 'reyes', timeCost: 2, prerequisites: ['char:reyes@engineering_bay', '!clue:clue_unusual_alarm'], effects: [], narrative: '"Busy," Reyes says without looking up. "Nothing is wrong with my relays."' },
    { id: 'talk_engineer_about_alarm', type: 'talk', label: 'Ask Reyes about the silenced alarm', locationId: 'engineering_bay', targetId: 'reyes', timeCost: 2, prerequisites: ['char:reyes@engineering_bay', 'clue:clue_unusual_alarm'], effects: [{ type: 'discover_clue', clueId: 'clue_r7_patch' }, { type: 'unlock_location', locationId: 'maintenance_corridor' }, { type: 'add_item', itemId: 'maintenance_keycard' }], narrative: 'Reyes goes pale. "The R7-TH alarm... my patch." He presses his keycard into your hand. "The patch log is in the maintenance corridor."' },
    travel('go_engineering_to_control', 'engineering_bay', 'control_room', 2, 'Go to the Control Room'),
    travel('go_engineering_to_reactor', 'engineering_bay', 'reactor_hall', 3, 'Go to the Reactor Hall'),
    travel('go_engineering_to_corridor', 'engineering_bay', 'maintenance_corridor', 2, 'Go to the Maintenance Corridor'),

    // ---- Maintenance corridor ----
    { id: 'inspect_maintenance_log', type: 'inspect', label: 'Read the maintenance log', locationId: 'maintenance_corridor', targetId: 'maintenance_log', timeCost: 1, prerequisites: ['item:maintenance_keycard'], effects: [{ type: 'discover_clue', clueId: 'clue_patch_log' }, { type: 'confirm_fact', factId: 'fact_cutoff_disabled' }, { type: 'unlock_action', actionId: 'interact_reset_relay' }], narrative: "The keycard opens the terminal. R-7's thermal cutoff was set to zero by firmware 2.3.1. The revert procedure is right there." },
    travel('go_corridor_to_engineering', 'maintenance_corridor', 'engineering_bay', 2, 'Go to the Engineering Bay'),

    // ---- Reactor hall ----
    { id: 'inspect_relay_r7', type: 'inspect', label: 'Inspect relay R-7', locationId: 'reactor_hall', targetId: 'relay_r7', timeCost: 1, prerequisites: [], effects: [{ type: 'discover_clue', clueId: 'clue_relay_scorch' }], narrative: 'Relay R-7 is scorched and warm. Something has pushed it past its limits.' },
    { id: 'inspect_thermal_gauge', type: 'inspect', label: 'Read the thermal gauge', locationId: 'reactor_hall', targetId: 'thermal_gauge', timeCost: 1, prerequisites: [], effects: [{ type: 'discover_clue', clueId: 'clue_temp_reading' }], narrative: 'The needle is deep in the red. It is only a reading for this loop.' },
    { id: 'interact_reset_relay', type: 'interact', label: 'Run the R-7 revert procedure', locationId: 'reactor_hall', targetId: 'relay_r7', lockedByDefault: true, timeCost: 2, prerequisites: ['item:maintenance_keycard', '!flag:r7_tripped'], effects: [{ type: 'set_flag', flag: 'relay_reset' }], narrative: "You key in the revert procedure. R-7's thermal cutoff clicks back to life and the heat drains out of the relay." },
    { id: 'interact_emergency_shutdown', type: 'interact', label: 'Trigger the emergency station shutdown (irreversible)', locationId: 'reactor_hall', targetId: 'shutdown_lever', timeCost: 1, prerequisites: [], effects: [{ type: 'set_flag', flag: 'emergency_shutdown' }], narrative: 'You pull the lever. Alarms scream as the station slams into a cold, uncontrolled shutdown.' },
    travel('go_reactor_to_control', 'reactor_hall', 'control_room', 3, 'Go to the Control Room'),
    travel('go_reactor_to_engineering', 'reactor_hall', 'engineering_bay', 3, 'Go to the Engineering Bay'),

    // ---- Anywhere ----
    { id: 'wait_one_minute', type: 'wait', label: 'Wait one minute', locationId: '*', timeCost: 1, prerequisites: [], effects: [], narrative: 'You wait. The seconds tick by.' },
  ],

  // Events fire in (time, declaration order). r7_trips must precede bus_surge, which depends on it.
  events: [
    { id: 'reyes_leaves', at: '20:50', description: 'Tomas Reyes grabs his toolkit and hurries toward the reactor hall.', conditions: [], effects: [{ type: 'move_character', characterId: 'reyes', locationId: 'reactor_hall' }] },
    { id: 'r7_trips', at: '20:55', description: 'Relay R-7 trips with a loud crack.', conditions: ['!flag:relay_reset'], effects: [{ type: 'set_flag', flag: 'r7_tripped' }] },
    { id: 'bus_surge', at: '20:55', description: 'A surge races down the main power bus.', conditions: ['flag:r7_tripped'], effects: [{ type: 'set_flag', flag: 'bus_surge' }] },
    { id: 'blackout', at: '21:00', description: 'Breaker B-1 opens. Helios-7 goes dark.', conditions: ['flag:bus_surge'], effects: [{ type: 'set_object_state', objectId: 'main_breaker', state: 'open' }, { type: 'set_flag', flag: 'blackout' }] },
  ],

  winConditions: [{ id: 'win_outage_prevented', endingId: 'ending_lights_stay_on', conditions: ['flag:relay_reset'] }],
  failureConditions: [{ id: 'fail_emergency_shutdown', endingId: 'ending_panic_shutdown', conditions: ['flag:emergency_shutdown'] }],
  loopLimitEndingId: 'ending_lost_in_the_loop',

  endings: [
    { id: 'ending_lights_stay_on', type: 'victory', title: 'The Lights Stay On', narrative: 'Relay R-7 cools. Nine minutes later the clock ticks past 21:00, and for the first time, nothing happens. The lights hold. You are finally out of the loop.' },
    { id: 'ending_panic_shutdown', type: 'failure', title: 'Cold Shutdown', narrative: 'The emergency shutdown saves the reactor but strands the station in the dark for days. It is not the outcome you were looping for.' },
    { id: 'ending_lost_in_the_loop', type: 'failure', title: 'Lost in the Loop', narrative: 'The loop closes around you one last time. The lights go out at 21:00 and you never find out why.' },
  ],

  // PRIVATE: never sent to the client during active play.
  solutionGuide: {
    causalChain: [
      "Reyes' firmware 2.3.1 update disabled relay R-7's thermal cutoff.",
      'R-7 overheats and trips at 20:55, sending a surge down the main bus.',
      'The surge forces breaker B-1 open at 21:00, blacking out the station.',
      "Running the revert procedure on R-7 before 20:55 (keycard required) prevents the trip, and so the blackout.",
    ],
    requiredClueIds: ['clue_unusual_alarm', 'clue_r7_patch', 'clue_patch_log'],
    intendedEndingId: 'ending_lights_stay_on',
  },
};
