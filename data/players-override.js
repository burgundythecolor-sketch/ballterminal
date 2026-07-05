/* Manual override of the player stat boards with official
   premierleague.com numbers (2025/26 final). Takes precedence over all
   other sources until it expires — safe to delete once the new season
   starts (it disables itself on the expiry date anyway). */
window.PLAYERS_OVERRIDE = {
  expires: "2026-08-01",
  boards: {
    goals: [
      { name: "Erling Haaland",        club: "MCI", val: 27 },
      { name: "Igor Thiago",           club: "BRE", val: 22 },
      { name: "Antoine Semenyo",       club: "MCI", val: 17 },
      { name: "Ollie Watkins",         club: "AVL", val: 16 },
      { name: "João Pedro",            club: "CHE", val: 15 },
      { name: "Morgan Gibbs-White",    club: "NFO", val: 15 },
      { name: "Viktor Gyökeres",       club: "ARS", val: 14 },
      { name: "Dominic Calvert-Lewin", club: "LEE", val: 14 },
      { name: "Junior Kroupi",         club: "BOU", val: 13 },
      { name: "Danny Welbeck",         club: "BHA", val: 13 },
    ],
    assists: [
      { name: "Bruno Fernandes",       club: "MUN", val: 21 },
      { name: "Rayan Cherki",          club: "MCI", val: 12 },
      { name: "Jarrod Bowen",          club: "WHU", val: 11 },
      { name: "Erling Haaland",        club: "MCI", val: 8 },
      { name: "Dominik Szoboszlai",    club: "LIV", val: 7 },
      { name: "James Garner",          club: "EVE", val: 7 },
      { name: "Harry Wilson",          club: "FUL", val: 7 },
      { name: "Mohamed Salah",         club: "LIV", val: 7 },
      { name: "Granit Xhaka",          club: "SUN", val: 6 },
      { name: "Enzo Le Fée",           club: "SUN", val: 6 },
    ],
    cleansheets: [
      { name: "David Raya",            club: "ARS", val: 19 },
      { name: "Gianluigi Donnarumma",  club: "MCI", val: 15 },
      { name: "Dean Henderson",        club: "CRY", val: 11 },
      { name: "Jordan Pickford",       club: "EVE", val: 11 },
      { name: "Đorđe Petrović",        club: "BOU", val: 11 },
      { name: "Caoimhín Kelleher",     club: "BRE", val: 10 },
      { name: "Bart Verbruggen",       club: "BHA", val: 10 },
      { name: "Robin Roefs",           club: "SUN", val: 10 },
      { name: "Bernd Leno",            club: "FUL", val: 9 },
      { name: "Robert Sánchez",        club: "CHE", val: 9 },
    ],
  },
};
