// Canonical task names and ordering follow Table 1 of ReAct_Manip.pdf.
// Runtime aliases follow Section 5.3; media filenames are preserved.
(() => {
  'use strict';
  const tasks = [
  {
    "name": "phone_lean",
    "objective": "Stably lean a phone",
    "image": "task_12.jpg",
    "video": "erect_phone2.mp4",
    "description": "Position a phone against a support and leave it in a stable leaning pose. Use contact and motion feedback to adjust the placement.",
    "condition": "Hidden dynamics and occluded state",
    "variation": "Phone and support positions vary between Episodes.",
    "aliases": [
      "phone_cup1"
    ],
    "id": "01"
  },
  {
    "name": "leveling_board",
    "objective": "Level a board with shims",
    "image": "leveling_board.svg",
    "video": null,
    "description": "Select and place shims to level a board. Use feedback from the board to revise the support arrangement and reach the required final angle.",
    "condition": "Occluded physical state",
    "variation": "Shim dimensions, thin-side identities and axes, and slot assignments vary between Episodes.",
    "aliases": [
      "leveling_board1"
    ],
    "id": "02"
  },
  {
    "name": "rail_ball_to_cup",
    "objective": "Release a ball to a cup",
    "image": "task_14.jpg",
    "video": "physical_roll.mp4",
    "description": "Release a ball onto rails so that it travels along them, leaves the rail, and lands in a cup. Use the resulting trajectory to refine later attempts.",
    "condition": "Hidden dynamics",
    "variation": "The same recorded reset state is reused within a Task Instance.",
    "aliases": [],
    "id": "03"
  },
  {
    "name": "pitch_pot",
    "objective": "Throw a ball into a pot",
    "image": "task_13.jpg",
    "video": "ball_throwing.mp4",
    "description": "Throw a ball into a pot. Adjust the motion and release using feedback from previous throws; no further contact is allowed after release.",
    "condition": "Hidden dynamics",
    "variation": "The same recorded reset state is reused within a Task Instance.",
    "aliases": [],
    "id": "04"
  },
  {
    "name": "conveyor_grasp",
    "objective": "Sort moving targets",
    "image": "task_4.jpg",
    "video": "conveyor_grasp2.mp4",
    "description": "Grasp moving targets from a conveyor and sort them by category. Completed targets earn partial credit; incorrect placements and unfinished targets affect the outcome.",
    "condition": "Hidden dynamics and occluded state",
    "variation": "Belt speed and target sizes vary between Episodes.",
    "aliases": [],
    "id": "05"
  },
  {
    "name": "curling_push",
    "objective": "Stop a stone in a target",
    "image": "task_6.jpg",
    "video": "push.mp4",
    "description": "Push and release a stone so that it stops inside the target. Contact is prohibited after release, so each outcome informs the next attempt.",
    "condition": "Hidden dynamics",
    "variation": "The same recorded reset state is reused within a Task Instance.",
    "aliases": [],
    "id": "06"
  },
  {
    "name": "turntable_gamble",
    "objective": "Stop at a scoring sector",
    "image": "task_16.jpg",
    "video": "rolling_gamble.mov",
    "description": "Set a turntable in motion and make it stop at a scoring sector. Use observed rotation and stopping behavior to adjust the next action.",
    "condition": "Hidden dynamics",
    "variation": "The same recorded reset state is reused within a Task Instance.",
    "aliases": [
      "turntable_gamble1"
    ],
    "id": "07"
  },
  {
    "name": "ring_toss",
    "objective": "Throw a ring onto posts",
    "image": "task_15.jpg",
    "video": "ring_toss.mp4",
    "description": "Throw a ring onto the scoring posts. Refine the release from observed trajectories. A positive score meets the success condition; the score also distinguishes the resulting placement.",
    "condition": "Hidden dynamics",
    "variation": "The same recorded reset state is reused within a Task Instance.",
    "aliases": [
      "ring_toss1"
    ],
    "id": "08"
  },
  {
    "name": "box_insertion",
    "objective": "Insert an asymmetric block",
    "image": "task_2.jpg",
    "video": "box_pushing.mp4",
    "description": "Push an asymmetric block into a slot while adjusting to friction and uneven mass distribution. The score combines final insertion progress and completion time.",
    "condition": "Hidden dynamics",
    "variation": "Block friction and mass multipliers vary between Episodes.",
    "aliases": [],
    "id": "09"
  },
  {
    "name": "car_drive",
    "objective": "Drive through obstacles",
    "image": "task_7.jpg",
    "video": "cart_driving.mp4",
    "description": "Operate a joystick to drive a vehicle through obstacles and reach the goal. Use the observed vehicle response to adjust steering and throttle control.",
    "condition": "Hidden control mapping",
    "variation": "The throttle-to-speed gain varies between Episodes.",
    "aliases": [
      "car_drive2"
    ],
    "id": "10"
  },
  {
    "name": "rope_hang",
    "objective": "Stably hang a chain",
    "image": "task_10.jpg",
    "video": "rebalance_short_front_seed0.mp4",
    "description": "Manipulate a chain so that it hangs stably over a support. Account for its motion and contact response, and satisfy the final stability condition.",
    "condition": "Hidden dynamics",
    "variation": "The same recorded draped reset state is reused within a Task Instance.",
    "aliases": [],
    "id": "11"
  },
  {
    "name": "pan_flip",
    "objective": "Flip and recapture a pie",
    "image": "task_11.jpg",
    "video": "physical_flip.mp4",
    "description": "Move a pan to toss and flip a pie, then recapture it in the pan. Adjust the motion using feedback from the toss, rotation, and landing.",
    "condition": "Hidden dynamics",
    "variation": "The same recorded reset state is reused within a Task Instance.",
    "aliases": [],
    "id": "12"
  },
  {
    "name": "button_indicator_matching",
    "objective": "Match buttons to lights",
    "image": "task_3.jpg",
    "video": "button_oracle2.mp4",
    "description": "Discover which buttons activate the indicator lights, then respond to the requested target sequence. Use observed button-light responses to select the correct actions.",
    "condition": "Hidden task mapping",
    "variation": "The requested target sequence varies between Episodes.",
    "aliases": [],
    "id": "13"
  },
  {
    "name": "laptop_into_drawer",
    "objective": "Insert a laptop and close drawer",
    "image": "task_8.jpg",
    "video": "laptop_oracle0.mp4",
    "description": "Place a laptop completely inside a drawer, close the drawer, and disengage the grippers. All three conditions are required for final success.",
    "condition": "Occluded physical state",
    "variation": "The laptop position and orientation vary between Episodes.",
    "aliases": [],
    "id": "14"
  },
  {
    "name": "find_object_in_drawer",
    "objective": "Find and collect targets",
    "image": "task_5.jpg",
    "video": "record_seed2_fixed1.mp4",
    "description": "Search the drawers and collect the requested objects in order. Completed targets earn partial credit. Object locations remain fixed while the order of five requested targets changes.",
    "condition": "Occluded physical state",
    "variation": "The order of five requested targets varies; their physical state remains fixed.",
    "aliases": [
      "find_object_in_drawer2"
    ],
    "id": "15"
  },
  {
    "name": "tilte_maze",
    "objective": "Guide a ball through a maze",
    "image": "task_9.jpg",
    "video": "tilt_maze.mp4",
    "description": "Use a joystick to guide a ball through a maze. Adjust control from the ball response while avoiding penalty regions. Scoring records route progress and deducts route penalties.",
    "condition": "Hidden control mapping and dynamics",
    "variation": "The same recorded reset state is reused within a Task Instance.",
    "aliases": [],
    "id": "16"
  }
];
  const names = new Map();
  tasks.forEach((task) => {
    names.set(task.name, task.name);
    task.aliases.forEach((alias) => names.set(alias, task.name));
    Object.freeze(task.aliases);
    Object.freeze(task);
  });
  window.REACT_MANIP_TASKS = Object.freeze(tasks);
  window.REACT_MANIP_TASK_NAME = (value) => names.get(String(value ?? '').trim()) || String(value ?? '');
})();
