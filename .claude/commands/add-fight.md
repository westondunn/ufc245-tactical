# Add Fight

Add a new UFC fight to the database.

## Usage

Tell me the details of the fight and I'll add it to `data/generate_seed.py` and regenerate the seed.

## Required Information

- UFC event number (e.g., 310)
- Event name, date, venue, city
- Red corner fighter: name, nickname, height (cm), reach (cm), stance, weight class, nationality
- Blue corner fighter: same fields
- Result: method, detail, round, time, winner
- Whether it's a title fight and/or main event

## Steps

1. Add fighters using `F()` in `data/generate_seed.py` (skip if already exists)
2. Add event using `E()` (skip if already exists)
3. Add fight using `FIGHT()`
4. Optionally add stats using `STATS()`
5. Run `python3 data/generate_seed.py` to regenerate seed.json
6. Run `node tests/run.js` to verify integrity
7. Commit with message: `feat: add UFC {number} data`

## Data Sources

- Results: UFCStats.com (official)
- Fighter profiles: UFC.com
- Detailed stats: UFCStats.com fight detail page
- Never fabricate data
